# Test results + QA verdict — CR-ORG-CONTRACT-002 (change-02)

Date 2026-10-11. Branch `change/cr-org-contract-002`. Package v0.9.0.

## Commands and counts
| Command | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm exec vitest run tests/unit` | 12 files, 84/84 pass (3 new files: 28 new tests; 56 existing unchanged) |
| `pnpm exec vitest run tests/integration` (throwaway `postgres:16`, container `chg-cr-org-contract-002-pg`, removed after) | 6 files, 55/55 pass (existing suite, unchanged) |
| `prettier --check` on `src` and `tests/unit` | clean |

One test failed during the build (`verifySignedCapture` swallowed a missing-`captureTokenKey` config error into `capture_signature_invalid`). Fixed in `src/capture/drain-session.ts` (key lookup moved out of the try, so it fails closed). A first integration attempt against `localhost:5433` timed out on connect; it passed against `127.0.0.1:5433` with no code change.

## Acceptance criteria (plan §2, API-OFF-001)
| Criterion | Verdict | Test |
|---|---|---|
| AC-1 Canonical bytes are stable (golden vector, key order, rejects bad values and bad sequence) | MET | signed-capture.test.ts |
| AC-2 Device signature verifies; every tampered field fails; WebCrypto signature verifies via node:crypto IEEE-P1363 (packhouse's verifier) | MET | signed-capture.test.ts |
| AC-3 A device challenge signature never verifies as a capture | MET | signed-capture.test.ts |
| AC-4 Accepted 30 min after expiry and at exactly 90; refused at 91, also with the device clock set back | MET | capture-acceptance.test.ts |
| AC-5 Central revocation and offline sign-out sequence refuse | MET | capture-acceptance.test.ts |
| AC-6 Dating is the device time clamped to token validity; unparsable dates at issue time | MET | capture-acceptance.test.ts |
| AC-7 Grace outside 0..90 throws | MET | capture-acceptance.test.ts |
| AC-8 Unregistered device first; foreign key, other device, malformed or incomplete JWT refused; token expiry not enforced; person only from token (body person id ignored) | MET | drain-session.test.ts |
| AC-9 Drain session round-trip, 5-minute expiry, 300 s cap | MET | drain-session.test.ts |
| AC-10 `verifyStationToken` refuses a drain token (even under a shared secret); `verifyDrainSession` refuses a station token | MET | drain-session.test.ts |
| AC-11 Drain secret equal to station/capture key throws; unconfigured fails closed | MET | drain-session.test.ts |
| AC-12 Additive: no existing export, default or test changed | MET | existing 56 unit + 55 integration tests unchanged and green; `git diff` shows no removed lines in `src/` |

## Manual verification
Steps: run typecheck, unit and integration as above. Expected: all green. Actual: all green.

Not run, by design (plan §8): the end-to-end against the packhouse on staging. It needs the packhouse to build its drain endpoint (EPIC-002-M-01) first and is recorded against this change then. The staging migration rehearsal is not applicable: no SQL.

Overall QA verdict: PASS
