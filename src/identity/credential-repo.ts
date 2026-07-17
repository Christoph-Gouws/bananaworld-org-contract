/**
 * The single low-level read/write of `org.credential` (DB-DATA-004, SEC-CRED-001,
 * OD-004 — one active hashed PIN per person, ONE place that touches the table,
 * estate-wide from EPIC-008-M005).
 *
 * Centrality: every read/write of org.credential lives HERE. The station-PIN flow
 * (auth/station-pin.ts) reads candidates through this module; PIN issuance/reset builds
 * its supersession on `issueOrResetPin`. RMS carried a hand-mirrored copy of the login
 * half until M005. The pin_hash is NEVER returned to a client or written to the audit
 * trail (the DB writer redacts it — SEC-AUDIT-002).
 *
 * Server-side: pass any pg connection (Pool, Pool client or a test Client).
 */

import { SYSTEM_ACTOR_ID } from "../audit/standard";
import { beginAppAudit, writeAppAudit } from "../audit/app-writer";
import { withTransaction } from "../db/tx";
import type { Queryable } from "../queryable";

/** A PIN candidate the entered PIN is bcrypt-checked against (identity-only — no role,
 *  no app scoping; that is OD-003 per-app territory). */
export interface PinCandidate {
  readonly personId: string;
  readonly pinHash: string;
}

/**
 * The station-tap-in candidate set, resolved by the PIN's keyed blind index (M002, F2 —
 * KI-M2.2-001). Returns the (at most one) ACTIVE `pin` credential whose `pin_lookup` matches
 * the entered PIN's HMAC, PLUS any active rows still carrying a NULL `pin_lookup` — pre-M002
 * credentials not yet reissued, matchable only by bcrypt, so they ride along as a fail-safe
 * until the reissue backfill completes. Post-reissue the null set is empty, so this returns
 * 0 or 1 row → O(1) login. The caller (auth/station-pin.ts) bcrypt-verifies each returned
 * candidate and applies the exactly-one-match rule (a collision denies). The
 * `credential_pin_lookup_unique` index guarantees `pin_lookup = $1` yields at most one row.
 */
export async function findActivePinCandidatesForLookup(
  db: Queryable,
  pinLookup: string,
): Promise<PinCandidate[]> {
  const { rows } = await db.query(
    `select c.person_id::text as person_id, c.pin_hash
       from org.credential c
       join org.person p on p.id = c.person_id
      where c.active = true
        and c.kind = 'pin'
        and c.pin_hash is not null
        and p.status = 'active'
        and (c.pin_lookup = $1 or c.pin_lookup is null)`,
    [pinLookup],
  );
  return rows.map((r) => ({
    personId: r.person_id as string,
    pinHash: r.pin_hash as string,
  }));
}

export interface IssuePinInput {
  personId: string;
  /** A bcrypt fingerprint (cost 12) — the caller hashes via auth/pin.ts `hashPin`. NEVER plaintext. */
  pinHash: string;
  /**
   * The PIN's keyed blind index (auth/pin.ts `computePinLookup`) — the caller computes it beside
   * `pinHash` from the same raw PIN, so this repo still never sees plaintext. Stored in
   * `org.credential.pin_lookup`; the partial-unique index makes a cross-person PIN collision a
   * `duplicate_pin` at issuance (M002, F1). Required for every issued PIN from M002 on.
   */
  pinLookup: string;
  /** The administrator issuing the PIN; attributed in the audit row. */
  actorPersonId?: string | null;
}

/**
 * Issue a person's one active PIN credential. The DB partial-unique index
 * `credential_one_active_per_person` (M1.1, DB-CON-008) guarantees at most one active
 * credential per person; a second active insert returns `duplicate_active` rather than a
 * raw error. Emits a `pin_issue` audit row via the app path (the PIN hash is never in it).
 *
 * PIN issuance/reset wraps SUPERSESSION (deactivate the prior, then issue) around this via
 * `issueOrResetPin`; this primitive does not supersede.
 */
export async function issueActivePin(
  db: Queryable,
  input: IssuePinInput,
): Promise<
  | { result: "issued"; credentialId: string }
  | { result: "duplicate_active" }
  | { result: "duplicate_pin" }
> {
  const actor = input.actorPersonId ?? SYSTEM_ACTOR_ID;
  try {
    return await withTransaction<{ result: "issued"; credentialId: string }>(db, async (tx) => {
      // Short-circuit the M1.3 auto-write trigger so the richer pin_issue row is the only one.
      await beginAppAudit(tx);
      const ins = await tx.query(
        `insert into org.credential (person_id, kind, pin_hash, pin_lookup, active, created_by)
         values ($1, 'pin', $2, $3, true, $4)
         returning id::text as id`,
        [input.personId, input.pinHash, input.pinLookup, input.actorPersonId ?? null],
      );
      const inserted = ins.rows[0];
      if (inserted === undefined) throw new Error("credential insert returned no row");
      const credentialId = inserted.id as string;
      await writeAppAudit(tx, {
        actor,
        appCode: "org",
        action: "pin_issue",
        entity: "credential",
        entityId: credentialId,
        after: { person_id: input.personId, kind: "pin" },
        outcome: "success",
        denyLayer: null,
      });
      return { result: "issued", credentialId };
    });
  } catch (err) {
    // The transaction has already rolled back. Map the two unique violations (23505):
    //   credential_pin_lookup_unique      → another active person holds this PIN (M002, F1)
    //   credential_one_active_per_person  → this person already has an active credential
    return uniqueViolationConstraint(err) === "credential_pin_lookup_unique"
      ? { result: "duplicate_pin" }
      : { result: "duplicate_active" };
  }
}

