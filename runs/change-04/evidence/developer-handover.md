# Developer handover — CR-ORG-CONTRACT-004

**Current state:** `pagePersonsByIds` built and tested on branch `change/cr-org-contract-004` (v0.10.0, additive, no SQL). Evidence: runs/change-04/output/test-results.md.

**Next agent / next action:** the conductor runs reviews, opens the PR, merges on green. **After merge: tag the MERGED main sha `v0.10.0` and push the tag** (never the branch sha, KI-M001E19-002). I did not tag or push a tag. Then CR-BANANAWORLD-PH-005 pins that sha/tag and adopts the read.

**Do not:** bump any consumer pin from this package's change; change `ORG_CONTRACT_VERSION` (debt, runs/change-04/technical-debt.md).
