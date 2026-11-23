# Implementation summary — CR-ORG-CONTRACT-004

Plan premise check: `person-read.ts` (`findPersonsByIds` :58-71, `escapeLike` :175, `listPersons` :183, `UUID_RE` :16), `index.ts` re-export block and the stand-in `org.person` columns all still match the plan. Built as approved.

Added `pagePersonsByIds`, `PAGE_PERSONS_MAX_LIMIT` (200) and types `PagePersonsOptions`, `PagedPerson`, `PersonPage` to `src/identity/person-read.ts`, re-exported from `src/index.ts`. One statement over `unnest(ids)` left-joined to `org.person`, so only named ids can ever appear. Version 0.9.0 → 0.10.0, README bullet, two new test files. No SQL, no stand-in change, no existing line altered.
