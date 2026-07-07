# @bananaworld/org-contract

THE single shared consumption contract for the Bananaworld estate's central org layer
(`org.*` on the shared Supabase Postgres). Extracted from Org Admin at **EPIC-008-M005**
(DECISION-GATE-013); it replaces the four hand-mirrored implementations that previously
lived in org-admin, Bananaworld-DC, Bananaworld-CRM and Bananaworld-RMS.

## What it carries

- **Identity resolution** — `resolveIdentity` (FROZEN, API-IDENT-001) + the low-level
  `org.person` reads.
- **Master reads** — `readMaster` (FROZEN, API-MASTER-001) over the `org.v_master_*`
  boundary views, the per-app least-privilege scope matrix, and the DEV-stub source.
- **The station-PIN auth flow** — bcrypt verify, the keyed `pin_lookup` blind index
  (M002), per-station self-expiring lockout (DECISION-IMPL-005), session open/close
  (`auto_logoff` / `logout`), the station-bound JWT, and PIN issuance/reset.
- **UUID-keyed master-overlay helpers** — the M004 link-key doctrine
  (`readCentralMasterIdentities` / `foldCentralIdentity` / `overlayCentralPicker`,
  loud-but-degraded fail semantics).
- **The Estate Station Directory read** — `org.v_estate_station` (DECISION-GATE-008),
  fail-open.
- **The estate audit standard** + the `org.audit_write_app` app-path writer.

## How consumers install it

The design-system distribution pattern — a git dependency pinned to a FULL commit SHA
(never `github:` shorthand — it resolves over SSH and breaks CI):

```jsonc
"@bananaworld/org-contract": "git+https://github.com/Christoph-Gouws/bananaworld-org-contract.git#<full-40-char-sha>"
```

Next.js consumers add it to `transpilePackages` (the package ships raw TypeScript `src/`,
no build step).

## Configuration (no process.env inside the package)

Call once at startup, before any contract call:

```ts
import { configureOrgContract } from "@bananaworld/org-contract";

configureOrgContract({
  stationPinLookupSecret: () => requiredEnv("STATION_PIN_LOOKUP_SECRET"), // byte-identical estate-wide
  stationTokenSecret: () => requiredEnv("SUPABASE_JWT_SECRET"),
  mastersMode: () => (process.env.ORG_MASTERS_MODE === "stub" ? "stub" : "central"),
  isProductionEnv: () => process.env.ORG_ENV !== "dev",
});
```

Everything defaults FAIL-CLOSED: unset secrets throw at use; an unconfigured environment
is treated as production (so the DEV stub is refused — AG-ADR-006).

## Freeze discipline

API-IDENT-001 / API-MASTER-001 remain frozen (AG-ADR-010). From M005 the discipline lives
on the pinned SHA: a contract change is a deliberate version bump adopted by PR in every
consumer — CI in each consumer repo proves the swap, and the boundary views' shapes are
additionally pinned by each consumer's own seam tests.

## Tests

- `pnpm test:unit` — pure logic (no DB).
- `pnpm test:integration` — against a THROWAWAY Postgres (`TEST_DATABASE_URL`); the suite
  creates a minimal `org.*` stand-in schema and DROPS IT. **Never point this at a shared
  database** (estate rule ENV-DEV-002).
