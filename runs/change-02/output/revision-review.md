# Revision review (Stage 05) — CR-ORG-CONTRACT-002

**Reviewed:** the 7 code/test files in changed-files.md. Quality sensors: 0 open findings; both scorecards PASS.

**Simplified:**
- The key lookups in `verifySignedCapture` and `verifyDrainSession` sit before the try, so config errors propagate and malformed tokens return null, mirroring `verifyStationToken`.
- `mintDrainSession` takes an optional `issuedAt`, like `mintStationToken`, so the clock is injectable.

**Considered and rejected:**
- Reusing `station-token.ts` for the drain token: it is hard-wired to station claims and the station secret. The plan leaves that file untouched to stay additive.
- A shared base64 helper with the packhouse: the package must not depend on it. The two 3-line helpers stay local to the isomorphic module.
- Putting `signed-capture` in `standards.ts`: that contract is kept narrow. Browsers use the `./signed-capture` subpath.

**Plan fit:** the plan's cited lines were all as described on a fresh `main` (`station-token.ts:20,57,89`, `config.ts` accessor pattern, `index.ts:28`). Rule-site searches (`drain|capture|bw_session`, case-insensitive, `src/`) re-run: only the new files, `index.ts`, `config.ts` and the untouched `station-token.ts` match (plus an unrelated comment in `credential-repo.ts`). No missed site.
