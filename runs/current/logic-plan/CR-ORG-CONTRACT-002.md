# CR-ORG-CONTRACT-002: Logic plan for signed offline capture and the confined drain session

> Packhouse plan id **API-CHG-011 (part b)**: DLC-DEC-044 (bananaworld-ph), Gate 01 deviation D-05.
> Planned 2026-10-11. This session only plans. No code was written.

<!-- OWNER-BRIEF-START -->
**What you get.** A floor tablet can lose its internet and the work typed on it can still be trusted later. Each tablet stamps every entry with its own seal at the moment the entry is made. When the connection returns, the packhouse checks four things: the seal, that the tablet is still switched on, that the worker who made the entry is still allowed to do it, and that the entry is saved under that worker's name. It is never saved under whoever happens to be signed in later. An entry is refused if the worker signed out before making it, or if it arrives more than 90 minutes after the worker's sign-in ran out. This will be ready before the packhouse starts its next stage.

**Please confirm.**
1. This change is only the shared checking rules. The packhouse keeps its own tablet list and sign-in, and builds the step that sends waiting work in at the start of its next stage. That matches your earlier rulings.
2. The full test with the packhouse can only run after the packhouse builds that step. I'll record the result against this change at that point.

**Not included.** PINs (already decided). No screens. No change for the DC, sales, rental, Manga Verde or Org Admin.

**Risks.** Low. Nothing those systems use today changes.
<!-- OWNER-BRIEF-END -->

---

## 1. What the request asks, and what this repo actually owes

Request: device-key signed offline capture and the drain session of TA-OFF-008 / STI-DEV-005 / API-OFF-001. A registered floor device signs each queued action with its own key. The server replays a drained action under a confined drain session that can act only as the person who captured it, and only within the server-recorded grace window. PIN enrolment is out (DLC-DEC-047).

**Source trail read:** bananaworld-ph `DECISION_LOG_CHANGE_CONTROL.md` DLC-DEC-040 → DLC-DEC-083. The rulings that bear on this change are DLC-DEC-044, -046, -051, -068, -070 and -083. Also read: `TECHNICAL_ARCHITECTURE.md` TA-OFF-001..009 and the component table lines 51/54/69; `SECURITY_TENANT_ISOLATION.md` STI-DEV-001..007 with their acceptance rows (284–290); `API_INTEGRATION_SPECIFICATION.md` API-OFF-001 (line 212) and its acceptance row (361), API-CHG-005 (286) and API-CHG-008 (289); `runs/current/owner-rulings-epic-001.md` §D-05 (lines 56–78).

**Document gap, carried from CR-ORG-CONTRACT-001.** `API_INTEGRATION_SPECIFICATION.md` still has **no API-CHG-011 row**. API-CHG-008 names only 001–007 and 010. As the request instructs, this plan applies API-CHG-008's evidence bar (§8). Adding the row is the packhouse's own Change Control work and is not done from here.

### 1.1 Findings that shape the plan (searched, not assumed)

1. **The packhouse already owns every stateful piece. This package is left with the shared rules and the credential.**
   - Since DLC-DEC-068 and DLC-DEC-070 the packhouse owns its floor PIN, its devices (`packhouse.device` with the public key, status and revocation), its device sessions and its own station-bound floor token. The token is HS256, signed under a key derived from `PACKHOUSE_STATION_TOKEN_SECRET`, with claims `sub`, `device_id` and `device_session_id` (`bananaworld-ph/src/server/auth/station-session.ts:46,77-87`).
   - The packhouse does **not** use this package's `station-pin` / `station-token` flow. It imports only `./person-read` (`station-session.ts:3`) and never calls `configureOrgContract` (searched: no hit under `bananaworld-ph/src`).
   - So this change cannot write or read any packhouse table. Everything stateful is passed in by the caller. This is the package's established "caller supplies its own tables" pattern (`src/config.ts:51-68`).
