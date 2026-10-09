# Developer handover — CR-ORG-CONTRACT-001 (change-01)

**State:** built, tested green, PR to be opened from branch `change/cr-org-contract-001`. `@bananaworld/org-contract` is now v0.8.1: `ph` (Packhouse) is registered in `APP_CODES`, `AUDIT_APP_CODES` and `MASTER_READ_SCOPE` (`legal_entity` + `site`). Additive only; no consumer pin bumped; no schema or migration.

**Next agent / action (after merge):**
1. Org Admin part a (separate change): `org.app` row `ph`, CHECK supersets on `org.app.app_code` and `org.audit_log.app_code`, `packhouse` in `SITE_TYPES`, `APP_LABELS.ph`, update its four lockstep pin tests; pin the MERGED sha on main, never the branch sha.
2. Packhouse EPIC-001-M-04: pin the merged sha, run the API-CHG-008 end-to-end on staging once part a is live, and record the result against this change.
3. Packhouse Change Control: add the missing API-CHG-011 row to its API spec.

Artifacts: runs/change-01/output/ (implementation-summary.md, test-results.md, technical-debt.md); roll-up runs/change-01/evidence/milestone-evidence.md.
