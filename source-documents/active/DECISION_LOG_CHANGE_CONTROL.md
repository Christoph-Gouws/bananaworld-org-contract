# Decision log — change control (bananaworld-org-contract)

## CHANGE/DECISION — CR-ORG-CONTRACT-001 (2026-10-09)

- **Asked:** register app code `ph` (Packhouse) in the shared contract, for bananaworld-ph plan id API-CHG-011 part a (DLC-DEC-044), as a new pinned commit the packhouse can consume. No behaviour change for existing consumers.
- **Decided at the plan gate:** plan APPROVED — ship on-green. `ph` joins `APP_CODES`, `AUDIT_APP_CODES` (needed for type and lockstep) and `MASTER_READ_SCOPE` with `["legal_entity","site"]` (same as `mv`). The contract carries no site-type set, so `packhouse` as a site type is Org Admin's part a. Version 0.8.1.
- **Layout:** n/a (not UI-bearing). **Ship mode:** on-green.
- **Clarify questions/answers:** none recorded.
- **Not in scope:** any org.* schema change (Org Admin's owner-applied migration); any consumer pin bump.
- **Debt:** `ORG_CONTRACT_VERSION` constant drift (runs/change-01/output/technical-debt.md).
