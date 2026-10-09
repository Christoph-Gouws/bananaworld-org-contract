# Milestone evidence — CR-ORG-CONTRACT-001 (change-01)

Roll-up, pointers only. Date 2026-10-09. Ship mode: on-green. Layout: n/a (not UI-bearing).

## Artifacts
| Artifact | Path | Status |
|---|---|---|
| Test results + QA verdict | runs/change-01/output/test-results.md | PASS — unit 56/56, integration 55/55, typecheck clean |
| Defect log | runs/change-01/output/defect-log.md | 0 defects |
| Deployed verification | runs/change-01/output/deployed-verification.md | N/A (library; e2e is post-merge by the packhouse) |
| Revision review | runs/change-01/output/revision-review.md | done |
| Readable-code scorecard | runs/change-01/output/readable-code-scorecard.md | PASS 11/11 |
| Centrality scorecard | runs/change-01/output/centrality-scorecard.md | PASS 8/8 |
| Changed files | runs/change-01/output/changed-files.md | 6 files |
| Known issues / debt | runs/change-01/output/known-issues.md, technical-debt.md | 1 debt item |

## UI / browser proof
Draws nothing: this is a type/value-set change in a data-contract package with no screens, so there is no browser spec and no frames. (Org Admin's audit-log "app" filter gains a `ph` option only when Org Admin moves its own pin — its part-a change.)

## Manual verification
1. Steps: run `pnpm typecheck` then `pnpm test` with `TEST_DATABASE_URL` pointing at a throwaway Postgres. Expected: all green. Actual: green (re-run after a Postgres warm-up reset).
2. Steps: read `APP_CODES`, `AUDIT_APP_CODES`, `MASTER_READ_SCOPE`. Expected: `ph` present, scope `[legal_entity, site]`. Actual: as expected.

## Source-document amendments (Stage 07)
Decision logged in `source-documents/active/DECISION_LOG_CHANGE_CONTROL.md`. No rule, contract shape or workflow changed beyond the additive registry entry, so no other amendments.
