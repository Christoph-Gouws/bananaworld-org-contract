# Developer handover — CR-ORG-CONTRACT-002 (change-02)

**State:** built and tested green; PR from branch `change/cr-org-contract-002`. `@bananaworld/org-contract` is v0.9.0: signed offline capture (`./signed-capture`, browser-safe) and the confined drain session (`./drain-session`, server). Additive only; no consumer pin bumped; no SQL.

**Next agent / action (after merge):**
1. Packhouse EPIC-002-M-01 pins the MERGED main sha (never the branch sha) and builds: the per-issued-token server record, the drain endpoint, `drain_session_confined` on every other endpoint and in database functions, the credential-inventory row, floor-worker wording for the capture codes, the missing API-CHG-011 row.
2. Then run the API-CHG-008 end-to-end on staging against the API-OFF-001 acceptance row and record the result against this change.
3. Shared offline queue (API-CHG-005) calls `signCapture` at enqueue, opt-in, with no DC behaviour change.
4. Open question for Org Admin: should the place door `org.ph_site_*` refuse `bw_session = 'drain'`?

Artifacts: runs/change-02/output/ (implementation-summary.md, test-results.md, known-issues.md); technical debt in runs/change-02/technical-debt.md; roll-up runs/change-02/evidence/milestone-evidence.md.
