# Revision review — CR-ORG-CONTRACT-004 (Stage 05)

Reviewed: the new section of src/identity/person-read.ts, the barrel lines, both new test files.
Simplified: moved the 50-line SQL out of the function into `PAGE_PERSONS_SQL` (function-size sensor); reused `UUID_RE` and `escapeLike` rather than copying them.
Considered and rejected: sharing the limit-clamp with `listPersons` (different ceiling, and editing `listPersons` would touch an existing export); splitting normalisation into a helper (called once, would hide the parameter order that the unit test pins); adding an index (schema is not ours, not needed).
