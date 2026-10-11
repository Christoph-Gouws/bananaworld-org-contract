# Defect log — CR-ORG-CONTRACT-002

| # | Found | Defect | Status |
|---|---|---|---|
| 1 | build, own test | `verifySignedCapture` read `captureTokenKey` inside the try, so an unconfigured host got `capture_signature_invalid` instead of the fail-closed config error | fixed before commit; test `fails closed when captureTokenKey is not configured` pins it |

No open defects.
