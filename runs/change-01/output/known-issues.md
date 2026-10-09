# Known issues — CR-ORG-CONTRACT-001

- Plan premises re-checked against fresh main: every cited file/line matched. Nothing moved.
- Until Org Admin part a is live (org.app row `ph`, `org.app.app_code` and `org.audit_log.app_code` CHECK supersets), any `ph` read or PIN sign-in fails closed. By design.
- Org Admin's lockstep pin tests will fail by design when Org Admin bumps to this sha; it updates them in its own part-a change.
- `API_INTEGRATION_SPECIFICATION.md` (packhouse) has no API-CHG-011 row yet — packhouse Change Control's to add.
- `ORG_CONTRACT_VERSION` drift: see `technical-debt.md`.
