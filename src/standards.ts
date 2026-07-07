/**
 * The PURE estate standards — value sets, the audit standard, the frozen contract
 * shapes, the least-privilege scope matrix, and the DEV-stub fixtures. NO server-only
 * dependencies (no node:crypto, no bcryptjs, no jose, no pg): this barrel is safe to
 * import from ANY bundle — client components, edge middleware, server code, tests —
 * exactly as these modules were before extraction ("importable from anywhere").
 *
 * Server consumers use the root barrel (or the granular subpaths); client-reachable code
 * imports from `@bananaworld/org-contract/standards` ONLY. Adding a server dependency to
 * anything re-exported here is a breaking change (it would poison consumer client
 * bundles) — CI-visible because every consumer's Next build compiles this graph.
 */

export { APP_CODES, type AppCode } from "./value-sets";

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

export { type Queryable } from "./queryable";
