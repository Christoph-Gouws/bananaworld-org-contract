/**
 * Injected package configuration (EPIC-008-M005, DECISION-GATE-013 choice 1).
 *
 * This package NEVER reads process.env. Every deployment-specific value — the two shared
 * secrets, the masters mode, the lockout tuning, the unresolved-link telemetry hook — is
 * injected ONCE by the host app via `configureOrgContract()` (typically in the module that
 * builds its pg pool, before any contract call). Secret accessors are LAZY (functions), so
 * a missing secret fails closed at USE time with the host's own error, exactly like the
 * apps' env.ts accessors did before extraction.
 *
 * Fail-closed defaults:
 *   - unset secret accessor → throws on use (a misconfigured deploy denies, never degrades);
 *   - unset isProductionEnv → treated as PRODUCTION (so stub mode is refused — AG-ADR-006);
 *   - unset mastersMode → "central" (the stub is opt-in, API-STUB-001);
 *   - lockout tuning → the owner-ratified 5 failures / 5 minutes (DECISION-IMPL-005);
 *   - unresolved-link hooks → the estate console.error convention (Sentry captures it in
 *     production — the DC M004 loud-but-degraded seam, DECISION-GATE-012).
 */

import type { CentralMasterKind } from "./masters/overlay";

export type MastersMode = "central" | "stub";

export interface OrgContractConfig {
  /**
   * The estate PIN-lookup HMAC key (`STATION_PIN_LOOKUP_SECRET`) — keys the deterministic
   * `org.credential.pin_lookup` blind index (Org Admin M002, F1/F2). MUST be byte-identical
   * in EVERY app that reads org.credential; rotating it orphans every lookup until every
   * PIN is reissued.
   */
  stationPinLookupSecret?: () => string;
  /**
   * The HS256 secret for the station-bound session token (the shared estate
   * `SUPABASE_JWT_SECRET` — the same trust material DC's station tokens use, SEC-AUTH-003).
   */
  stationTokenSecret?: () => string;
  /** Master-read source (API-STUB-001): `central` = org.v_master_* views; `stub` = the
   *  in-memory DEV fixtures. Default `central`. */
  mastersMode?: () => MastersMode;
  /** True on a production deploy — with `mastersMode='stub'` the read REFUSES (AG-ADR-006).
   *  Default TRUE (an unconfigured host is treated as production — fail closed). */
  isProductionEnv?: () => boolean;
  /** Station PIN lockout tuning (DECISION-IMPL-005). Defaults: 5 failures / 5 minutes. */
  pinLockout?: { threshold?: number; windowMinutes?: number };
  /** Loud-but-degraded telemetry (DECISION-GATE-012): a populated org_*_id link that did not
   *  resolve centrally. Default: the estate `[central-link]` console.error convention. */
  onUnresolvedCentralLink?: (kind: CentralMasterKind, linkId: string) => void;
  /** A central master read that failed outright (e.g. a lost GRANT) and degraded to local
   *  identity. Default: the estate `[central-link]` console.error convention. */
  onCentralReadFailure?: (kind: CentralMasterKind, linkCount: number, error: unknown) => void;
}

let current: OrgContractConfig = {};

/** Install the host app's configuration. MERGES onto any prior call (last write wins per
 *  key), so a host may configure secrets and telemetry from different modules. */
export function configureOrgContract(config: OrgContractConfig): void {
  current = { ...current, ...config };
}

/** Reset to the unconfigured (fail-closed) state — test use only. */
export function resetOrgContractConfig(): void {
  current = {};
}

function missing(name: string): never {
  throw new Error(
    `@bananaworld/org-contract is not configured: ${name} is required. ` +
      `Call configureOrgContract({ ${name}: … }) at app startup.`,
  );
}

export function getStationPinLookupSecret(): string {
  const accessor = current.stationPinLookupSecret ?? (() => missing("stationPinLookupSecret"));
  const value = accessor();
  if (typeof value !== "string" || value.length === 0) missing("stationPinLookupSecret");
  return value;
}

export function getStationTokenSecret(): string {
  const accessor = current.stationTokenSecret ?? (() => missing("stationTokenSecret"));
  const value = accessor();
  if (typeof value !== "string" || value.length === 0) missing("stationTokenSecret");
  return value;
}

export function getMastersMode(): MastersMode {
  return current.mastersMode?.() ?? "central";
}

export function getIsProductionEnv(): boolean {
  return current.isProductionEnv?.() ?? true;
}

/**
 * The prod-stub DEPLOY GUARD (AG-ADR-006): a production environment must NEVER serve the
 * DEV stub. Runtime backstop in `readMaster`; hosts may also call it at deploy/CI time.
 */
export function assertMastersModeSafe(): void {
  if (getIsProductionEnv() && getMastersMode() === "stub") {
    throw new Error(
      "Refusing to run: masters mode 'stub' in a production environment. " +
        "The DEV stub must never serve production data (API-STUB-001, AG-ADR-006).",
    );
  }
}

const DEFAULT_LOCKOUT_THRESHOLD = 5;
const DEFAULT_LOCKOUT_WINDOW_MIN = 5;

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getPinLockoutThreshold(): number {
  return positiveOrDefault(current.pinLockout?.threshold, DEFAULT_LOCKOUT_THRESHOLD);
}

export function getPinLockoutWindowMin(): number {
  return positiveOrDefault(current.pinLockout?.windowMinutes, DEFAULT_LOCKOUT_WINDOW_MIN);
}

/** DC's exact M004 fail-loud message (kept verbatim so consumer log/test expectations hold). */
export function reportUnresolvedCentralLink(kind: CentralMasterKind, linkId: string): void {
  if (current.onUnresolvedCentralLink) {
    current.onUnresolvedCentralLink(kind, linkId);
    return;
  }
  console.error(
    `[central-link] unresolved ${kind} link ${linkId} — showing local identity, not central (fail-loud, degraded)`,
  );
}

/** DC's exact M004 degrade-not-crash message (kept verbatim — see above). */
export function reportCentralReadFailure(
  kind: CentralMasterKind,
  linkCount: number,
  error: unknown,
): void {
  if (current.onCentralReadFailure) {
    current.onCentralReadFailure(kind, linkCount, error);
    return;
  }
  console.error(
    `[central-link] central ${kind} read failed — degrading ${linkCount} link(s) to local identity (fail-loud)`,
    error instanceof Error ? error.message : error,
  );
}
