/**
 * The consumption contract — the FROZEN request/response shapes apps read through
 * (TECH-COMP-003, API-IDENT-001, API-MASTER-001, AG-ADR-010, PC-MVP-005).
 *
 * These types are the STABLE skeleton every consumer integrates against. The shape was
 * frozen at org-admin M1.4 and filled across Epic 2 WITHOUT changing these signatures;
 * from EPIC-008-M005 the freeze discipline transfers to this package's pinned version —
 * a shape change is a version bump every consumer adopts deliberately, never a drift.
 *
 * The identity resolver returns the canonical identity ONLY — NEVER permissions. The
 * absence of any role/permission field here is load-bearing (OD-003, API-PRINCIPLE-003):
 * an app resolves WHO a person is centrally, and WHAT they may do from its own grants.
 *
 * Pure types — no DB, no server-only imports.
 */

import type { AppCode } from "../value-sets";

// --- Identity resolution (API-IDENT-001) -----------------------------------------

/** How the caller identifies the person (API-REQ-001). */
export type IdentitySelector = "id" | "email" | "login" | "pin";

export interface IdentityResolveRequest {
  by: IdentitySelector;
  /** Matches `by`: a uuid for `id`, an address for `email`, a handle for `login`, the
   *  entered PIN for `pin` (the PIN value is never logged). */
  value: string;
  /** The calling app — scopes least-privilege resolution (API-REQ-004, DB-DATA-010). */
  appCode: AppCode;
  /** Required when `by = 'pin'`: the station the person tapped in at (API-REQ-003). */
  stationId?: string;
}

/** API-IDENT-001 result. Identity only — no permissions (OD-003). `not_found` carries
 *  no reason (a PIN mismatch is indistinguishable from an unknown person, SEC-CRED-001). */
export type IdentityResolveResult =
  | { result: "not_found" }
  | {
      result: "resolved";
      personId: string;
      fullName: string;
      legalEntityId: string;
      status: string;
      /** Present when `by = 'pin'` and a station session was opened (Epic 2). */
      stationSessionId?: string;
    };

// --- Master read (API-MASTER-001) ------------------------------------------------

/** The masters a consumer may read (API-REQ-005). `farm` joined at v0.3.0
 *  (EPIC-008-M006): post-teardown DC/RMS LIST central farms directly — previously farms
 *  were only an overlay kind onto local `public.farm` rows (now dropped). */
export type MasterName = "legal_entity" | "entity_role" | "site" | "asset" | "station" | "farm";

export interface MasterReadRequest {
  master: MasterName;
  /** The calling app — the read is scoped to what that app is granted (least-privilege). */
  appCode: AppCode;
  /** Master-specific filters (API-REQ-007); applied from a safe per-master allow-list. */
  filter?: Record<string, string>;
  /** Opaque pagination cursor (API-REQ-008). */
  cursor?: string;
}

/** One master row — the shared record's canonical id (no second copy, OD-005), plus the
 *  master's fields. `stewardApp` is present for app-stewardable masters (e.g. assets:
 *  DC delivery trucks are DC-stewarded — API-RES-009). */
export interface MasterRow {
  id: string;
  stewardApp?: string;
  [key: string]: unknown;
}

export interface MasterReadResult {
  items: MasterRow[];
  /** Present when more rows exist (API-RES-010). */
  nextCursor?: string;
}

/** Thrown for paths that are deliberately deferred to a later delivery (the frozen shape
 *  is callable now; the behaviour arrives on schedule). */
export class ConsumptionContractNotImplemented extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsumptionContractNotImplemented";
  }
}

/** A least-privilege violation (M2.3): the calling app is not granted read of the
 *  requested master (scope.ts). Maps to the standard error `FORBIDDEN_SCOPE` (API §11);
 *  no row data is leaked, and the attempt is audited in central mode (SEC-CONC-001,
 *  API-TEST-005). Identical on both sources (central + stub) — error-model parity. */
export class ForbiddenScopeError extends Error {
  /** The stable §11 error code. */
  readonly code = "FORBIDDEN_SCOPE" as const;
  readonly appCode: string;
  readonly master: MasterName;
  constructor(appCode: string, master: MasterName) {
    super(`App '${appCode}' is not permitted to read master '${master}'.`);
    this.name = "ForbiddenScopeError";
    this.appCode = appCode;
    this.master = master;
  }
}