2. **The device key format is already fixed by the packhouse, and the package must match it byte for byte.**
   - The key is ECDSA P-256 with SHA-256, the public half is SPKI DER in base64, and signatures use IEEE-P1363 encoding (`bananaworld-ph/src/client/floor/device-key.ts:9-10,44-46`; `src/server/auth/device-proof.ts:91-98`).
   - The device signs today's online challenge with the same key. A capture message therefore needs a domain-separation prefix so that a signature over one can never be accepted as the other (§2.1).
3. **The source documents put the drain session in this package.** TA-OFF-008, STI-DEV-005 and API-OFF-001 each say "`@bananaworld/org-contract` mint[s] a drain session". DLC-DEC-044 rejected "building them inside the packhouse". DLC-DEC-083 keeps the drain session "a confined credential, not a fifth" elevated path. So it grants no elevated write and runs under the person's own row-level security.
4. **Nothing exists in this repo today.** A case-insensitive search for `drain|capture|bw_session` in `src/` finds only the station marker (`src/auth/station-token.ts:12,20,57,89`).
5. **The four refusal codes already exist on the packhouse side** (`bananaworld-ph/src/server/errors/catalogue.ts:23-26`): `capture_expired`, `capture_token_revoked`, `drain_session_confined` and `capture_signature_invalid`. This package uses the identical literals. `device_not_registered` already exists there too (`device-proof.ts:62`). `not_permitted` stays the caller's code (role re-check).
6. **The existing station-token verifier already refuses any other marker** (`station-token.ts:89`, `payload.bw_session !== "station"` → null). A drain session carrying `bw_session: "drain"` can therefore never pass as an org-contract station token, even under a shared secret. A test will pin this.

## 2. Data model + scoping (what this package gains)

Everything is **new and additive**: two new modules, two new optional config accessors, new re-exports and two new subpaths. Nothing existing is renamed, removed, re-typed or re-defaulted. No `org.*` object is read or written, so no migration is needed. The org schema is not this lane's to change, and this change does not need it to.

### 2.1 `src/capture/signed-capture.ts`: isomorphic (browser and server)

Uses only WebCrypto (`globalThis.crypto.subtle`, available in browsers and in Node ≥ 20). It does **not** import jose, config, pg or `node:crypto`, so a browser bundle can take it through the `./signed-capture` subpath.

- **The envelope.** `CaptureEnvelope = { kind: "action" | "sign_out"; action: CanonicalJson | null; idempotencyKey: string; sequence: number; jwt: string; deviceTime: string }`.
  - These are the TA-OFF-008 fields. `sign_out` is the offline sign-out event, queued in the same sequence with `action: null`.
  - `deviceTime` is the device's ISO-8601 string, kept as a string so the signed bytes stay stable.
- **The canonical message.** `captureMessage(envelope): Uint8Array` returns the UTF-8 bytes of `"bw-capture-v1\n" + canonicalJson(envelope)`.
  - `canonicalJson` sorts object keys recursively and writes no whitespace.
  - It **throws** on `undefined`, non-finite numbers, bigint, functions, and objects that are not plain (Dates, Maps, class instances).
  - It also rejects a `sequence` that is not a positive safe integer.
  - The prefix contains a newline, and a device challenge never does (`device-proof.ts:57`, `base64url.mac`). So a challenge signature can never verify as a capture, and a capture signature can never verify as a challenge.
