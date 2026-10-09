# Readable Code Scorecard

> 🔴 **MACHINE-FILLED — the template is filled, never rewritten (MWP Rule 9).** The `Actual` and
> `Status` cells of the machine-decided rows were produced by `organization/scripts/quality-sensors.mjs`
> and must not be edited by hand. The JUDGMENT rows were answered by the session (below).

`
Project:        D:\Projects\Team Builder\organization\scripts\change-runner\state\worktrees\CR-ORG-CONTRACT-001
Epic:           CR-ORG-CONTRACT-001
Milestone:      CR-ORG-CONTRACT-001
Date:           2026-10-09
Scored by:      quality-sensors.mjs (machine rows) + Code Reviewer and Refactor Agent (judgment rows)
Triggered by:   Stage 05 revision and simplification
`

Scoring is mechanical. Each check produces a count or yes/no, compared against a fixed threshold. Subjective verdicts ("pass with notes", percentages) are not permitted.

---

## Mechanical Checks

| # | Dimension | What to count | Where to look | Pass | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | No deep nesting | Functions with control-flow nesting deeper than 3 levels (use guard clauses, early returns, or extract) | Changed code files | 0 | 0 | PASS |
| 2 | No non-trivial duplication | Business rules, validation, permission checks, error handling, or calculations duplicated across ≥2 files | Changed code files | 0 | 0 | PASS |
| 3 | Names communicate purpose | Single-letter identifiers (except loop counters i/j/k/x/y) OR misleading names | All identifiers in changed code | 0 | 0 (judged: only `m`/`r` in two test lambdas/loops; no new src identifiers) | PASS |
| 4 | Function size | Functions exceeding 50 lines without documented justification | Changed code | 0 | 0 | PASS |
| 5 | File size | Files exceeding 300 lines without documented justification | Changed files | 0 | 0 | PASS |
| 6 | No dead code | Unused imports, unreachable code, or unused variables flagged by static analysis | ESLint unused-vars / ts-prune / equivalent | 0 | 0 (judged: tsc clean, no new symbols) | PASS |
| 7 | No commented-out code | Blocks of commented-out code (excluding inline comments that explain non-obvious logic) | Changed code | 0 | 0 | PASS |
| 8 | No magic numbers | Hardcoded numeric or string literals carrying business meaning without a named constant (loop bounds and array indices excluded) | Changed code | 0 | 0 (judged: the `"ph"` literal IS the named constant set entry) | PASS |
| 9 | Wiring-point discipline | Outside-world clients (DB pools/clients, auth/storage/admin clients, mailers, messaging or external API clients) constructed outside a designated wiring module | Changed code files | 0 | 0 | PASS |
| 10 | One seam per vendor | Vendor SDK/API imports outside the single seam module | Changed code files | 0 (N/A if no external-service code touched) | N/A (judged: no vendor code touched) | PASS |
| 11 | Injected clock at time boundaries | Time-boundary business rules reading the ambient clock | Changed business-rule code + its tests | 0 (N/A if no time-boundary logic touched) | N/A (judged: none touched) | PASS |

---

## Result

| | |
|---|---|
| Dimensions passing | 11 of 11 (6 machine, 5 judged) |
| Dimensions blocked | 0 |
| **Status** | **PASS** |

PASS requires every dimension to meet its pass threshold. BLOCKED if any dimension fails.

---

## Blocking Items

None.

---

## Risk Acceptances

None.
