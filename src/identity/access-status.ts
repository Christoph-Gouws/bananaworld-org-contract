/**
 * The person ACCESS-STATUS read (v0.8.0, Org Admin EPIC-010-M001) — the one place an app
 * asks "can this person actually get in, and how?"
 *
 * WHY THIS EXISTS (estate user-management strategy v1.1, Rule 1 + Rule 6). A person may
 * hold up to TWO credentials, and holding one never implies the other:
 *   - an ESTATE LOGIN — email + password in the shared `auth.users`, linked by
 *     `org.person.auth_user_id` → browser interfaces;
 *   - a WORKS PIN — one active `org.credential` → station / tablet / handheld scanning.
 *
 * Before this read, no screen anywhere in the estate showed either fact. You could grant
 * someone System Administrator in an app and only discover at the login screen that they
 * had never been given a way to sign in — the failure surfaced as a generic login error,
 * far from its cause (strategy gap G4). Every admin screen that shows a person is meant to
 * show both statuses explicitly, so "scans but cannot log in" stops being a trap and
 * becomes a visible, deliberate state.
 *
 * WHAT IT IS NOT. Identity only — never a role, never a permission (OD-003). `hasLogin`
 * says a login EXISTS, not that this app grants that person anything; each app answers
 * "what may they do" from its own grants. And this module is READ-ONLY: provisioning
 * capability (minting a login, issuing a setup link, revoking sessions) deliberately does
 * NOT ship in this package — it lives exclusively in Org Admin's server, which is the
 * estate's sole account desk (strategy Rule 2; risk R5 — the service-role key is
 * server-side-only, SEC-CONC-002).
 *
 * COMPOSITION, NOT A NEW QUERY. This module owns no SQL of its own: it composes
 * `person-read` (org.person) and `credential-repo` (org.credential), each of which remains
 * the single place its table is touched. It therefore adds no new privilege — a caller sees
 * exactly what its own injected connection already permits (DECISION-GATE-018 D5).
 *
 * Server-side: pass any pg connection (Pool, Pool client or a test Client).
 */

import type { Queryable } from "../queryable";
import { getCredentialStatus, getCredentialStatuses } from "./credential-repo";
import { findPersonById, findPersonsByIds } from "./person-read";

/** A person's two credentials plus the estate off-switch, in one shape. */
export interface PersonAccessStatus {
  personId: string;
  /** `org.person.status` — the single estate-wide off-switch (OD-004 / strategy Rule 5).
   *  `inactive` denies at the next request in EVERY app regardless of the two flags below,
   *  so a UI must read this FIRST: an inactive person with a login and a PIN has neither. */
  status: string;
  /** Whether the person has an estate browser login (`org.person.auth_user_id` is set). */
  hasLogin: boolean;
  /** Whether the person holds an active works PIN (`org.credential`). */
  pinSet: boolean;
}

function toStatus(
  person: { personId: string; status: string; authUserId: string | null },
  pinSet: boolean,
): PersonAccessStatus {
  return {
    personId: person.personId,
    status: person.status,
    hasLogin: person.authUserId !== null,
    pinSet,
  };
}

/** Read one person's access status. `null` for an unknown person or a malformed id — a
 *  clean null, never a DB error (the `person-read` convention). Two queries. */
export async function getPersonAccessStatus(
  db: Queryable,
  personId: string,
): Promise<PersonAccessStatus | null> {
  const person = await findPersonById(db, personId);
  if (!person) return null;
  const { pinSet } = await getCredentialStatus(db, personId);
  return toStatus(person, pinSet);
}

/** Batch form — for a users LIST rendering a status chip per row. TWO queries regardless of
 *  how many people are asked for: an app admin screen must never fan out into an N+1 (the
 *  estate NFR sweep checks for exactly this). Unknown/malformed ids are simply absent from
 *  the Map, so a caller can distinguish "no such person" from a person with neither
 *  credential. */
export async function getPersonAccessStatuses(
  db: Queryable,
  personIds: readonly string[],
): Promise<Map<string, PersonAccessStatus>> {
  const out = new Map<string, PersonAccessStatus>();
  const persons = await findPersonsByIds(db, personIds);
  if (persons.size === 0) return out;
  const credentials = await getCredentialStatuses(db, [...persons.keys()]);
  for (const [id, person] of persons) {
    out.set(id, toStatus(person, credentials.get(id)?.pinSet ?? false));
  }
  return out;
}
