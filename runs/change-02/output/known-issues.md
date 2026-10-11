# Known issues — CR-ORG-CONTRACT-002

- **Existing-caller audit, partly re-run.** The plan's consumer audit (DC, RMS, Org Admin, Mangaverde, CRM, ph) was done at planning. In this session reading the other repos was not permitted, so it was not repeated. Additivity is proven here instead: `git diff` shows no removed line in `src/`, the new `OrgContractConfig` fields are optional with no default, and the full existing suite is green. The reviewer or conductor may re-run the plan's search terms across the estate.
- **End-to-end on staging pending** the packhouse's drain endpoint (plan §8).
- Choices flagged by the plan: a token for another device and a bad or foreign JWT both return `capture_signature_invalid`.
- `ORG_CONTRACT_VERSION` still `"0.4.2"` (carried debt, see technical-debt.md).
- Plan premise: nothing moved; no stale references.
