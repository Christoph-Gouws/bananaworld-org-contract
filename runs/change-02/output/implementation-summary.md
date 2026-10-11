# Implementation summary — CR-ORG-CONTRACT-002 (change-02)

Plan still fits the code (stations token, config accessor pattern and version constant all as cited). Built to the approved plan, v0.9.0, additive only:

- `src/capture/signed-capture.ts` (new, browser-safe): `bw-capture-v1\n` + canonical JSON message, `signCapture`, `verifyCaptureDeviceSignature` (ECDSA P-256 / SHA-256 / P1363, SPKI base64), and `decideCaptureAcceptance` (server clock, 0 to 90 minute grace after server-recorded expiry, revocation, offline sign-out sequence, dating clamp).
- `src/capture/drain-session.ts` (new, server): `verifySignedCapture` (device registered, floor-token signature without expiry, same device, device signature; person from the token only), `mintDrainSession` (at most 300 s, `bw_session: "drain"`, audience `bw-drain`, requires the caller to state its re-checks passed), `verifyDrainSession`, `isDrainSession`, `drainSessionDbClaims`.
- `src/config.ts`: optional `captureTokenKey`, `drainSessionSecret`; drain secret must differ from the station and capture keys.
- `src/index.ts`, `package.json` (subpaths `./signed-capture`, `./drain-session`; 0.8.1 to 0.9.0), `README.md`.
- 3 new unit test files. No SQL, no schema, no screen, no consumer pin bumped.

Added beyond the plan text: optional `issuedAt` on `mintDrainSession` (injectable clock, as `mintStationToken`).
