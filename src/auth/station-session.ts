/**
 * Station-session lifecycle close-out (M002 — F8; the consumer `logout` half delivered at
 * EPIC-008-M005, exactly as the org-admin source promised).
 *
 * A station is a SHARED kiosk (a farm bay, a truck), so a fresh tap-in means the previous
 * occupant's session is over: the auth flow calls `endOpenSessionsAtStation` inside the
 * tap-in transaction, just before opening the new session, to stamp `ended_at` on any
 * still-open session at that station and emit one `auto_logoff` audit row per closed
 * session (attributed to the person whose session ended). A stale session therefore lives
 * at most until the next tap-in, and the unified audit viewer sees real session lifecycles.
 *
 * `logoutStationSession` is the EXPLICIT sign-out (the `logout` action): a consumer's
 * station sign-out surface (an RMS tablet, a DC embed) closes its own session deliberately.
 */

import type { AppCode } from "../value-sets";
import type { Queryable } from "../queryable";
import { beginAppAudit, writeAppAudit } from "../audit/app-writer";
import { withTransaction } from "../db/tx";

/**
 * End every OPEN session at a station and emit one `auto_logoff` per closed session. Runs on
 * the caller's transaction (`tx`) — the caller must already run inside a transaction with the
 * app-audit source set (`beginAppAudit`). Returns the number of sessions closed (0 on a
 * station with no open session — the common case). The audit actor is the logged-off person.
 */
export async function endOpenSessionsAtStation(
  tx: Queryable,
  args: { stationId: string; appCode: AppCode },
): Promise<number> {
  const closed = await tx.query(
    `update org.station_session
        set ended_at = now()
      where station_id = $1 and ended_at is null
      returning id::text as id, person_id::text as person_id`,
    [args.stationId],
  );
  const rows = closed.rows as { id: string; person_id: string }[];
  for (const row of rows) {
    await writeAppAudit(tx, {
      actor: row.person_id,
      appCode: args.appCode,
      action: "auto_logoff",
      entity: "station_session",
      entityId: row.id,
      after: { station_id: args.stationId, reason: "superseded_by_tap_in" },
      outcome: "success",
      denyLayer: null,
    });
  }
  return rows.length;
}

/**
 * Explicitly sign out of ONE station session (the `logout` action — the user pressed
 * "sign out", as opposed to being superseded by the next tap-in or expiring). Stamps
 * `ended_at` and emits one `logout` audit row attributed to the session's person. Runs its
 * own transaction. Returns `closed`, or `not_open` when the session is unknown or already
 * ended (idempotent — a double sign-out is not an error).
 */
export async function logoutStationSession(
  db: Queryable,
  args: { stationSessionId: string; appCode: AppCode },
): Promise<"closed" | "not_open"> {
  return withTransaction(db, async (tx) => {
    await beginAppAudit(tx);
    const closed = await tx.query(
      `update org.station_session
          set ended_at = now()
        where id = $1 and ended_at is null
        returning id::text as id, person_id::text as person_id, station_id::text as station_id`,
      [args.stationSessionId],
    );
    if (closed.rows.length === 0) return "not_open";
    const row = closed.rows[0] as unknown as { id: string; person_id: string; station_id: string };
    await writeAppAudit(tx, {
      actor: row.person_id,
      appCode: args.appCode,
      action: "logout",
      entity: "station_session",
      entityId: row.id,
      after: { station_id: row.station_id, reason: "user_sign_out" },
      outcome: "success",
      denyLayer: null,
    });
    return "closed";
  });
}
