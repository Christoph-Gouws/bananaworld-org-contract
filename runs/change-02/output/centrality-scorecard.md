# Centrality Scorecard

> 🔴 **MACHINE-FILLED — the template is filled, never rewritten (MWP Rule 9).** The `Actual` and
> `Status` cells of the machine-decided rows were produced by `organization/scripts/quality-sensors.mjs`
> and must not be edited by hand; a disagreement with a count is a bug in the sensor, and it gets
> fixed there. The rows marked **JUDGMENT** are NOT decided and are the session's to answer — with
> the finding, not with a fresh criterion of its own. Overall status is **INCOMPLETE**, and it stays INCOMPLETE until every judgment row carries a verdict.

`
Project:        D:\Projects\Team Builder\organization\scripts\change-runner\state\worktrees\CR-ORG-CONTRACT-002
Epic:           CR-ORG-CONTRACT-002
Milestone:      CR-ORG-CONTRACT-002
Date:           2026-10-11
Scored by:      quality-sensors.mjs (machine rows) + Code Reviewer and Refactor Agent (judgment rows)
Triggered by:   Stage 05 revision / Architecture review / Centrality audit
`

Scoring is mechanical. Each check produces a count or yes/no, compared against a fixed threshold. Subjective verdicts ("pass with notes", percentages) are not permitted.

---

## Mechanical Checks

| # | Dimension | What to count | Where to look | Pass | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | Design tokens and UI theme | Hardcoded hex colours, pixel sizes, or font families in component files (outside the central theme/tokens file) | Component source files | 0 | 0 | PASS |
| 2 | Role and permission rules | Inline / ad-hoc permission checks instead of calls to the central permission module | Authorisation code | 0 | 0 (the role/assignment re-check stays the caller's; mint requires it stated) | PASS |
| 3 | Validation schemas | Scattered inline validators instead of the central schema (Zod / Joi / equivalent) | Form handlers and endpoint validators | 0 | 0 | PASS |
| 4 | Business calculations | Duplicated calculation logic (tax / discount / status-transition) instead of a central utility | All code files | 0 | 0 (the acceptance rule has one home, decideCaptureAcceptance) | PASS |
| 5 | API clients | Direct fetch / axios / HTTP-library calls instead of the central API client module | Component and service code | 0 | 0 | PASS |
| 6 | Error handling | One-off error-handling patterns instead of the central error handler | All code files | 0 | 0 | PASS |
| 7 | Constants and enumerations | Raw string or numeric identifiers used in business logic (e.g. status = "pending") instead of named constants / enums | All code files | 0 | 0 (refusal codes, marker, audience, caps are named exports/constants) | PASS |
| 8 | Environment and configuration | Direct process.env / window.location.href / config access instead of the central config module | All code files | 0 | 0 | PASS |

---

## Result

| | |
|---|---|
| Dimensions passing | 8 of 8 |
| Dimensions blocked | 0 |
| **Status** | **PASS** |

PASS requires every dimension to meet its pass threshold. BLOCKED if any dimension fails.

---

## Blocking Items

None from the machine-decided dimensions. The judgment dimensions above are still owed an answer.

---

## Risk Acceptances

The project owner may accept specific failing items in writing. Each acceptance must reference the failing dimension, the specific items being accepted, the rationale, the owner name, and the date. A risk-accepted item does not count as a failure for the Status above.

If none: "None."