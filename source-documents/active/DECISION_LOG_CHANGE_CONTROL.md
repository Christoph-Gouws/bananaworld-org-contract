# Decision log — change control (bananaworld-org-contract)

## CHANGE/DECISION — CR-ORG-CONTRACT-002 (2026-10-11)

- **Asked:** device-key signed offline capture and the confined drain session (bananaworld-ph plan id API-CHG-011 part b; TA-OFF-008, STI-DEV-005, API-OFF-001; DLC-DEC-044). A registered floor device signs each queued action; the server replays a drained action under a drain session that can act only as the person who captured it, within the server-recorded grace window. PIN enrolment is out (DLC-DEC-047).
- **Decided at the plan gate:** plan APPROVED — ship on-green. This package holds the shared rules and the credential only; the device list, per-token record and drain endpoint stay with the packhouse. Grace window capped at 90 minutes after the server-recorded expiry; drain session at most 300 s; the drain secret must differ from every other token key. Version 0.9.0, additive, no SQL.
- **Layout:** n/a (not UI-bearing). **Ship mode:** on-green.
- **Clarify questions/answers:** none recorded.
- **Not in scope:** any org.* schema change; any consumer pin bump; the packhouse's drain endpoint and token record (its EPIC-002); the end-to-end staging run (recorded against this change after that).
- **Debt:** `ORG_CONTRACT_VERSION` constant drift (runs/change-02/technical-debt.md).

## CHANGE/DECISION — CR-ORG-CONTRACT-001 (2026-10-09)

- **Asked:** register app code `ph` (Packhouse) in the shared contract, for bananaworld-ph plan id API-CHG-011 part a (DLC-DEC-044), as a new pinned commit the packhouse can consume. No behaviour change for existing consumers.
- **Decided at the plan gate:** plan APPROVED — ship on-green. `ph` joins `APP_CODES`, `AUDIT_APP_CODES` (needed for type and lockstep) and `MASTER_READ_SCOPE` with `["legal_entity","site"]` (same as `mv`). The contract carries no site-type set, so `packhouse` as a site type is Org Admin's part a. Version 0.8.1.
- **Layout:** n/a (not UI-bearing). **Ship mode:** on-green.
- **Clarify questions/answers:** none recorded.
- **Not in scope:** any org.* schema change (Org Admin's owner-applied migration); any consumer pin bump.
- **Debt:** `ORG_CONTRACT_VERSION` constant drift (runs/change-01/output/technical-debt.md).