- **Device side.** `signCapture(privateKey: CryptoKey, envelope): Promise<string>` returns a base64 P1363 signature. It works with the packhouse's **non-extractable** key (STI-DEV-004).
- **Server side.** `verifyCaptureDeviceSignature(publicKeySpkiBase64, envelope, signatureBase64): Promise<boolean>`. It returns false and never throws on a malformed key or signature.
- **The acceptance rule (pure).** `decideCaptureAcceptance({ tokenRecord, sequence, deviceTime, receivedAt, graceMinutes })` returns either `{ ok: true, datingTime }` or `{ ok: false, code }`.
  - `tokenRecord = { issuedAt: Date; expiresAt: Date; revokedAt: Date | null; signedOutAtSequence: number | null }`. This is the **server's own record**, never the JWT's or the device's figures.
  - `receivedAt` is the server clock. The device's time is never used for acceptance.
  - `graceMinutes` must be an integer from 0 to `CAPTURE_GRACE_MAX_MINUTES` (= 90). Any other value throws, so a misconfiguration fails closed.
  - Checks, in order:
    1. `revokedAt` is set → `capture_token_revoked`.
    2. `signedOutAtSequence` is set and `sequence > signedOutAtSequence` → `capture_token_revoked`.
    3. `receivedAt > expiresAt + graceMinutes` → `capture_expired`.
    4. Otherwise `ok`, with `datingTime = clamp(deviceTime, issuedAt, expiresAt)` (TA-OFF-005). An unparsable `deviceTime` dates at `issuedAt`.
- **Constants:** `CAPTURE_GRACE_MAX_MINUTES = 90`, `CAPTURE_MESSAGE_PREFIX`, and `CAPTURE_REFUSAL_CODES = ["capture_expired","capture_token_revoked","capture_signature_invalid","device_not_registered"] as const`, with its `CaptureRefusalCode` type.

### 2.2 `src/capture/drain-session.ts`: server only (jose + config)

- **The full verification chain.** `verifySignedCapture({ envelope, signature }, device: { id; publicKeySpki: string | null; registered: boolean })` returns either `{ ok: true, capture: VerifiedCapture }` or `{ ok: false, code }`. The `device` facts are read by the caller from its own device record; `registered` means active with the key not revoked (STI-DEV-006). The steps run in the order TA-OFF-008 gives:
  1. `!device.registered || !device.publicKeySpki` → `device_not_registered`.
  2. JWT signature check: jose `compactVerify` with HS256 under the injected `captureTokenKey`. **Expiry is deliberately not enforced here.** The grace window in `decideCaptureAcceptance` takes its place, measured from the server record. Bad signature, wrong algorithm, malformed token, or missing `sub` / `device_id` / `device_session_id` / `iat` / `exp` → `capture_signature_invalid`.
  3. The JWT's `device_id` differs from `device.id` → `capture_signature_invalid`. This is the "copied to a second device" case.
  4. The device signature over `captureMessage(envelope)` fails → `capture_signature_invalid`.
  5. On success, `VerifiedCapture` holds `{ personId (from the JWT only), deviceId, deviceSessionId, tokenIssuedAt, tokenExpiresAt, kind, sequence, idempotencyKey, deviceTime }`. **No field of `envelope.action` is ever read for identity.** A person id in the action body is ignored by construction (API-OFF-001).
- **The drain session.** `mintDrainSession({ capture: VerifiedCapture, acceptance: AcceptedCapture, personStillPermitted: true, deviceStillRegistered: true, ttlSeconds? })` returns `{ token, expiresAt }`.
  - The two `true`-literal fields force the caller to state its drain-time re-checks (role + packhouse assignment, and the device) before it can mint. This is the order TA-OFF-008 requires.
  - `ttlSeconds` defaults to and is capped at `DRAIN_SESSION_MAX_SECONDS = 300`. Above 300 or below 1, it throws.
  - The token is HS256 under the injected `drainSessionSecret`, with `aud: "bw-drain"` and claims `{ sub: personId, role: "authenticated", person_id, device_id, device_session_id, capture_id: idempotencyKey, bw_session: "drain" }`.
