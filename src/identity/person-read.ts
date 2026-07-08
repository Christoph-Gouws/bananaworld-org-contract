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

/** A central person's canonical identity (no permissions — OD-003). `authUserId` (v0.3.1,
 *  EPIC-008-M006): the person's ONE estate browser login — the shared Supabase Auth user id
 *  (org.person.auth_user_id, org-admin migration #22). One person, one login (OD-004); the
 *  mapping previously lived only in DC's public.app_user (retired at M006). Null for a
 *  person with no browser login (e.g. PIN-only floor staff). */
export interface CentralPerson {
  personId: string;
  fullName: string;
  legalEntityId: string;
  status: string;
  email: string | null;
  authUserId: string | null;
}

const SELECT =
  "select id::text as id, full_name, home_legal_entity_id::text as legal_entity_id, " +
  "status, email, auth_user_id::text as auth_user_id from org.person";

function toPerson(row: Record<string, unknown>): CentralPerson {
  return {
    personId: row.id as string,
    fullName: row.full_name as string,
    legalEntityId: row.legal_entity_id as string,
    status: row.status as string,
    email: (row.email as string | null) ?? null,
    authUserId: (row.auth_user_id as string | null) ?? null,
  };
}

/** Resolve by canonical id. A malformed uuid is a clean null (never a DB error). */
export async function findPersonById(db: Queryable, id: string): Promise<CentralPerson | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await db.query(`${SELECT} where id = $1`, [id]);
  const row = rows[0];
  return row ? toPerson(row) : null;
}

/** Resolve by email login (case-folded — emails are stored lowercase, DB-CON-006). */
export async function findPersonByEmail(
  db: Queryable,
  email: string,
): Promise<CentralPerson | null> {
  const { rows } = await db.query(`${SELECT} where email = $1`, [email.toLowerCase()]);
  const row = rows[0];
  return row ? toPerson(row) : null;
}

/** Resolve by the optional non-email login handle. */
export async function findPersonByLogin(
  db: Queryable,
  login: string,
): Promise<CentralPerson | null> {
  const { rows } = await db.query(`${SELECT} where login = $1`, [login]);
  const row = rows[0];
  return row ? toPerson(row) : null;
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

/** Resolve by the estate browser login (the shared Supabase Auth user id) — v0.3.1,
 *  EPIC-008-M006. The rename-safe, email-independent resolution every app uses once DC's
 *  public.app_user mapping is retired. A malformed uuid is a clean null. */
export async function findPersonByAuthId(
  db: Queryable,
  authUserId: string,
): Promise<CentralPerson | null> {
  if (!UUID_RE.test(authUserId)) return null;
  const { rows } = await db.query(`${SELECT} where auth_user_id = $1`, [authUserId]);
  const row = rows[0];
  return row ? toPerson(row) : null;
}

/** Batch-resolve people by auth user id — one query serving list-display joins
 *  (assignee/owner names) that used to LEFT JOIN public.app_user. Malformed ids are
 *  skipped; the Map holds only resolved ids. */
export async function findPersonsByAuthIds(
  db: Queryable,
  authUserIds: readonly string[],
): Promise<Map<string, CentralPerson>> {
  const valid = [...new Set(authUserIds.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, CentralPerson>();
  if (valid.length === 0) return out;
  const { rows } = await db.query(`${SELECT} where auth_user_id = any($1::uuid[])`, [valid]);
  for (const row of rows) {
    const person = toPerson(row);
    if (person.authUserId) out.set(person.authUserId, person);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The central-directory PICKER read (EPIC-008-M007 Workstream D — the first list-MANY
// person read; every read above is resolve-ONE). It backs the "add a person to an app"
// directory pick in DC + CRM. Deliberately search-first, capped and active-only.
// ---------------------------------------------------------------------------

/** Fewer than this many non-space chars → an empty result (never list-all). */
export const LIST_PERSONS_MIN_QUERY = 2;
/** Default result cap when the caller does not specify one. */
export const LIST_PERSONS_DEFAULT_LIMIT = 20;
/** Hard ceiling on results — an app admin can never page the whole estate from a picker. */
export const LIST_PERSONS_MAX_LIMIT = 50;

/** A lightweight person summary for the directory picker. Identity ONLY (OD-003) — just
 *  enough to display a candidate (name + email + status) and select them for provisioning;
 *  the app reads full identity by id once picked. */
export interface PersonSummary {
  personId: string;
  fullName: string;
  email: string | null;
  status: string;
}

export interface ListPersonsOptions {
  /** Required search term, matched case-insensitively as a substring of full name OR email.
   *  A term shorter than {@link LIST_PERSONS_MIN_QUERY} (after trim) yields an empty result:
   *  the directory is NEVER dumped in full. This is both the provisioning-filter (search-
   *  first) and a least-privilege control — a picker cannot enumerate the whole estate
   *  directory (EPIC-008-M007 §D / Workstream B identity-concentration audit). */
  query: string;
  /** Result cap; defaults to {@link LIST_PERSONS_DEFAULT_LIMIT}, clamped to
   *  [1, {@link LIST_PERSONS_MAX_LIMIT}]. */
  limit?: number;
  /** Central person ids ALREADY provisioned in the calling app — excluded so the picker
   *  only offers people not yet in this app. Each app computes this from its OWN grant/
   *  membership table (there is no central app-membership concept); the exclusion happens
   *  in SQL so the cap returns a full page of eligible candidates. Malformed ids are ignored. */
  excludePersonIds?: readonly string[];
}

// Escape LIKE metacharacters so a user's raw search term is matched literally.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Search the central people directory for the app "add a person" picker. Returns at most
 *  `limit` ACTIVE people whose name or email contains the (case-insensitive) search term,
 *  ordered by name, excluding anyone already in the calling app. Returns [] for a too-short
 *  query — search-first, never list-all (EPIC-008-M007 §D). */
export async function listPersons(
  db: Queryable,
  opts: ListPersonsOptions,
): Promise<PersonSummary[]> {
  const q = opts.query.trim();
  if (q.length < LIST_PERSONS_MIN_QUERY) return [];

  const limit = Math.min(
    Math.max(Math.trunc(opts.limit ?? LIST_PERSONS_DEFAULT_LIMIT), 1),
    LIST_PERSONS_MAX_LIMIT,
  );
  const pattern = `%${escapeLike(q.toLowerCase())}%`;
  const exclude = [...new Set((opts.excludePersonIds ?? []).filter((id) => UUID_RE.test(id)))];

  const { rows } = await db.query(
    `select id::text as id, full_name, status, email
       from org.person
      where status = 'active'
        and (lower(full_name) like $1 escape '\\' or lower(email) like $1 escape '\\')
        and ($2::uuid[] is null or id <> all($2::uuid[]))
      order by full_name asc, id asc
      limit $3`,
    [pattern, exclude.length ? exclude : null, limit],
  );
  return rows.map((row) => ({
    personId: row.id as string,
    fullName: row.full_name as string,
    email: (row.email as string | null) ?? null,
    status: row.status as string,
  }));
}
