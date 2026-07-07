/**
 * The single low-level read of a central person's identity from `org.person`
 * (DB-DATA-003, OD-001/OD-005 — one shared record, ONE place that reads it, estate-wide
 * from EPIC-008-M005).
 *
 * Before extraction this SELECT was hand-mirrored in DC (`resolveCentralIdentityByEmail`,
 * `findCentralPersonByEmail`), CRM (the same pair) and RMS (`findPersonById`) — four
 * spellings of one read. It returns identity ONLY — never a role or permission (OD-003):
 * an app resolves WHO a person is centrally, and WHAT they may do from its own grants.
 *
 * Server-side: pass any pg connection (Pool, Pool client or a test Client).
 */

import type { Queryable } from "../queryable";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A central person's canonical identity (no permissions — OD-003). */
export interface CentralPerson {
  personId: string;
  fullName: string;
  legalEntityId: string;
  status: string;
  email: string | null;
}

const SELECT =
  "select id::text as id, full_name, home_legal_entity_id::text as legal_entity_id, " +
  "status, email from org.person";

function toPerson(row: Record<string, unknown>): CentralPerson {
  return {
    personId: row.id as string,
    fullName: row.full_name as string,
    legalEntityId: row.legal_entity_id as string,
    status: row.status as string,
    email: (row.email as string | null) ?? null,
  };
}

/** Resolve by canonical id. A malformed uuid is a clean null (never a DB error). */
export async function findPersonById(db: Queryable, id: string): Promise<CentralPerson | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query(`${SELECT} where id = $1`, [id]);
  return rows.length ? toPerson(rows[0]) : null;
}

/** Resolve by email login (case-folded — emails are stored lowercase, DB-CON-006). */
export async function findPersonByEmail(
  db: Queryable,
  email: string,
): Promise<CentralPerson | null> {
  const { rows } = await db.query(`${SELECT} where email = $1`, [email.toLowerCase()]);
  return rows.length ? toPerson(rows[0]) : null;
}

/** Resolve by the optional non-email login handle. */
export async function findPersonByLogin(
  db: Queryable,
  login: string,
): Promise<CentralPerson | null> {
  const { rows } = await db.query(`${SELECT} where login = $1`, [login]);
  return rows.length ? toPerson(rows[0]) : null;
}

/** Resolve by email, but only an ACTIVE person — used by a console/app sign-in so a
 *  retired identity cannot get in even with a valid estate session. */
export async function findActivePersonByEmail(
  db: Queryable,
  email: string,
): Promise<CentralPerson | null> {
  const person = await findPersonByEmail(db, email);
  return person && person.status === "active" ? person : null;
}
