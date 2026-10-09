# CR-ORG-CONTRACT-001 — Logic plan: register the packhouse (`ph`) as an estate consuming app

> Packhouse plan id **API-CHG-011 (part a, contract)** — DLC-DEC-044 (bananaworld-ph), Gate 01 deviation D-05.
> Planned 2026-10-09. Planning only — no code written in this session.

<!-- OWNER-BRIEF-START -->
**What you get.** The new packhouse system becomes a recognised member of the estate's shared sign-in and record-keeping layer. Once released, the packhouse can sign floor workers in with their personal PIN, have every sign-in and failed attempt written to the estate's history, and look up its own site. It must exist before the packhouse setup screen (packhouse milestone 1.4).

**Please confirm.**
1. The packhouse may look up only the company list and the site list. No trucks, no company roles, no farm records from here (it gets farms from the DC's lists, as already approved). Same allowance as Manga Verde.
2. The full test run with the packhouse on the test system can only happen after this is released and Org Admin has done its matching step. I'll record that result against this change then.

**Not included.** Adding "packhouse" as a site kind, and setting the packhouse up in Org Admin's records, are Org Admin's matching step, done separately. No other system changes. The DC, CRM, Rental and Manga Verde carry on exactly as today and pick this up whenever they choose.

**Risks.** Low. If the packhouse uses this before Org Admin's step is done, sign-in is refused. Nothing gets through by mistake.
<!-- OWNER-BRIEF-END -->

---

## 1. What the request asks, and what it actually needs

Request (verbatim intent): add app code `ph` to `APP_CODES` in `src/value-sets.ts`, and `packhouse` to any
site-type value set the contract carries, matching the Org Admin migration of API-CHG-011 part a, released
as a new pinned commit the packhouse can consume. No behaviour change for existing consumers.

Source trail read: bananaworld-ph `DECISION_LOG_CHANGE_CONTROL.md` DLC-DEC-040 → DLC-DEC-054 (DLC-DEC-044 is
the ruling that creates API-CHG-011); `runs/current/owner-rulings-epic-001.md` §D-05 (lines 58–64: "app code
`ph` is not registered (the `org.app.app_code` CHECK, and `APP_CODES` in bananaworld-org-contract/src/value-sets.ts)");
`EPIC-001.md` M-04 (line 66/74: the packhouse becomes an estate site through the setup flow, citing the
API-CHG-011 record). **Note:** `API_INTEGRATION_SPECIFICATION.md` has **no API-CHG-011 row yet** (rows stop at
API-CHG-010; its API-CHG-008 row names only 001–007 and 010). DLC-DEC-044 creates API-CHG-011 and points at
"API-CHG (new API-CHG-011)"; the API spec row is still to be added by the packhouse's own Change Control. This
plan applies API-CHG-008's evidence bar to it as the request instructs. This does not block the plan; it is
recorded as a packhouse-side document gap (§9).

### 1.1 Findings that shape the plan (searched, not assumed)

1. **The contract carries no site-type value set.** `SITE_TYPES` lives only in Org Admin
   (`bananaworld-org-admin/src/lib/org/value-sets.ts:27`). In this package `site_type` appears only as a
   pass-through column/filter (`src/contract/master-read.ts:77,79`), a DC-only overlay predicate
   (`src/masters/overlay.ts:129`), and DEV stub rows (`src/contract/stub-masters.ts:79-80`). The
   "`packhouse` site type" half of the request is therefore **a no-op in this repo**. It belongs wholly to
   Org Admin part a. `readMaster('site', {site_type: 'packhouse'})` already works unchanged once the DB
   admits the value.
2. **`APP_CODES` cannot grow alone. `AUDIT_APP_CODES` must grow with it, or the package does not compile.**
   `src/auth/station-pin.ts:51` types the caller as `AppCode | "org"` and passes it straight into
   `writeAppAudit` (`:134, :153, :220, :259`), whose `appCode` is `AuditAppCode`
   (`src/audit/app-writer.ts:27`). `station-session.ts:43,79` does the same with `AppCode`. So `AppCode` must
   stay assignable to `AuditAppCode`. Functionally, the packhouse's PIN sign-ins write `org.audit_log` rows
   with `app_code = 'ph'`. Org Admin's lockstep test also asserts
   `AUDIT_APP_CODES == [...APP_CODES, "org"]` (`bananaworld-org-admin/tests/unit/audit-standard.test.ts:40`).
3. **`MASTER_READ_SCOPE` must gain a `ph` entry.** It is `Record<AppCode, …>` (`src/contract/scope.ts:31`):
   TypeScript refuses a missing key, and the package's own test requires a non-empty entry per app
   (`tests/unit/contract-pins.test.ts:36-40`). Who-reads-what is an **owner decision** (scope.ts:13-15).
   That is brief point (b)1.
4. **Precedent: Manga Verde at v0.4.2** (`src/index.ts:24-27`) made exactly this three-set addition
   (`mv` → APP_CODES + AUDIT_APP_CODES + scope `["legal_entity","site"]`), with Org Admin carrying the
   `org.app` row and CHECK supersets. This change follows that shape.

## 2. Data model + scoping (what changes in this package)

No new types, no new functions, no new exports, no shape change to any frozen API (API-IDENT-001 /
API-MASTER-001). Three existing value sets each gain one member:

| Export | Today | After |
|---|---|---|
| `APP_CODES` (`src/value-sets.ts:17`) | `["dc","crm","rms","mv"]` | `["dc","crm","rms","mv","ph"]` |
| `AUDIT_APP_CODES` (`src/audit/standard.ts:22`) | `["dc","crm","rms","mv","org"]` | `["dc","crm","rms","mv","ph","org"]` (`ph` before `org`, keeping Org Admin's `[...APP_CODES,"org"]` lockstep) |
| `MASTER_READ_SCOPE` (`src/contract/scope.ts:31`) | 4 keys | + `ph: ["legal_entity", "site"]` (**recommended; owner confirms**, brief (b)1) |

Derived types widen accordingly: `AppCode` gains `"ph"`; `AuditAppCode` gains `"ph"`.

**Scope recommendation, `ph: ["legal_entity","site"]`, and why:**
- `site`: required. The packhouse links each packhouse to its estate site (DB-SEC-001, STI-WALL-002, M-04
  "each packhouse becomes an estate site") and needs to list `site_type='packhouse'` sites to do it.
- `legal_entity`: a site row carries only `legal_entity_id`. Showing which company a site belongs to on the
  setup screen needs the company name. This is the same grant as `mv`. Companies carry no sensitive fields.
- **Not** `farm`, `asset` or `entity_role`. Farms, items, container types and customers come from the DC's
  `public` masters by foreign key (TA-DATA-002, DB-MAS-001), not from `org`. Trucks and entity roles have no
  packhouse requirement. If the owner wants strict least privilege, `["site"]` alone also works. It costs
  the setup screen the company name.

**Comment updates (no code effect):** `value-sets.ts:13-16` (registration note for `ph`, API-CHG-011,
DLC-DEC-044), `audit/standard.ts:19-21` ("dc/crm/rms/mv" → "dc/crm/rms/mv/ph"), `scope.ts:18`
("APP_CODES = dc/crm/rms/mv") + a `ph` rationale comment on the new matrix row.

**Version:** `package.json` `0.8.0` → `0.8.1` (registry-key addition, patch level as `mv` was at 0.4.2).
`ORG_CONTRACT_VERSION` in `src/index.ts:28` reads `"0.4.2"`. It has drifted since 0.5.0 (not bumped by
any of the last four releases). **Leave it**: changing an exported constant's value is outside an
additive change, and fixing it is unrelated. Record it as debt in `runs/change-NN/technical-debt.md` (§9).

## 3. Permission shape

- **App gate** (`master-read.ts:217-219`): `ph` passes the `APP_CODES` membership check, then
  `assertActiveApp` still requires an **active `org.app` row `ph`**. Until Org Admin part a inserts it, a
  `ph` read fails closed. No code change. The gate reads the constant.
- **Scope gate** (`master-read.ts:223-225`): `ph` may read `legal_entity` and `site`. Any other master
  → `ForbiddenScopeError`, audited (central mode) with `app_code='ph'`.
- **PIN flow** (`station-pin.ts`, `station-session.ts`): `appCode: 'ph'` is attributed in `login`,
  `logout`, `auto_logoff` and `pin_failure` audit rows. The rows land in `org.audit_log` only once Org Admin
  part a extends `org.audit_log.app_code`'s CHECK. Before that, the audit insert fails and the sign-in
  transaction rolls back (fail closed).
- No change to who may write anything; this package grants no writes.

## 4. Files expected to touch

| File | Change |
|---|---|
| `src/value-sets.ts` | `APP_CODES` + `ph`; comment |
| `src/audit/standard.ts` | `AUDIT_APP_CODES` + `ph` (before `org`); comment |
| `src/contract/scope.ts` | `MASTER_READ_SCOPE.ph`; header comment line 18; row comment |
| `package.json` | version `0.8.1` |
| `tests/unit/contract-pins.test.ts` | pins: APP_CODES (`:21-23`), matrix (`:28-34`), AUDIT_APP_CODES (`:51`); add `ph` deny/allow assertions |
| `tests/integration/contract-reads.test.ts` (or a sibling) | `ph` read of `site` allowed with an active `org.app` row; `ph` read of `asset` denied + audited with `app_code='ph'`; `ph` with no `org.app` row refused |

`tests/integration/setup.ts` org.app seed (`:183-187`): **leave as is.** It already omits `mv`. The new
`ph` test inserts its own `org.app` row locally, so existing tests' fixtures stay unchanged.

Not touched: `src/index.ts`, `src/standards.ts` (both already re-export the three symbols; the export
*surface* is unchanged), README, every `src/auth/*`, `src/masters/*`, `src/stations/*`, `src/identity/*`.

## 5. Proving the additive claim (build session)

1. `pnpm typecheck` (or `tsc --noEmit`). This proves `AppCode ⊆ AuditAppCode` and scope-matrix totality.
2. `pnpm test:unit` and `pnpm test:integration` (throwaway Postgres; full suite = this system's regression
   under API-CHG-008).
3. **Existing-caller audit (done at planning, re-run at build).** Searched every consumer repo for
   `APP_CODES|AppCode|MASTER_READ_SCOPE|AUDIT_APP_CODES|AuditAppCode|appMayReadMaster`:
   - **bananaworld-dc, bananaworld-crm, bananaworld-rms:** zero references. Nothing in their code reads the
     changed sets, so they behave and render byte-identically at any future pin.
   - **mangaverde:** one comment only (`lib/org-contract-config.ts:26`). It passes the literal `'mv'`, which
     stays valid. Byte-identical.
   - **bananaworld-org-admin:** `src/lib/org/value-sets.ts:43` re-exports. `resolve-from-session.ts:34`
     uses `AppCode` as a parameter type only (widening is safe; no exhaustive switch or `Record<AppCode,…>`).
     Its pin tests (`value-sets.test.ts:51`, `audit-standard.test.ts:36,40`,
     `consumption-scope.test.ts:33-52`, `audit-actions.test.ts:157` live-CHECK equality) **will fail by
     design** when Org Admin bumps to this sha. That is their purpose (lockstep tripwires). They are updated
     in Org Admin's own part-a change together with the migration. The **one rendered difference**: the
     audit-log "app" filter (`app/(console)/audit/page.tsx:106`) lists `AUDIT_APP_CODES`, so it gains a
     `ph` option. `appLabel` falls back to `"PH"` (`src/lib/audit/entry.ts:110-111`) unless part a adds a
     `Packhouse` label. This appears only when Org Admin moves its pin in part a, which is that change's
     intended outcome. It is not a side effect on an existing caller at its current pin.
   - **bananaworld-hub:** not a registered app; no references.
4. No consumer pin is bumped by this change (lane rule). Consumers move against the **merged sha on main**.

## 6. Cross-app intersection map (MANDATORY)

| Seam | Writer (owner) | Reader(s) | This change's role | Ordering |
|---|---|---|---|---|
| **S1 · app registry**: `org.app` row `ph` + `org.app.app_code` CHECK | **Org Admin** (part a migration, owner-applied) | org-contract `assertActiveApp`; every app's gate | Describes it (`APP_CODES`) | Contract merges **first**; Org Admin part a pins the merged sha in the same change as its migration |
| **S2 · audit app code**: `org.audit_log.app_code` CHECK + `org.audit_write_app` | **Org Admin** (CHECK superset, part a); rows written **by the packhouse** through this package's writer | Org Admin audit viewer (federated timeline) | Describes it (`AUDIT_APP_CODES`) | Packhouse PIN sign-in fails closed until part a's CHECK is live |
| **S3 · site type**: `org.site.site_type` `packhouse` + `SITE_TYPES` | **Org Admin** (part a) | Packhouse via `readMaster('site')` | **None.** The contract carries no site-type set; the filter passes through | Packhouse M-04 needs part a live on staging |
| **S4 · master-read scope** `ph` → legal_entity, site | **org-contract** (this change; owner-approved matrix) | Packhouse (reads); Org Admin consumption-scope pin test | Owns it | Owner confirms at this gate |
| **S5 · package pin**: the merged sha | **org-contract** publishes | Packhouse (M-04), Org Admin (part a), later DC/CRM/RMS/MV at will | Owns it | Merge to main before anyone pins; no branch sha (KI-M001E19-002) |

DC, CRM, RMS and Manga Verde: **no seam touched.** They do not read any changed set (§5.3).
**Cross-system change register:** neither this repo nor bananaworld-ph has a
`governance/CROSS_SYSTEM_CHANGE_REGISTER.md`, so nothing is recorded there. The seams are recorded here
and in the change's own record.

## Rule sites

**Rule (permission):** which systems the estate recognises, and which shared master lists each may read.
- *Today:* recognised = DC, CRM, RMS, Manga Verde (+ Org Admin for audit). The packhouse is unrecognised, so
  every read is refused at the app gate and its audit rows cannot be attributed.
- *After:* the packhouse (`ph`) is also recognised (still subject to an active `org.app` row), may read
  `legal_entity` + `site` only, and its auth events are attributed `ph`.

| Site | Action | Reason |
|---|---|---|
| `src/value-sets.ts:17` | **change** | the registry itself |
| `src/audit/standard.ts:22` | **change** | must stay a superset of APP_CODES (type + Org Admin lockstep) |
| `src/contract/scope.ts:31-46` | **change** | add `ph` row |
| `src/contract/scope.ts:18` | **change** (comment) | names the current set |
| `src/contract/master-read.ts:217` | leave | reads `APP_CODES` by reference, so it picks up `ph` automatically |
| `src/contract/master-read.ts:219` (`assertActiveApp`) | leave | DB-row gate. The `org.app` row is Org Admin's (S1) |
| `src/contract/master-read.ts:223` | leave | reads the matrix by reference |
| `src/auth/station-pin.ts:51,191`; `src/auth/station-session.ts:30,64` | leave | typed `AppCode`; widen automatically |
| `src/registry/apps.ts:69` | leave | casts DB rows to `AppCode`; `ph` row becomes representable |
| `src/contract/types.ts:30,62` | leave | `appCode: AppCode` fields; widen automatically |
| `src/masters/overlay.ts:121,129` (`site_type = 'dc'`) | leave | the DC-site overlay must **not** start returning packhouse sites |
| `src/contract/stub-masters.ts:79-80` | leave | adding a stub packhouse site would change DEV-stub `site` output for every existing app (not additive) |
| `tests/unit/contract-pins.test.ts:21-23, 28-34, 51` | **change** | pins of the old sets |
| `tests/integration/setup.ts:183-187` | leave | the new test seeds its own `ph` row; existing fixtures stay identical |
| Org Admin `src/lib/org/value-sets.ts:27` (`SITE_TYPES`), `site-form.tsx:26`, `value-sets.test.ts:29,51`, `audit-standard.test.ts:36,40`, `consumption-scope.test.ts:33`, `audit-actions.test.ts:157`, `src/lib/audit/entry.ts:110` (`APP_LABELS`) | leave (**not this repo**) | Org Admin part a's sites. Listed so that change can find them |

**Search terms used:** `APP_CODES`, `AppCode\b`, `AUDIT_APP_CODES`, `AuditAppCode`, `MASTER_READ_SCOPE`,
`appMayReadMaster`, `site_type|siteType|SITE_TYPE`, `packhouse`, `SITE_TYPES`, `function appLabel`. The
searches covered this repo (excl. node_modules) and each of bananaworld-org-admin, -dc, -crm, -rms and
mangaverde (`--type ts`).

## 7. API-CHG-008 evidence mapping

| Required | How this change meets it |
|---|---|
| Own change record | `runs/change-NN/` for CR-ORG-CONTRACT-001 (NN assigned by the runner; this repo has no `runs/` yet) |
| Owner approval | this logic-plan gate (incl. the scope matrix, a who-reads-what decision) |
| Staging migration rehearsal | **N/A to this repo.** It ships no migration. The rehearsal belongs to Org Admin part a |
| This system's full regression | typecheck + unit + integration suites (§5) |
| End-to-end vs the packhouse on staging | Only possible **after** merge (packhouse must pin the merged sha) **and** Org Admin part a on staging. Recorded against this change record when the packhouse M-04 runs it (brief (b)2) |

## 8. Steps (build session)

1. Value sets + scope row + comments + version bump (4 source files).
2. Pin-test updates + `ph` integration tests; run typecheck + full suite; write the change record with the
   caller audit of §5.3 re-run.

## 9. Open questions / debt

- **Owner (in brief):** scope `["legal_entity","site"]` vs `["site"]`. Recommendation: the former.
- **Owner (in brief):** e2e evidence recorded post-merge (unavoidable ordering).
- **Packhouse doc gap:** `API_INTEGRATION_SPECIFICATION.md` lacks an API-CHG-011 row, and API-CHG-008/EVID-007
  don't list it. That belongs to packhouse Change Control. Not written from here.
- **Debt → `runs/change-NN/technical-debt.md`:** `ORG_CONTRACT_VERSION` (`src/index.ts:28`) stuck at
  `"0.4.2"` while package.json is `0.8.0`.
- **Org Admin part a** (separate change, not planned here) must: add the `org.app` row `ph`, extend the
  `org.app.app_code` CHECK, extend the `org.audit_log.app_code` CHECK, extend the `org.site.site_type` CHECK +
  `SITE_TYPES` with `packhouse`, add `APP_LABELS.ph`, and update its four pin tests. It pins this change's
  **merged** sha.