- **Checking a drain session.**
  - `verifyDrainSession(token)` returns `DrainSessionClaims` or null. It checks signature, `aud`, the `bw_session === "drain"` marker, expiry and the required claims, and never throws on a malformed token (the `verifyStationToken` style).
  - `isDrainSession(token): Promise<boolean>` lets **every other endpoint** recognise a drain session and refuse it as `drain_session_confined`.
  - `drainSessionDbClaims(claims)` returns the claims object a host sets as its database session claims. It carries `bw_session: "drain"` so the host's database functions can refuse it.
  - Exported constants: `DRAIN_SESSION_MARKER = "drain"`, `DRAIN_SESSION_CONFINED = "drain_session_confined"` and `DRAIN_SESSION_MAX_SECONDS`.

### 2.3 `src/config.ts`: two new **optional** accessors (no default, fail closed at use)

- `captureTokenKey?: () => string | Uint8Array`. This is the key the host signs its station-bound floor JWT with. The packhouse passes its derived key bytes (`station-session.ts:46`).
- `drainSessionSecret?: () => string`. This is the drain-session HS256 key. If it equals the configured `stationTokenSecret` or `captureTokenKey`, `getDrainSessionSecret()` **throws**. That stops a drain session from being minted under a key that some other token reader also trusts.
- Getters: `getCaptureTokenKey()` and `getDrainSessionSecret()`, both using the existing `missing()` message.

### 2.4 Versioning and exports

- `package.json` goes from `0.8.1` to **`0.9.0`**: a new capability, additive, minor level (the v0.8.0 precedent).
- New subpaths: `./signed-capture` and `./drain-session`.
- The root barrel `src/index.ts` re-exports both modules.
- `src/standards.ts` is **left unchanged**. Its "importable from anywhere" contract is kept narrow. Browser code uses `./signed-capture`.
- `ORG_CONTRACT_VERSION` (`src/index.ts:28`) is **left as is**. It is the known drift debt from CR-ORG-CONTRACT-001, and changing an exported constant's value is not additive. The debt is carried forward in `runs/change-NN/technical-debt.md`.

## 3. Permission shape

- **No new permission is granted anywhere.** The drain session is not an elevated write (DLC-DEC-083). It is a short credential naming one person, one device, one device session and one capture. The host uses it to run that one action under that person's own row-level security.
- **Confinement has three layers. This package supplies the first two; the third is the host's.**
  1. A separate key: the drain secret must differ from every other token key, and the package enforces this.
  2. A distinct audience plus the `bw_session: "drain"` marker: `verifyStationToken` and the packhouse's `readToken` already refuse it. The packhouse's refusal comes from the separate key.
  3. Host database functions and endpoints refusing the `drain` marker (`drain_session_confined`). The packhouse implements this in EPIC-002.
- **Who checks role and assignment at drain time:** the packhouse, against its own `role_grant` and packhouse assignment (DLC-DEC-045). This package cannot see those tables, so the mint requires the caller to state that both re-checks passed.

## 4. Files expected to touch

| File | Change |
|---|---|
| `src/capture/signed-capture.ts` | **new**: envelope, canonical message, sign/verify, acceptance rule, constants |
| `src/capture/drain-session.ts` | **new**: `verifySignedCapture`, drain session mint/verify/recognise, database claims |
| `src/config.ts` | two optional accessors + two getters + the key-equality guard |
| `src/index.ts` | re-export block for both modules (comment-led, like the v0.8.0 block) |
| `package.json` | two subpath exports; version `0.9.0` |
| `README.md` | a "Signed offline capture + the drain session" section |
| `tests/unit/signed-capture.test.ts` | golden canonical-bytes vector; sign and verify with a WebCrypto P-256 key; tamper with each field and the check fails; a signature from WebCrypto verifies through `node:crypto` P1363, matching what the packhouse uses; challenge versus capture cross-acceptance refused |
| `tests/unit/capture-acceptance.test.ts` | the API-OFF-001 acceptance table: accepted at 30 min after expiry; refused at 91 min, including with the device clock set back; sign-out sequence; central revocation; dating clamp; grace bounds |
| `tests/unit/drain-session.test.ts` | mint and verify round trip; refused at 6 min; marker and audience; `verifyStationToken` refuses a drain token; `verifyDrainSession` refuses a station token; equal-secret guard; fails closed when unconfigured; the TTL cap; a body person id is ignored; a JWT under another key, or for another device, is refused |

