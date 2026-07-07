/**
 * Open-station-session resolution — the REAL-PERSON attribution read behind embedded scan
 * surfaces (RMS XSYS-RMS-002 / M7.2; canonicalised into the package at EPIC-008-M005 from
 * RMS's `central-attribution.ts` core).
 *
 * A driver's tap-in opened an `org.station_session`; a write that carries that session id
 * is attributed to the person who tapped in. ATTRIBUTION, NOT AUTHORISATION: the caller's
 * RBAC decides WHO MAY act; this read only refines WHO IS RECORDED. A session that does
 * not attribute (unknown / ended / auto-logoff expired / person no longer active) returns
 * null and the caller falls back to its authorised actor — never a block (RMS-FD-007).
 * App-side concerns (the request header, the source toggle, the fail-open catch) stay in
 * the consumer.
 */

import type { Queryable } from "../queryable";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The central context an open station session attributes: WHO (the person) + WHERE (the
 *  session's station — sessions follow the station's owner, pattern §6). `email` is the
 *  person's estate login (lowercased, or null if unset) — the bridge from a PIN session to
 *  a consumer's own email-keyed role grants. */
export interface OpenStationSession {
  readonly personId: string;
  readonly stationId: string;
  readonly email: string | null;
}

/**
 * Resolve the central person + station behind an OPEN station session, or null when the
 * session does not attribute (unknown id / ended / auto-logoff expired / person no longer
 * active). `now` is injectable for deterministic expiry tests.
 */
export async function resolveOpenStationSession(
  db: Queryable,
  stationSessionId: string,
  now: Date = new Date(),
): Promise<OpenStationSession | null> {
  if (!UUID_RE.test(stationSessionId)) return null;
  const { rows } = await db.query(
    `select ss.person_id::text as person_id, ss.station_id::text as station_id,
            p.email as email, ss.started_at, ss.ended_at, s.auto_logoff_minutes
       from org.station_session ss
       join org.station s on s.id = ss.station_id
       join org.person p on p.id = ss.person_id and p.status = 'active'
      where ss.id = $1`,
    [stationSessionId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as unknown as {
    person_id: string;
    station_id: string;
    email: string | null;
    started_at: Date;
    ended_at: Date | null;
    auto_logoff_minutes: number;
  };
  if (r.ended_at !== null) return null;
  const expiresAt = r.started_at.getTime() + r.auto_logoff_minutes * 60_000;
  if (now.getTime() > expiresAt) return null;
  const email = typeof r.email === "string" && r.email.length > 0 ? r.email.toLowerCase() : null;
  return { personId: r.person_id, stationId: r.station_id, email };
}
