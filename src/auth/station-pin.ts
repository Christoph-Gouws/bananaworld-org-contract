/**
 * Central station-PIN authentication — the server-side flow behind the frozen
 * `resolveIdentity({by:'pin'})` (API-IDENT-001 / API-AUTH-001, SEC-AUTH-003, SEC-CRED-001,
 * OD-004): verify the entered PIN against the ONE active org.credential, open an
 * org.station_session, mint the station-bound token, audit the outcome (never the PIN).
 *
 * THE single auditable place the central PIN security decision is made, estate-wide from
 * EPIC-008-M005 (RMS's 384-line hand-mirror of this flow is retired onto it).
 *
 * SERVER-ONLY (imports pin.ts/bcryptjs + station-token.ts/jose — prose marker, the estate
 * convention, so it stays test-drivable with a raw pg Client).
 *
 * Identity-only candidate resolution (OD-003): the resolver cannot scope candidates by
 * app-role, so the entered PIN is matched against the active-credential set and EXACTLY
 * ONE must match — zero or a collision both DENY, with no reason leaked (a mismatch is
 * indistinguishable from an unknown person, SEC-CRED-001).
 *
 * Lockout is per-STATION and self-expiring (DECISION-IMPL-005): THRESHOLD failures within
 * WINDOW lock the station; the lock auto-clears WINDOW minutes later (no admin unlock).
 *
 * TOKEN MINTING is optional (`options.mintToken`, default true — the org-admin auth
 * surface needs the station-bound JWT). An identity-only consumer (RMS's driver tap-in,
 * and `resolveIdentity` itself — the frozen result deliberately carries no token) passes
 * false: no token is minted, and the station-token secret need not be configured.
 */

import { findActivePinCandidatesForLookup } from "../identity/credential-repo";
import { findPersonById } from "../identity/person-read";
import { withTransaction } from "../db/tx";
import { SYSTEM_ACTOR_ID } from "../audit/standard";
import { beginAppAudit, writeAppAudit } from "../audit/app-writer";
import type { AppCode } from "../value-sets";
import type { Queryable } from "../queryable";
import {
  computePinLookup,
  isPinLocked,
  registerFailedAttempt,
  verifyPin,
  type PinLockoutState,
} from "./pin";
import { endOpenSessionsAtStation } from "./station-session";
import { mintStationToken, type MintedStationToken } from "./station-token";

export interface StationPinRequest {
  /** The entered PIN (never logged, never persisted in clear — SEC-CRED-001). */
  readonly pin: string;
  /** The station tapped in at (org.station.id) — sealed into the token (SEC-AUTH-003). */
  readonly stationId: string;
  /** The calling consuming app (dc/crm/rms) or `org` itself — attributed in the auth audit row. */
  readonly appCode: AppCode | "org";
}

export interface StationPinIdentity {
  readonly personId: string;
  readonly fullName: string;
  readonly legalEntityId: string;
  readonly status: string;
}

/** The full station-auth result: the resolved identity + the opened session + the
 *  station-bound token (`null` when the caller opted out of minting). `denied` carries NO
 *  reason (unknown station / mismatch / collision / locked all look identical to the
 *  caller — SEC-CRED-001). */
export type StationPinResult =
  | {
      readonly outcome: "authenticated";
      readonly identity: StationPinIdentity;
      readonly stationSessionId: string;
      readonly token: MintedStationToken | null;
    }
  | { readonly outcome: "denied" };

export interface StationPinOptions {
  /** Mint the station-bound JWT inside the tap-in transaction (default true). Identity-only
   *  consumers pass false — no token, no station-token secret required. */
  readonly mintToken?: boolean;
}

const DENIED: StationPinResult = { outcome: "denied" };

interface StationForPin {
  readonly id: string;
  readonly autoLogoffMinutes: number;
  readonly lockout: PinLockoutState;
}

