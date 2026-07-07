/**
 * The central identity resolver — FROZEN (TECH-COMP-002, API-IDENT-001, AG-ADR-010). The
 * one server-side authority that resolves a person centrally for every app; it returns the
 * canonical identity ONLY, never permissions (OD-003). From EPIC-008-M005 this is the
 * single estate-wide implementation (consumers previously hand-mirrored it).
 *
 *   - `by = 'id' | 'email' | 'login'` resolve LIVE from org.person;
 *   - `by = 'pin'` verifies the entered PIN against the one active org.credential, opens
 *     an org.station_session, and returns the resolved identity + session id — the central
 *     station-auth flow (authenticateStationPin), projected onto this FROZEN shape. The
 *     station-bound TOKEN is a session artifact of the auth surface, not part of the
 *     identity result, so it is deliberately not returned — and deliberately NOT minted
 *     here (identity-only resolution needs no station-token secret; an auth surface that
 *     wants the token calls authenticateStationPin directly).
 *
 * Every call is scoped to a KNOWN, ACTIVE consuming app first (least-privilege per
 * app_code, API-PRINCIPLE-004).
 *
 * Server-side: pass any pg connection (Pool, Pool client or a test Client).
 */

import { findPersonByEmail, findPersonById, findPersonByLogin } from "../identity/person-read";
import type { CentralPerson } from "../identity/person-read";
import { authenticateStationPin } from "../auth/station-pin";
import { assertActiveApp } from "../registry/apps";
import type { Queryable } from "../queryable";
import { type IdentityResolveRequest, type IdentityResolveResult } from "./types";

export async function resolveIdentity(
  db: Queryable,
  req: IdentityResolveRequest,
): Promise<IdentityResolveResult> {
  // Gate 1: the caller must be a registered, active consuming app.
  await assertActiveApp(db, req.appCode);

  if (req.by === "pin") {
    // A station tap-in: stationId is required (API-REQ-003) and the entered PIN is in
    // `value`. Verify centrally, open the session, and project onto the frozen shape — a
    // mismatch / unknown station / locked / collision ALL return not_found (no reason
    // leaked, SEC-CRED-001). The minted station token rides the auth surface, not here.
    if (req.stationId === undefined || req.stationId.length === 0) {
      throw new Error("stationId is required when by='pin' (API-REQ-003).");
    }
    const auth = await authenticateStationPin(
      db,
      {
        pin: req.value,
        stationId: req.stationId,
        appCode: req.appCode,
      },
      new Date(),
      { mintToken: false },
    );
    if (auth.outcome !== "authenticated") return { result: "not_found" };
    return {
      result: "resolved",
      personId: auth.identity.personId,
      fullName: auth.identity.fullName,
      legalEntityId: auth.identity.legalEntityId,
      status: auth.identity.status,
      stationSessionId: auth.stationSessionId,
    };
  }

  // The identity read is centralised in person-read (one place reads org.person).
  let person: CentralPerson | null;
  if (req.by === "id") person = await findPersonById(db, req.value);
  else if (req.by === "email") person = await findPersonByEmail(db, req.value);
  else person = await findPersonByLogin(db, req.value);

  if (!person) return { result: "not_found" };

  // Identity ONLY — never a role or permission (OD-003, API-PRINCIPLE-003). `email` is an
  // internal lookup field and is deliberately NOT part of the frozen result shape.
  return {
    result: "resolved",
    personId: person.personId,
    fullName: person.fullName,
    legalEntityId: person.legalEntityId,
    status: person.status,
  };
}