**Not touched:** every existing `src/**` module except `config.ts` and `index.ts`; `src/standards.ts`; all existing tests; `tests/integration/*`. There is no database work. **No integration test is added**: the new code is pure apart from WebCrypto and jose.

## 5. Proving the additive claim (build session)

1. Run `pnpm typecheck`, `pnpm test:unit` and `pnpm test:integration` (throwaway Postgres): the full existing suite unchanged plus the three new unit files. This is this system's full regression under API-CHG-008.
2. **Existing-caller audit, done at planning and re-run at build.** Searched `OrgContractConfig`, `import * as … from "@bananaworld/org-contract"` and `configureOrgContract(`, plus the new names (`drainSession`, `DRAIN_SESSION`, `signCapture`, `verifySignedCapture`) to rule out collisions:
   - **bananaworld-dc, bananaworld-rms, bananaworld-org-admin, mangaverde:** each calls `configureOrgContract` once with an object literal (`src/lib/org-contract-config.ts`; MV `lib/org-contract-config.ts`). New **optional** interface fields leave those literals valid. No consumer types against `OrgContractConfig`, uses a namespace import, or uses `Required<…>`. No new name collides. **Byte-identical behaviour.**
   - **bananaworld-crm:** no `configureOrgContract`, no `OrgContractConfig`, no namespace import. Unaffected.
   - **bananaworld-ph:** imports `./person-read` only. Unaffected until it pins `0.9.0` in EPIC-002 and opts in.
   - **Station flow:** `mintStationToken` and `verifyStationToken` are not edited. A test proves a drain token is refused by `verifyStationToken`.
   - **Defaults:** none changed. The new accessors have no default and fail closed only when the new functions are called.
3. **No consumer pin is bumped** (lane rule). The packhouse pins the **merged main sha** at its EPIC-002 entry (never a branch sha, see KI-M001E19-002).

## 6. Cross-app intersection map (MANDATORY)

| Seam | Writer (owner) | Reader(s) | This change's role | Ordering / note |
|---|---|---|---|---|
| **S1 · capture message format** (prefix, canonical JSON, P-256/P1363) | **org-contract** (this change) | Device signer: packhouse floor client, through the shared offline queue (API-CHG-005). Server verifier: packhouse drain endpoint | **Owns it** | The device and the server must import the **same** pinned version. A format change later is a new `bw-capture-v2` prefix, never an edit to v1 |
| **S2 · device record** (public key, status, key revocation) | **Packhouse** (`packhouse.device`, DLC-DEC-046/070) | This package, through caller-passed facts | Reads, through the caller | No change |
| **S3 · floor token + server token record** (issue, expiry, revocation, offline sign-out sequence) | **Packhouse** (`device_session`; a per-token issue record is **new packhouse work** in EPIC-002, since today only `renewed_at` is kept) | This package (`verifySignedCapture`, `decideCaptureAcceptance`) | Verifies; the record is caller-passed | Packhouse EPIC-002 adds the record in its own schema (its own migration) |
| **S4 · drain session credential** | **org-contract** mints and verifies | Packhouse drain endpoint (accepts); every other packhouse endpoint and database function (refuses via the `drain` marker); packhouse credential inventory (lists it, `docs/CREDENTIAL_INVENTORY.md:16`) | **Owns** the token shape and marker | The refusals are the packhouse's EPIC-002 work |
| **S5 · cross-system functions run under a drain session** | **DC** (lot function, derivation function: API-GEN-010/011) and **Org Admin** (place door `org.ph_site_*`, DLC-DEC-083) | Read the actor from the session claim `person_id` | **None in this repo**. The claim name `person_id` matches what they read today | DC functions must **accept** a drain session (offline batch issue and dispatch). The Org place door has no reason to; the packhouse must never call setup functions under it. Whether the door should also refuse the `drain` marker is an **open question for Org Admin** (§9), not changed from here |
| **S6 · refusal codes** | **org-contract** (literals) | Packhouse error catalogue (`catalogue.ts:23-26`) and its en/pt copy | Owns the literals (already identical) | The packhouse copy for these codes says "This link has expired / was cancelled". That is wrong for a floor worker and should be fixed in packhouse EPIC-002 (§9) |
| **S7 · package pin** (merged sha) | **org-contract** publishes | Packhouse (EPIC-002 entry); DC, CRM, RMS, MV and Org Admin at will (nothing changes for them) | Owns it | Merge to main before anyone pins |

