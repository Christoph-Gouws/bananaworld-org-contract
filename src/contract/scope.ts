/**
 * The per-app least-privilege master-read SCOPE matrix (M2.3, API-MASTER-001 /
 * API-PRINCIPLE-004 / SEC-CONC-001). The SINGLE source of truth for WHICH masters each
 * consuming app may read — the owner-approved scope (org-admin M2.3 Logic Plan Gate,
 * 2026-06-30: "Use the recommended scope").
 *
 * The masters carry NO sensitive fields (no PINs), so least-privilege is which MASTERS an
 * app may read, not field-by-field; the field projection is the canonical, uniform set
 * (the org.v_master_* views). `readMaster` enforces this matrix in BOTH sources (central +
 * stub) BEFORE any read, so a denial is identical either side (parity); a denied master
 * read throws ForbiddenScopeError and is audited in central mode (action `master_read`).
 *
 * Lockstep discipline: org-admin's unit test pins this matrix so an accidental widening is
 * caught before it ships. To change who-reads-what is an OWNER decision (a Logic Plan
 * Gate), not a silent code edit — from M005 that means a deliberate package version bump.
 *
 * NOTE on the Hub: AG-ADR-007 grants the Data & Accounting Hub read of `legal_entity`
 * ONLY — but the Hub is NOT yet a registered consuming app (APP_CODES = dc/crm/rms/mv). When
 * it is added (a future Hub-side milestone) it joins APP_CODES + this matrix with
 * `["legal_entity"]`. Until then it is inert; an unregistered app is denied at the app
 * gate (UnknownAppError) before scope is even checked.
 *
 * Pure data — no DB, no server-only imports — importable from anywhere (UI, API, tests).
 */

import type { AppCode } from "../value-sets";
import type { MasterName } from "./types";

/** Which masters each registered consuming app may read (the approved recommended scope).
 *  Every AppCode MUST have an entry (org-admin's unit test enforces total coverage). */
export const MASTER_READ_SCOPE: Record<AppCode, readonly MasterName[]> = {
  // DC was the accidental owner of all of it → it keeps reading the central masters (+farm since
  // v0.3.0 — post-teardown its farm pickers LIST central farms, EPIC-008-M006). `station` LEFT the
  // matrix at v0.6.0 (EPIC-008-M003): stations are no longer central masters (Doctrine v2).
  dc: ["legal_entity", "entity_role", "site", "asset", "farm"],
  // CRM ties a customer to its serving company → companies + roles + sites (no trucks/stations).
  crm: ["legal_entity", "entity_role", "site"],
  // RMS attributes crate movement → companies + sites + trucks (no entity roles); +farm since
  // v0.3.0 (its farm pickers/name resolution read central farms directly). `station` LEFT at v0.6.0
  // (EPIC-008-M003): RMS owns its stations in `rms.station`, not a central master.
  rms: ["legal_entity", "site", "asset", "farm"],
  // MV (Manga Verde, v0.4.2, DECISION-060/080) configures Plants under a central Legal Entity
  // and reads sites → legal_entity + site only. Identity (Person) + the station-PIN flow are
  // separate contract paths, not master reads (least-privilege: no asset/entity_role/farm).
  mv: ["legal_entity", "site"],
};

/** True iff `app` is granted read of `master` under the least-privilege matrix. */
export function appMayReadMaster(app: AppCode, master: MasterName): boolean {
  return MASTER_READ_SCOPE[app]?.includes(master) ?? false;
}