/** Load the station + its PIN-failure throttle, or null when the station id is unknown. */
async function loadStationForPin(db: Queryable, stationId: string): Promise<StationForPin | null> {
  const { rows } = await db.query(
    `select id::text as id, auto_logoff_minutes,
            failed_pin_attempts, pin_first_failed_at, pin_locked_at
       from org.station
      where id = $1`,
    [stationId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id as string,
    autoLogoffMinutes: r.auto_logoff_minutes as number,
    lockout: {
      failedPinAttempts: r.failed_pin_attempts as number,
      pinFirstFailedAt: (r.pin_first_failed_at as Date | null) ?? null,
      pinLockedAt: (r.pin_locked_at as Date | null) ?? null,
    },
  };
}

/**
 * Authenticate a station tap-in. On success: opens an org.station_session, mints the
 * station-bound token (unless opted out), clears the throttle, and audits `login`. On any
 * failure: audits `pin_failure` and (for a wrong/unknown PIN) advances the per-station
 * throttle — then returns a generic `denied`.
 *
 * `now` is injectable for deterministic lockout tests; it defaults to the wall clock.
 */
export async function authenticateStationPin(
  db: Queryable,
  req: StationPinRequest,
  now: Date = new Date(),
  options: StationPinOptions = {},
): Promise<StationPinResult> {
  const mint = options.mintToken !== false;
  const station = await loadStationForPin(db, req.stationId);

  // Unknown station → generic denial. No throttle to advance (nothing to key it to), and
  // we never reveal that the station id was wrong.
  if (station === null) {
    await withTransaction(db, async (tx) => {
      await beginAppAudit(tx);
      await writeAppAudit(tx, {
        actor: SYSTEM_ACTOR_ID,
        appCode: req.appCode,
        action: "pin_failure",
        entity: "station",
        entityId: req.stationId,
        after: { reason: "unknown_station" },
        outcome: "failed",
        denyLayer: null,
      });
    });
    return DENIED;
  }

  // Already locked (and the auto-expiry window has not passed) → deny without checking the
  // PIN and without extending the lock (the lock self-clears WINDOW minutes after it set).
  if (isPinLocked(station.lockout, now)) {
    await withTransaction(db, async (tx) => {
      await beginAppAudit(tx);
      await writeAppAudit(tx, {
        actor: SYSTEM_ACTOR_ID,
        appCode: req.appCode,
        action: "pin_failure",
        entity: "station",
        entityId: station.id,
        after: { reason: "locked" },
        outcome: "denied",
        denyLayer: "repository",
      });
    });
    return DENIED;
  }

  // Resolve candidates by the PIN's keyed blind index — O(1): the single row whose pin_lookup
  // matches (+ any not-yet-reissued NULL-lookup rows as a transition fail-safe), NOT a scan of
  // every active hash (M002, F2). Then bcrypt-verify each candidate; EXACTLY ONE must match.
  const candidates = await findActivePinCandidatesForLookup(db, computePinLookup(req.pin));
  const matches: string[] = [];
  for (const c of candidates) {
    if (await verifyPin(req.pin, c.pinHash)) matches.push(c.personId);
  }

  // Success: exactly one person. Open the session, mint the token, clear the throttle, audit login.
  if (matches.length === 1) {
    const personId = matches[0] as string;
    const person = await findPersonById(db, personId);
    // The candidate set is active-person-only, so this is defensive (a race retiring the
    // person between the candidate read and here) — deny rather than resolve a ghost.
    if (person === null) return DENIED;

    const opened = await withTransaction<{
      stationSessionId: string;
      token: MintedStationToken | null;
    }>(db, async (tx) => {
      await beginAppAudit(tx);
      // A fresh tap-in at a shared station ends the prior occupant's session (F8 — writes
      // ended_at + emits auto_logoff). Same transaction, so the close + the new session are atomic.
      await endOpenSessionsAtStation(tx, {
        stationId: station.id,
        appCode: req.appCode as AppCode,
      });
      const ins = await tx.query(
        `insert into org.station_session (station_id, person_id, created_by)
         values ($1, $2, $2)
         returning id::text as id`,
        [station.id, personId],
      );
      const inserted = ins.rows[0];
      if (inserted === undefined) throw new Error("station_session insert returned no row");
      const stationSessionId = inserted.id as string;
      // Clear the per-station throttle on a good tap-in.
      await tx.query(
        `update org.station
            set failed_pin_attempts = 0, pin_first_failed_at = null, pin_locked_at = null
          where id = $1`,
        [station.id],
      );
      // Mint INSIDE the txn so a secret-missing config error rolls back the session (no orphan).
      const token = mint
        ? await mintStationToken({
            personId,
            stationId: station.id,
            stationSessionId,
            autoLogoffMinutes: station.autoLogoffMinutes,
          })
        : null;
      await writeAppAudit(tx, {
        actor: personId,
        appCode: req.appCode,
        action: "login",
        entity: "station_session",
        entityId: stationSessionId,
        after: { station_id: station.id, person_id: personId },
        outcome: "success",
        denyLayer: null,
      });
      return { stationSessionId, token };
    });
    return {
      outcome: "authenticated",
      identity: {
        personId: person.personId,
        fullName: person.fullName,
        legalEntityId: person.legalEntityId,
        status: person.status,
      },
      stationSessionId: opened.stationSessionId,
      token: opened.token,
    };
  }

  // Failure: zero matches (wrong/unknown PIN) advances the throttle; a collision (2+) is
  // audited but never advances a guess counter and never resolves ambiguously.
  const isCollision = matches.length > 1;
  await withTransaction(db, async (tx) => {
    await beginAppAudit(tx);
    if (!isCollision) {
      const next = registerFailedAttempt(station.lockout, now);
      await tx.query(
        `update org.station
            set failed_pin_attempts = $2, pin_first_failed_at = $3, pin_locked_at = $4
          where id = $1`,
        [station.id, next.failedPinAttempts, next.pinFirstFailedAt, next.pinLockedAt],
      );
    }
    await writeAppAudit(tx, {
      actor: SYSTEM_ACTOR_ID,
      appCode: req.appCode,
      action: "pin_failure",
      entity: "station",
      entityId: station.id,
      after: { reason: isCollision ? "pin_collision" : "pin_mismatch" },
      outcome: "failed",
      denyLayer: null,
    });
  });
  return DENIED;
}