**The DC's own offline grace** (`bananaworld-dc/src/lib/auth/session-lifetime.ts:39`, `OFFLINE_GRACE_MINUTES = 15`) is a different, DC-only rule. It is **not** touched, and the DC does not adopt signed capture here. API-CHG-005 must move the queue "with no change to DC behaviour". Signing in the shared queue must therefore be opt-in, which is that change's design and not this one's.

**Cross-system change register:** neither this repo nor bananaworld-ph has `governance/CROSS_SYSTEM_CHANGE_REGISTER.md` (searched), so nothing is recorded there. The seams are recorded here and in the change's own record.

## Rule sites

**Rule:** when a piece of work captured offline on a floor device may be accepted, and whose name it is saved under.
- *Today:* no estate rule exists for signed offline capture. The packhouse has no offline queue yet. The DC has its own unsigned offline grace (15 minutes on the token lifetime), which is a separate rule.
- *After:* there is one estate rule in this package.
  - The action is accepted only with a valid floor-token signature and a device signature from the same registered, active device.
  - It is refused if the token was revoked, or if the action follows an offline sign-out.
  - It is refused when it is received more than the grace window (at most 90 minutes) after the server-recorded expiry. The device time is used only for dating, clamped to the token's validity.
  - It is saved only under the token's person, through a drain session of at most 5 minutes that is confined to the drain endpoint.

| Site | Action | Reason |
|---|---|---|
| `src/capture/signed-capture.ts` (new) | **change (create)** | the rule's single home |
| `src/capture/drain-session.ts` (new) | **change (create)** | the verification order and the confined credential |
| `src/auth/station-token.ts:20,57,89` (`bw_session` marker) | leave | already refuses any non-`station` marker, which is exactly the confinement we need. A test pins it |
| `bananaworld-ph/src/server/devices/constants.ts:12` `STATION_TOKEN_GRACE_MINUTES = 15` and `station-session.ts:78-79` | leave (**not this repo**) | the token **lifetime** grace (idle + 15, capped at 16 h, as API-OFF-001 requires), not the 90-minute drain grace. The two must not be merged |
| `bananaworld-ph/src/server/errors/catalogue.ts:23-26`; `src/i18n/en.json:34-41`, `pt.json:34-41` | leave (**not this repo**) | the codes match. The copy wording is packhouse EPIC-002 work (S6) |
| `bananaworld-dc/src/lib/auth/session-lifetime.ts:39` `OFFLINE_GRACE_MINUTES`; `src/lib/offline-queue/token-storage.ts:196-241` | leave (**not this repo**) | the DC's own unsigned rule. DC behaviour must not change (API-CHG-005) |
| `bananaworld-ph/src/server/auth/device-proof.ts:91-98`, `src/client/floor/device-key.ts:9-10` | leave (**not this repo**) | they define the key format this package matches. Not edited |
| Packhouse source docs TA-OFF-005/008, STI-DEV-005, API-OFF-001 | leave | they state the rule. This change implements it without amending them |

