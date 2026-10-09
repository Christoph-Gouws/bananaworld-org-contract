# Test results — CR-ORG-CONTRACT-001

Command: `pnpm typecheck`; `pnpm test` (unit + integration) against a throwaway `postgres:16` container
(`chg-cr-org-contract-001-pg`, removed afterwards).

- typecheck: clean.
- Unit: 9 files, 56 tests passed.
- Integration: 6 files, 55 tests passed (includes 3 new `ph` tests in `contract-reads.test.ts`).
- Note: the first integration run hit `read ECONNRESET` in 3 files while the fresh Postgres was still warming up; the re-run was fully green with no code change.

## Acceptance criteria
| Criterion | Verdict |
|---|---|
| AC-1: `APP_CODES` contains `ph`; `AUDIT_APP_CODES` is a superset (`ph` before `org`) | MET (pin test + typecheck) |
| AC-2: `MASTER_READ_SCOPE.ph = [legal_entity, site]`; `ph` denied asset/farm/entity_role | MET (unit pin) |
| AC-3: `ph` reads `site` (incl. `site_type='packhouse'` filter) with an active `org.app` row | MET (integration) |
| AC-4: `ph` denied `asset`, audited with `app_code='ph'` | MET (integration) |
| AC-5: `ph` with no `org.app` row refused (fails closed) | MET (integration) |
| AC-6: No behaviour change for dc/crm/rms/mv | MET (all pre-existing tests unchanged and green) |

Manual verification: none needed (no UI).

Overall QA verdict: PASS
