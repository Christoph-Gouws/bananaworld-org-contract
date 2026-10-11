# Technical debt — CR-ORG-CONTRACT-002

- `ORG_CONTRACT_VERSION` in `src/index.ts` still reads `"0.4.2"` while `package.json` is `0.9.0` (carried from CR-ORG-CONTRACT-001). Changing an exported constant's value is not additive, so it is left for its own owner-approved change with a consumer check.
