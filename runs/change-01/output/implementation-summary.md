# Implementation summary — CR-ORG-CONTRACT-001

Plan still fits the code on fresh main (all cited files/lines verified); built as approved.

**Changes (v0.8.0 → v0.8.1, additive only):**
- `src/value-sets.ts`: `APP_CODES` + `ph`.
- `src/audit/standard.ts`: `AUDIT_APP_CODES` + `ph` (before `org`) so `AppCode ⊆ AuditAppCode` and Org Admin's `[...APP_CODES,"org"]` lockstep holds.
- `src/contract/scope.ts`: `MASTER_READ_SCOPE.ph = ["legal_entity","site"]` (owner-approved at plan gate).
- `package.json` 0.8.1; pin tests updated; 3 new `ph` integration tests.
- No `packhouse` site-type set exists in this package (Org Admin's part a). No migration, no schema change.

**Rule sites:** all three "change" sites plus the scope.ts:18 comment changed. Re-ran the plan's searches (`APP_CODES`, `AppCode`, `AuditAppCode`, `MASTER_READ_SCOPE`, `mv`) over `src`: every other hit reads the sets by reference or as a type (`master-read.ts:217`, `registry/apps.ts`, `contract/types.ts`, `auth/*`) and picks up `ph` automatically. No missed site; plan list unchanged.

**Additive proof:** typecheck clean; all 56 unit + 55 integration tests green with every pre-existing test unchanged apart from the three pin assertions that list the sets. Existing callers (plan §5.3): dc/crm/rms have zero references; mangaverde passes the literal `'mv'`, still valid; org-admin uses `AppCode` only as a parameter type (widening is safe) and its lockstep pin tests are intentionally updated in its own part-a change at its own pin. Nobody's pin was bumped here. Consumers pin the merged main sha.
