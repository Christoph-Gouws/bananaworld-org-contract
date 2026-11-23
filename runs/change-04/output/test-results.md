# Test results — CR-ORG-CONTRACT-004

Commands (throwaway postgres:16 on port 5439, container removed afterwards):
- `pnpm typecheck` — clean. `pnpm format:check` — clean.
- `pnpm test:unit` — 13 files, 90/90 passed (6 new in tests/unit/page-persons.test.ts).
- `TEST_DATABASE_URL=… pnpm test:integration` — 7 files, 66/66 passed (11 new in tests/integration/page-persons.test.ts; the 55 existing pass unchanged).

## Acceptance criteria
| Criterion | Test | Verdict |
|---|---|---|
| AC-1: order `lower(coalesce(name,id)), id` | T1 | MET |
| AC-2: paging covers each id once | T2 | MET |
| AC-3: search with `%` `_` literal | T3 | MET |
| AC-4: past-the-end clamp, offset used reported | T4 | MET |
| AC-5: focus page; offset wins over focus | T5 | MET |
| AC-6: unknown ids kept with nulls | T6 | MET |
| AC-7: malformed skipped, duplicates removed | T7 + unit | MET |
| AC-8: limit clamp 1..200 | T8 + unit | MET |
| AC-9: 2,000+ ids in one call | T9 (2,025 ids) | MET |
| AC-10: never lists an unnamed person; no email | T10 | MET |
| AC-11: status not filtered | T11 | MET |
| AC-12: additive, no existing export changed | existing 55 integration + 84 unit unchanged green | MET |

## Existing-caller check (additive claim)
Package-local re-run of the plan's searches (`escapeLike|UUID_RE|LIST_PERSONS_MAX_LIMIT|findPersonsByIds`): only person-read.ts, access-status.ts, index.ts, station-attribution.ts (own UUID_RE copy) and list-persons unit test; none edited except by addition. Consumer repos (dc, crm, rms, org-admin, mangaverde, ph) are outside this worktree and were not re-searched; I rely on the plan's audit (no namespace import, `export *`, name collision, and the vi.mock factories never import the new name). A new named export cannot change a caller that does not import it.

Overall QA verdict: PASS
