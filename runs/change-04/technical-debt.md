# Technical debt — CR-ORG-CONTRACT-004

- `ORG_CONTRACT_VERSION` in `src/index.ts` is still `"0.4.2"` while `package.json` is 0.10.0. Changing an exported constant's value is not additive, so it is left alone (carried from runs/change-02/technical-debt.md). Needs its own coordinated decision.