**Search terms used:** `drain|capture|bw_session` (case-insensitive, this repo `src/`); `capture_expired|capture_token_revoked|capture_signature_invalid|drain_session_confined|GRACE|bw_session` (bananaworld-ph `src`, `supabase`, `tests`); `grace|capture|drain|sequence` (bananaworld-dc `src/lib/offline-queue`); `OFFLINE_GRACE_MINUTES\s*=` (bananaworld-dc `src`); `namedCurve|generateKey\(` (bananaworld-ph `src`); `OrgContractConfig|import \* as \w+ from ["']@bananaworld/org-contract|configureOrgContract\(` (bananaworld-org-admin, -dc, -crm, -rms, mangaverde, -ph).

## 7. Is this an epic? No.

Within this repo the change is one capability in one coherent unit: about six source files and about 500 lines, with no database and no screen. Its natural parts are the capture format, the acceptance rule and the drain credential. That is three closely bound pieces of one module pair, not five standalone milestones. The **larger** body of work (the per-token record, the drain endpoint, the database-side confinement, the signed queue on the device and the floor screens' queued and refused states) is packhouse EPIC-002-M-01, which is already planned as an epic milestone there. `epicRecommended: false`.

## 8. API-CHG-008 evidence mapping

| Required | How this change meets it |
|---|---|
| Own change record | `runs/change-NN/` for CR-ORG-CONTRACT-002 (the runner assigns NN) |
| Owner approval | this logic-plan gate |
| Staging migration rehearsal | **Not applicable to this repo**: no SQL. The packhouse's EPIC-002 migration (token record, confinement) is rehearsed there |
| This system's full regression | typecheck + unit + integration (§5) |
| End-to-end against the packhouse on staging | Only possible **after** merge **and** after packhouse EPIC-002-M-01 builds the drain. It is run against the API-OFF-001 acceptance row (line 361) and recorded against this change record then (brief point (b)2) |

## 9. Steps (build session)

1. `signed-capture.ts` + its two unit test files: the golden vector, the P1363 interop check, and the acceptance table.
2. `drain-session.ts` + the config accessors + its unit tests (including the station-token cross-refusal).
3. Exports, subpaths, version `0.9.0`, README; run typecheck + the full suite; write the change record with the §5.2 caller audit re-run.

## 10. Open questions / debt

- **Owner (in brief):** confirm the split. This package holds the shared rules and the credential. The packhouse holds the device list, the token record and the drain endpoint (consistent with DLC-DEC-044/046/070).
- **Owner (in brief):** the end-to-end evidence is recorded after the packhouse builds EPIC-002-M-01 (ordering that cannot be avoided).
- **Chosen here, flagged for review:**
  - an action sent from a device other than the one in its token is refused as `capture_signature_invalid`. API-OFF-001 says only "refused".
  - a bad or foreign JWT is also `capture_signature_invalid`.
- **Packhouse EPIC-002 (not this repo):**
  - a per-issued-token server record (issue, expiry, revocation, offline sign-out sequence);
  - `drain_session_confined` in every non-drain endpoint and in the database functions that read `bw_session`;
  - the credential inventory row;
  - floor-worker wording for the capture codes (today it says "link");
  - the `API-CHG-011` row in `API_INTEGRATION_SPECIFICATION.md`.
- **Shared offline queue (API-CHG-005, not this repo):** call `signCapture` at enqueue, opt-in, with no DC behaviour change.
- **Org Admin (open question, no change from here):** should the place door `org.ph_site_*` refuse a session whose claims carry `bw_session = 'drain'`? The `org.*` schema is not this lane's.
- **Debt carried forward → `runs/change-NN/technical-debt.md`:** `ORG_CONTRACT_VERSION` is still `"0.4.2"` (`src/index.ts:28`).
- **Possible later addition (not now):** if the DC ever adopts signed capture, its floor token uses different claim names (`station_id`, `station_session_id`). A claim-name option could then be added additively.
