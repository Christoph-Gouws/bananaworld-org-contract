/**
 * @bananaworld/org-contract — THE single shared consumption contract for the Bananaworld
 * estate's central org layer (Org Admin EPIC-008-M005, DECISION-GATE-013).
 *
 * FROZEN (AG-ADR-010): API-IDENT-001 (`resolveIdentity`) + API-MASTER-001 (`readMaster`)
 * are the stable shapes every consumer integrates against. From M005 the freeze
 * discipline lives on this package's PINNED VERSION (git+https, full commit SHA): a shape
 * change is a deliberate version bump every consumer adopts by PR, never a drift.
 *
 * Configure once at app startup (see config.ts): the package never reads process.env.
 */

/** The package version, exported for consumer logging/diagnostics. Introduced at 0.1.1 —
 *  the M005 AC-3 upgrade rehearsal. 0.2.0 = the Org Admin EPIC-008-M006 chassis release:
 *  the never-emitted `cutover_*` audit actions are RETIRED, and the legal-entity read
 *  surface gains the re-homed business fields (functional_currency, default_language,
 *  registration_no, tax_no — additive; org-admin migration #21 extends the boundary view
 *  in lockstep). */
export const ORG_CONTRACT_VERSION = "0.2.0";

// Configuration (injected — never process.env)
export {
  configureOrgContract,
  resetOrgContractConfig,
  assertMastersModeSafe,
  type OrgContractConfig,
  type MastersMode,
} from "./config";

// The minimal pg surface + the safe transaction helper
export { type Queryable } from "./queryable";
export { withTransaction } from "./db/tx";

// Value sets (lockstep with the DB CHECKs)
export { APP_CODES, type AppCode } from "./value-sets";

// The frozen consumption contract (API-IDENT-001 / API-MASTER-001)
export {
  type IdentitySelector,
  type IdentityResolveRequest,
  type IdentityResolveResult,
  type MasterName,
  type MasterReadRequest,
  type MasterReadResult,
  type MasterRow,
  ConsumptionContractNotImplemented,
  ForbiddenScopeError,
} from "./contract/types";
export { MASTER_READ_SCOPE, appMayReadMaster } from "./contract/scope";
export { STUB_MASTERS } from "./contract/stub-masters";
export { resolveIdentity } from "./contract/resolver";
export { readMaster } from "./contract/master-read";

// The consuming-app registry (org.app)
export {
  listConsumingApps,
  resolveApp,
  assertActiveApp,
  UnknownAppError,
  type ConsumingApp,
} from "./registry/apps";

// Central identity reads (org.person)
export {
  findPersonById,
  findPersonByEmail,
  findPersonByLogin,
  findActivePersonByEmail,
  type CentralPerson,
} from "./identity/person-read";

// Credential store (org.credential) — the login half + the issuance half
export {
  findActivePinCandidatesForLookup,
  issueActivePin,
  issueOrResetPin,
  revokeActivePin,
  getCredentialStatus,
  type PinCandidate,
  type IssuePinInput,
  type CredentialStatus,
} from "./identity/credential-repo";

// The station-PIN auth flow (SEC-CRED-001 / SEC-AUTH-003 / DECISION-IMPL-005)
export {
  PIN_BCRYPT_COST,
  PIN_LENGTH,
  pinLockoutThreshold,
  pinLockoutWindowMin,
  validatePinStrength,
  isTrivialPin,
  hashPin,
  verifyPin,
  computePinLookup,
  isPinLocked,
  registerFailedAttempt,
  type PinStrengthResult,
  type PinLockoutState,
  type NextFailureState,
} from "./auth/pin";
export {
  authenticateStationPin,
  type StationPinRequest,
  type StationPinIdentity,
  type StationPinResult,
  type StationPinOptions,
} from "./auth/station-pin";
export { endOpenSessionsAtStation, logoutStationSession } from "./auth/station-session";
export {
  mintStationToken,
  verifyStationToken,
  STATION_SESSION_MARKER,
  type MintStationTokenInput,
  type MintedStationToken,
  type StationTokenClaims,
} from "./auth/station-token";
export {
  generatePairingCode,
  hashPairingCode,
  PAIRING_CODE_LENGTH,
  type GeneratedPairingCode,
} from "./auth/station-pairing";
export { resolveOpenStationSession, type OpenStationSession } from "./auth/station-attribution";

// The estate audit standard + the app-path writer (org.audit_write_app)
export {
  AUDIT_APP_CODES,
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_DENY_LAYERS,
  AUDIT_REDACTED_COLUMNS,
  AUDIT_SESSION_VARS,
  SYSTEM_ACTOR_ID,
  type AuditAppCode,
  type AuditAction,
  type AuditOutcome,
  type AuditDenyLayer,
} from "./audit/standard";
export { beginAppAudit, writeAppAudit, type AppAuditInput } from "./audit/app-writer";

// UUID-keyed central-master overlay helpers (the M004 link-key doctrine)
export {
  readCentralMasterIdentities,
  foldCentralIdentity,
  overlayCentralPicker,
  type CentralMasterKind,
  type CentralMasterIdentity,
  type FoldedIdentity,
} from "./masters/overlay";

// The Estate Station Directory read (org.v_estate_station)
export {
  findEstateStations,
  listEstateStations,
  type EstateStation,
  type DirectoryLookup,
} from "./stations/directory";
