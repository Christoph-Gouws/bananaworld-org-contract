# Known issues — CR-ORG-CONTRACT-004

- `ORG_CONTRACT_VERSION` still `"0.4.2"` (see technical-debt.md).
- Order uses the database default collation; within a call the order is total (id tiebreak) so paging is exact, but punctuation/accent placement may differ between collations.
- Consumer repos were not searched in this session (outside the worktree); the plan's audit is relied on.
