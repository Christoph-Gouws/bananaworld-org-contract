# Technical debt — CR-ORG-CONTRACT-001

- `ORG_CONTRACT_VERSION` in `src/index.ts:28` reads `"0.4.2"` while `package.json` is now `0.8.1` (drifted since 0.5.0, not bumped by any release). Left untouched: changing an exported constant's value is not additive. Needs its own owner-approved change with a consumer check.