/** The constraint name of a caught unique violation (SQLSTATE 23505), or rethrow if the error
 *  is anything else (the caller only knows how to translate a unique violation). */
function uniqueViolationConstraint(err: unknown): string | undefined {
  if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
    return (err as { constraint?: string }).constraint;
  }
  throw err;
}

/** Whether a person currently holds an active PIN, and when it was set. */
export interface CredentialStatus {
  pinSet: boolean;
  setAt: Date | null;
}

/** Read a person's active-PIN state (never the hash). */
export async function getCredentialStatus(
  db: Queryable,
  personId: string,
): Promise<CredentialStatus> {
  const { rows } = await db.query(
    `select set_at from org.credential
      where person_id = $1 and active = true and kind = 'pin'
      limit 1`,
    [personId],
  );
  const row = rows[0];
  return row
    ? { pinSet: true, setAt: (row.set_at as Date) ?? null }
    : { pinSet: false, setAt: null };
}

/** Batch-read active-PIN state (never the hash) — ONE query, so a caller rendering a LIST
 *  of people never fans out into N reads. The Map holds an entry for EVERY id asked for, so
 *  a caller need not distinguish "holds no PIN" from "was not looked up". (v0.8.0 — the
 *  batch half of {@link getCredentialStatus}, added so `getPersonAccessStatuses` stays
 *  O(1) queries. It lives HERE, not in its caller, because every read of org.credential
 *  lives in this module — the centrality rule this file is built on.) */
export async function getCredentialStatuses(
  db: Queryable,
  personIds: readonly string[],
): Promise<Map<string, CredentialStatus>> {
  const out = new Map<string, CredentialStatus>();
  const ids = [...new Set(personIds)];
  for (const id of ids) out.set(id, { pinSet: false, setAt: null });
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `select person_id::text as person_id, set_at from org.credential
      where person_id = any($1::uuid[]) and active = true and kind = 'pin'`,
    [ids],
  );
  for (const row of rows) {
    out.set(row.person_id as string, { pinSet: true, setAt: (row.set_at as Date) ?? null });
  }
  return out;
}

/**
 * Issue or reset a person's one active PIN (the supersession wrapper around the
 * `issueActivePin` primitive). In one transaction: deactivate any current active credential,
 * then insert the new active one — so the one-active-per-person invariant (DB-CON-008) is
 * never violated. Emits a single app-path audit row: `pin_issue` on a first issue,
 * `pin_reset` when a prior PIN was superseded (the hash is never in it). The caller has
 * validated strength and hashed the PIN (auth/pin.ts) — this module never sees plaintext.
 */
export async function issueOrResetPin(
  db: Queryable,
  input: IssuePinInput,
): Promise<{ result: "issued" | "reset"; credentialId: string } | { result: "duplicate_pin" }> {
  const actor = input.actorPersonId ?? SYSTEM_ACTOR_ID;
  try {
    return await withTransaction<{ result: "issued" | "reset"; credentialId: string }>(
      db,
      async (tx) => {
        // Short-circuit the M1.3 auto-write trigger for BOTH the deactivate + the insert so the
        // single richer pin_issue/pin_reset row is the only audit entry for this change.
        await beginAppAudit(tx);

        const prior = await tx.query(
          `update org.credential set active = false, updated_by = $2
            where person_id = $1 and active = true
            returning id::text as id`,
          [input.personId, input.actorPersonId ?? null],
        );
        const priorRow = prior.rows[0];
        const supersededId = priorRow ? (priorRow.id as string) : null;

        const ins = await tx.query(
          `insert into org.credential (person_id, kind, pin_hash, pin_lookup, active, created_by)
           values ($1, 'pin', $2, $3, true, $4)
           returning id::text as id`,
          [input.personId, input.pinHash, input.pinLookup, input.actorPersonId ?? null],
        );
        const inserted = ins.rows[0];
        if (inserted === undefined) throw new Error("credential insert returned no row");
        const credentialId = inserted.id as string;

        await writeAppAudit(tx, {
          actor,
          appCode: "org",
          action: supersededId ? "pin_reset" : "pin_issue",
          entity: "credential",
          entityId: credentialId,
          before: supersededId ? { superseded_credential_id: supersededId } : null,
          after: { person_id: input.personId, kind: "pin" },
          outcome: "success",
          denyLayer: null,
        });
        return { result: supersededId ? "reset" : "issued", credentialId };
      },
    );
  } catch (err) {
    // The transaction has rolled back atomically (the supersession is undone with it). The
    // prior active credential was just deactivated, freeing credential_one_active_per_person,
    // so the only reachable unique violation is the pin_lookup collision — the new PIN is held
    // by ANOTHER active person (M002, F1) → duplicate_pin. Non-unique errors rethrow.
    uniqueViolationConstraint(err);
    return { result: "duplicate_pin" };
  }
}

/**
 * Revoke a person's active PIN (deactivate it, issuing no replacement) — the person then has
 * no PIN until one is re-issued. A plain UPDATE (active true→false) captured as `deactivate`
 * by the M1.3 auto-write trigger. Returns `revoked` or `none_active` if there was no PIN.
 */
export async function revokeActivePin(
  db: Queryable,
  personId: string,
  actorPersonId?: string | null,
): Promise<{ result: "revoked" | "none_active" }> {
  const { rowCount } = await db.query(
    `update org.credential set active = false, updated_by = $2
      where person_id = $1 and active = true`,
    [personId, actorPersonId ?? null],
  );
  return { result: rowCount ? "revoked" : "none_active" };
}
