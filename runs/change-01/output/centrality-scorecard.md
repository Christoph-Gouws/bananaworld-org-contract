# Centrality Scorecard

> 🔴 **MACHINE-FILLED.** Machine rows come from `organization/scripts/quality-sensors.mjs`; the JUDGMENT rows were answered by the session.

`
Project:        D:\Projects\Team Builder\organization\scripts\change-runner\state\worktrees\CR-ORG-CONTRACT-001
Epic:           CR-ORG-CONTRACT-001
Milestone:      CR-ORG-CONTRACT-001
Date:           2026-10-09
Scored by:      quality-sensors.mjs (machine rows) + Code Reviewer and Refactor Agent (judgment rows)
Triggered by:   Stage 05 revision and simplification
`

---

## Mechanical Checks

| # | Dimension | What to count | Where to look | Pass | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | Design tokens and UI theme | Hardcoded hex colours, pixel sizes, or font families in component files | Component source files | 0 | 0 | PASS |
| 2 | Role and permission rules | Inline / ad-hoc permission checks instead of calls to the central permission module | Authorisation code | 0 | 0 (judged: the change edits the central matrix `MASTER_READ_SCOPE` itself; no inline checks) | PASS |
| 3 | Validation schemas | Scattered inline validators instead of the central schema | Form handlers and endpoint validators | 0 | 0 (judged: none touched) | PASS |
| 4 | Business calculations | Duplicated calculation logic | All code files | 0 | 0 (judged: none touched) | PASS |
| 5 | API clients | Direct fetch / axios / HTTP-library calls instead of the central API client module | Component and service code | 0 | 0 | PASS |
| 6 | Error handling | One-off error-handling patterns instead of the central error handler | All code files | 0 | 0 | PASS |
| 7 | Constants and enumerations | Raw string or numeric identifiers used in business logic instead of named constants / enums | All code files | 0 | 0 (judged: `ph` added to the central `APP_CODES`/`AUDIT_APP_CODES` constants; tests use literals as pins) | PASS |
| 8 | Environment and configuration | Direct process.env / window.location.href / config access | All code files | 0 | 0 | PASS |

---

## Result

| | |
|---|---|
| Dimensions passing | 8 of 8 (4 machine, 4 judged) |
| Dimensions blocked | 0 |
| **Status** | **PASS** |

---

## Blocking Items

None.

---

## Risk Acceptances

None.
