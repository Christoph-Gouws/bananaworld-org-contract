# CR-ORG-CONTRACT-004: Logic plan for the paged, id-limited people read (`pagePersonsByIds`)

> Needed by **CR-BANANAWORLD-PH-005** (packhouse People list at estate scale). The spec is copied from that change's plan §3 (`worktrees/CR-BANANAWORLD-PH-005/runs/current/logic-plan/CR-BANANAWORLD-PH-005.md:70-80`). It rests on packhouse owner answer 5, DLC-DEC-186.
> Planned 2026-11-23 · Solution Architect (lead) + QA and Test (planning) · Change Runner, headless.
> **This session only planned. Nothing was built, run or tested.** No source document, register, archive or other repo was edited.

<!-- OWNER-BRIEF-START -->
**What you'll be able to do.** This is the small addition to the company-wide people list that the packhouse People screen is waiting for. Once it's in, the packhouse can ask for one page of its own people at a time: their names in name order, how many there are in total, and a name search. It no longer has to fetch everyone's name on every page. It only ever gets back people the packhouse already has on its own list, so it can't be used to browse the whole company directory. Someone the packhouse lists who has no central record still shows up, with a blank name, so nobody silently drops off the count.

**Please confirm.** Once this is approved and finished, the final copy gets a version number (0.10.0), and the packhouse job uses that number. The number goes only on the final approved copy, never on a work-in-progress one.

**Not included.** No screens. Nothing changes for the distribution centre, sales, rental, Manga Verde or Org Admin unless they choose to use it later. The packhouse's own People screen change is a separate job, which runs after this one.

**Risks.** Low. It is a new addition only. Nothing anyone uses today changes.
<!-- OWNER-BRIEF-END -->

---

## 0. Orientation (verified this session)

| Fact | Where |
|---|---|
| The package is at **0.9.0** (`package.json:3`), last change CR-ORG-CONTRACT-002. No epic or milestone is open. | `runs/current/SESSION_HANDOVER.md`, `runs/current/active-milestone.md` |
| `findPersonsByIds` resolves a whole id list into a `Map` (one statement, malformed ids skipped, unresolved ids absent). `listPersons` is the active-only, search-first picker, capped at 50, with no offset and no total. Neither can page. | `src/identity/person-read.ts:58-71`, `:183-213` |
| `escapeLike` already exists (module-private) and escapes `\`, `%`, `_` for `escape '\'`. | `person-read.ts:175-177` |
| The integration stand-in `org.person` has `id, full_name (not null), email, login, status, home_legal_entity_id, auth_user_id`. Every column this read needs already exists. **No stand-in change and no schema change are needed.** | `tests/integration/setup.ts:43-52` |
| The root barrel re-exports the person reads by name, and `./person-read` is already a subpath. | `src/index.ts:74-87`; `package.json:61-64` |
| `ORG_CONTRACT_VERSION` is still `"0.4.2"`. This is known drift debt from CR-001/002, and changing an exported constant's value is not additive. It is **left as is** and carried forward. | `src/index.ts:28`; `runs/change-02/technical-debt.md` |
| The repo has **no** git tags referenced anywhere in its record (searched `\btag(ged|s)?\b`: no hit). This is the package's first release tag. | grep |
| Neither this repo nor bananaworld-ph has `governance/CROSS_SYSTEM_CHANGE_REGISTER.md`. | glob: no file (also PH-005 plan §0) |
| CI already runs format, typecheck, unit and integration against a throwaway `postgres:17`. A new integration file runs automatically. | `.github/workflows/ci.yml` |
| This repo has no project `CONTEXT.md`, `ANCHORS.md` or `FOUNDATION_QUICKREF.md`. The governing rules are this prompt's standing project rules and the change-control decision log. | glob |

## 1. What the request asks, and how it maps

One new **read-only** export beside `findPersonsByIds`:

```ts
pagePersonsByIds(db: Queryable, opts: PagePersonsOptions): Promise<PersonPage>
```

The package already reads `org.person` in one place (the file header, "ONE place that reads it"). This adds one more function to that same file. It writes nothing, adds no SQL migration, and touches no `org.*` object.

## 2. Data model + scoping

### 2.1 New exported types and constant (all new names)

```ts
/** Hard ceiling on a page — the design kit's largest page size (25/50/100/200). */
export const PAGE_PERSONS_MAX_LIMIT = 200;

export interface PagePersonsOptions {
  ids: readonly string[];      // the caller's own ids (its grant / membership set)
  nameContains?: string;       // optional "name contains", any case, LIKE-literal
  limit: number;               // clamped to 1..PAGE_PERSONS_MAX_LIMIT
  offset?: number;             // whole number >= 0; wins over focusId when given
  focusId?: string;            // used only when offset is NOT given
}

/** One listed person on a page. Least data: no email, no legal entity. */
export interface PagedPerson {
  personId: string;
  fullName: string | null;     // null when no central record exists for the id
  status: string | null;       // null when no central record exists for the id
  authUserId: string | null;   // null when no record, or the person has no browser login
}

export interface PersonPage {
  rows: PagedPerson[];
  total: number;               // matching ids (after nameContains), never the estate
  offset: number;              // the offset actually used (clamped)
}
```

`PersonSummary` and `CentralPerson` are **not** reused or widened. Their `fullName: string` / `status: string` are non-null, and changing them would alter an existing export. These are new, separate types.

### 2.2 Input normalisation (in TypeScript, before the statement)

| Input | Rule |
|---|---|
| `ids` | Keep only strings matching the existing `UUID_RE`, so a malformed id never reaches the `::uuid[]` cast and never raises a DB error. Duplicates are removed in JS (`Set`). Case-variant duplicates of the same uuid are also removed in SQL (`select distinct` after the cast). `personId` comes back as the canonical lowercase `id::text`. |
| no valid ids | Return `{ rows: [], total: 0, offset: 0 }` **without a statement**. This follows the `findPersonsByIds` precedent (`:64`). |
| `limit` | `Math.trunc`, with a non-number or `NaN` treated as 1, then clamped to `[1, 200]`. `Infinity` clamps to 200. This is the `listPersons` clamp style plus a NaN guard. |
| `offset` | `undefined` / `null` means **not given**. If given: `Math.trunc`, with `NaN` or a negative value becoming 0. A given offset always wins over `focusId`. |
| `focusId` | Used only when `offset` is not given. A malformed `focusId` is ignored (offset 0). |
| `nameContains` | Trimmed. Empty after trimming means no filter. Otherwise it is `escapeLike(term)` (the existing helper) and lower-cased **in SQL** (`lower($2)`). Both sides then go through Postgres's `lower()`, so JS and PG case-folding can never disagree. `escapeLike` output is unaffected by `lower`. |

### 2.3 The one statement (always exactly one answer row)

The shape is shown below. The build may tidy it, but the semantics are fixed:

```sql
with req as (
  select distinct u.id from unnest($1::uuid[]) as u(id)
), named as (
  select r.id,
         p.full_name, p.status, p.auth_user_id::text as auth_user_id,
         lower(coalesce(p.full_name, r.id::text)) as sort_key
    from req r
    left join org.person p on p.id = r.id                       -- unknown ids KEPT
), matched as (
  select n.*,
         row_number() over (order by n.sort_key, n.id) - 1 as pos,
         count(*)     over ()                              as total
    from named n
   where $2::text is null
      or n.sort_key like '%' || lower($2) || '%' escape '\'
), meta as (
  select coalesce(max(total), 0)::int as total,
         (select pos from matched where id = $5::uuid)        as focus_pos
    from matched
), used as (
  select total,
         case
           when total = 0 then 0
           when coalesce($4::int, (focus_pos / $3) * $3, 0) >= total
             then ((total - 1) / $3) * $3                     -- past the end → last page
           else coalesce($4::int, (focus_pos / $3) * $3, 0)
         end as off
    from meta
)
select u.total, u.off as "offset",
       coalesce(
         (select json_agg(json_build_object(
                   'personId', m.id::text, 'fullName', m.full_name,
                   'status', m.status, 'authUserId', m.auth_user_id)
                 order by m.pos)
            from matched m
           where m.pos >= u.off and m.pos < u.off + $3),
         '[]'::json) as rows
  from used u
```

Parameters: `$1` = valid ids, `$2` = the escaped term or null, `$3` = the clamped limit, `$4` = the normalised offset or null, `$5` = the valid focus id or null.

- **One statement, one row:** `used` always has exactly one row (an aggregate over `matched`), so a page past the end, an empty match, or a focus id that isn't found all still answer `{ rows, total, offset }`.
- **Order** is `lower(coalesce(full_name, id::text)), id`, exactly as the spec says. The `id` tiebreak makes it a total order, so paging is deterministic and covers each id exactly once.
- **Search** is matched against the same `sort_key`, so an id with no record is searchable by its id text, as the spec says. Status is **not** filtered: People lists switched-off people too (PH-005 D-3). `total` counts the **matching** ids only, the same scope as the rows (the kit's total-leak obligation).
- **`total`/`offset`** come back as Postgres `int` (cast), so `pg` yields JS numbers, not bigint strings. `rows` comes back as `json`, which `pg` parses. A defensive `?? []` is applied on read.
- **Size:** 2,000 or more uuids go in as one array parameter. Two window functions over ≤ N rows plus one indexed `org.person` probe per id (primary key) is trivial at this scale. No new index is needed or proposed. (The schema isn't ours anyway.)

### 2.4 Offset semantics (decided here; the spec leaves the edges open)

1. A **given `offset`** is used as is (it does not have to sit on a page boundary) while it still shows at least one row (`offset < total`).
2. A given offset **at or past the end** becomes the start of the last page: `floor((total-1)/limit)*limit`. This is "clamped to the last page".
3. **`focusId` without `offset`:** the offset is `floor(pos/limit)*limit` of that id's position in the **matched** set. If the focus id isn't in the matched set (not in `ids`, or filtered out by `nameContains`), the offset is **0** (the first page), never an error. The caller can tell from `rows` whether the focus id is on the page.
4. `total = 0` → offset 0, rows `[]`.

The packhouse's `?person=<id>` link (PH-005 D-7) already narrows the search to the picked name, so case 3's "not found → first page" matches what the operator expects there.

## 3. Permission shape

- **No permission is added or changed anywhere.** The read runs on the connection the caller passes in (`Queryable`), under whatever role and row-level security that connection carries, exactly like `findPersonsByIds` today. Nothing in this package elevates.
- **The least-privilege line (EPIC-008-M007 §D):** the statement's row source is `unnest($1)`, the caller's own ids. `org.person` is only **left-joined** to it. No predicate, empty filter, wildcard or oversized limit can make it return a person the caller did not name. `nameContains = '%'` is escaped and matches only a literal `%`. So the read **cannot enumerate the directory**, which is the same guarantee `listPersons` gives with search-first and its cap. A unit or integration test pins it: people seeded but not named never appear, and they never count in `total`.
- **Least data:** no `email`, `login` or `home_legal_entity_id` is selected.
- The caller decides **which** ids it may ask about (its grants or membership). That decision stays with the app, as OD-003 requires (identity here, permissions in the app).

## 4. Files expected to touch

| File | Change |
|---|---|
| `src/identity/person-read.ts` | **add** `PAGE_PERSONS_MAX_LIMIT`, `PagePersonsOptions`, `PagedPerson`, `PersonPage`, `pagePersonsByIds` in a new comment-led section after `findPersonsByIds` (or after the picker section). It **reuses** the private `UUID_RE` and `escapeLike` without editing them. No existing line changes. |
| `src/index.ts` | **add** the five names to the existing person-read re-export block (`:74-87`). Existing names, order and comments stay. `ORG_CONTRACT_VERSION` is untouched. |
| `package.json` | `"version": "0.9.0"` → **`"0.10.0"`** (new capability, minor, the v0.8.0/v0.9.0 precedent). **No** `exports` change: `./person-read` already covers it. |
| `README.md` | one bullet under "What it carries": the paged, id-limited read and its least-privilege line. |
| `tests/integration/page-persons.test.ts` | **new** (see §6) |
| `tests/unit/page-persons.test.ts` | **new**: a fake `Queryable` (the `tests/unit/list-persons.test.ts` style) pins the input normalisation without a DB |

**Not touched:** every other `src/**` module; `findPersonsByIds`, `listPersons`, `escapeLike`, `UUID_RE`, `LIST_PERSONS_*`; `tests/integration/setup.ts` (the 2,000-row seed is one `insert … select generate_series` inside the new test, not a harness change); every existing test; CI.

## 5. Proving the additive claim

### 5.1 The build runs
`pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, and `pnpm test:integration` against a throwaway Postgres (ENV-DEV-002). The full existing suite must pass **unchanged**, plus the two new files. The results go into `runs/change-NN/output/test-results.md` as run, with counts.

### 5.2 Existing callers checked at planning (re-run at build), and why each is unaffected
The search terms are listed in Rule sites. The pattern for this change: the only ways an *added* named export can change an existing caller are (a) a namespace import or `export *` that enumerates or re-exports the module, (b) a local name colliding with a new name, or (c) a full-module mock that a new import would need. None applies:

- **bananaworld-ph:** 31 files import named functions from `@bananaworld/org-contract/person-read` (`findPersonsByIds`, `findPersonById`, `findPersonByAuthId`, `listPersons`; e.g. `src/server/people/reads.ts:2`). There are no namespace imports and no collisions. Three unit tests `vi.mock('@bananaworld/org-contract/person-read', () => ({ findPersonsByIds: … }))` (`tests/unit/documents-day-sheets.test.ts:16`, `help-switches.test.ts:10`, `packout-layout.test.ts:11`). Those factories replace the module, and the code under them never imports the new name, so they are unaffected. They would matter only if PH adopts the new read in those modules (PH-005's concern, not this change's). PH is pinned at `91073b0` and is unaffected until PH-005 re-pins.
- **bananaworld-rms:** `vi.mock("@bananaworld/org-contract/person-read", …)` in `tests/unit/admin/actions.test.ts:24` and `tests/unit/auth/actor.test.ts:28`: same reasoning. No namespace import or collision in `src`.
- **bananaworld-crm:** `vi.mock(".../person-read")` in `tests/unit/unlinked-creator-name.test.ts:29`: same. No namespace import or collision.
- **bananaworld-dc, bananaworld-org-admin, mangaverde:** no namespace import, `export *`, collision or person-read mock (org-admin mocks only `./credential-repo`, `tests/unit/lifecycle-actions.test.ts:78`; MV only `./resolver`).
- **Inside the package:** `access-status.ts:36,85` calls `findPersonsByIds`, which is not edited. `listPersons` is not edited, and its unit pin (`tests/unit/list-persons.test.ts:44`, `LIST_PERSONS_MAX_LIMIT` = 50) stays green. The 200 ceiling is a **separate** constant for a separate read.
- **Defaults:** none changed. No config accessor is added. No export is removed, renamed or re-typed.
- **The version field:** `package.json` `version` is read by no consumer code (consumers pin by sha). The 0.9.0 → 0.10.0 bump is metadata only.

Result: **every existing caller in every consumer renders byte-identically**, because no code path they execute changes.

### 5.3 Pins and the release tag
- **No consumer pin is bumped** (lane rule). PH-005 re-pins in its own change.
- **The tag** `v0.10.0` goes on the **merged main commit**, after the PR merges, never on the branch sha (KI-M001E19-002). PH-005 D-1 checks that this tag exists at its build start. The build session does **not** create or push the tag (MWP §9.10: commit and push only on owner approval, and the merge is the conductor's). The change record (`runs/change-NN/evidence/developer-handover.md`) names the exact post-merge step: tag the merged main sha `v0.10.0` and push the tag. The brief's confirm point covers this.

## 6. Tests (QA and Test, planned, nothing run)

**Integration**, in `tests/integration/page-persons.test.ts` (fresh stand-in schema per test, skipped without `TEST_DATABASE_URL` like its siblings). These map one-to-one to the request's list:

| # | Request item | Test |
|---|---|---|
| T1 | order | Seed mixed-case names: page 1 is in `lower(name), id` order. Two people with the same name are ordered by id. An unknown id sorts by its id text among the names. The expected order is computed **by Postgres in the test** (`order by lower(...), id` over the same ids), so the assertion does not depend on the CI container's collation. |
| T2 | paging covers each id once | Walk every page at limit 7 over 50 ids: the concatenation equals the full ordered list, with no gaps and no repeats, and `total` is constant. |
| T3 | search with `%` and `_` literal | Names `"Fifty% Off"`, `"Under_Score"`, `"UnderXScore"`: `"y% o"` matches only the first, `"r_s"` matches only `Under_Score`, `"%"` alone matches only the `%` name. `total` follows the match. |
| T4 | past-the-end clamp | 23 ids, limit 10, offset 500: offset 20, 3 rows, total 23. Offset exactly 23 behaves the same. An unaligned in-range offset (e.g. 15) is kept. |
| T5 | focus page | 23 ids, limit 10: the focus on the 15th person by order gives offset 10, and that row is on the page. A focus id not in `ids`, or filtered out by `nameContains`, gives offset 0. A given offset beats the focus. |
| T6 | unknown ids kept | 2 random uuids with no record: they appear with `fullName/status/authUserId = null`, and `total` includes them. |
| T7 | malformed ids skipped | `["", "nope", "123", valid]`: no DB error, only the valid id is returned. Case-variant duplicates of one uuid and repeated ids count once. All-malformed gives `{rows:[], total:0, offset:0}`. |
| T8 | limit clamp | limit 0 → 1 row; 999 → 200 rows (over 250 ids); 2.7 → 2. |
| T9 | ≥ 2,000 ids in one call | 2,000 people seeded in one `generate_series` insert, plus 25 unknown ids, in one call at limit 200: `total` 2,025, 200 rows, last-page clamp correct, and a full walk at limit 200 covers all 2,025 once. |
| T10 | least privilege (extra, from §3) | 5 people seeded, 2 named: only the 2 return, `total` = 2, even with `nameContains` `"%"` or `""`. No email key appears on any row. |
| T11 | status not filtered (extra) | An `archived` person who is named is returned with `status: "archived"`. |

**Unit**, in `tests/unit/page-persons.test.ts` (fake `Queryable`): no query is issued for zero valid ids; parameter normalisation (limit clamp including NaN/Infinity, negative/NaN offset → 0, an absent offset passes null, a malformed focus passes null, a trimmed or blank term passes null, `%`/`_`/`\` are escaped); exactly **one** `db.query` call per invocation.

## 7. Cross-app intersection map (MANDATORY)

| Seam | Writer (owner) | Reader(s) | This change's role | Note |
|---|---|---|---|---|
| **S1 · the central people record** (`org.person`: name, status, login link) | **Org Admin** (every write; the estate's account desk) | This package (the one read place), and through it PH, DC, CRM, RMS, Org Admin, MV | **Reads only**: a new read over existing columns | No `org.*` change. Read-only, under the caller's connection |
| **S2 · the caller's listed set** (who an app lists: PH `packhouse.person` + `packhouse.role_grant`) | **The calling app** (PH System administrator) | This package, as caller-passed `ids` only | Reads the ids it is given. It never sees or queries the app's tables | The app decides who may be asked about (OD-003). The package cannot widen it |
| **S3 · the package release** (merged main sha + tag `v0.10.0`) | **org-contract** publishes | **PH** re-pins in CR-BANANAWORLD-PH-005 (D-1 waits for the tag). DC, CRM, RMS, Org Admin and MV may adopt at will; nothing changes for them | Owns it | Tag the **merged** sha, never a branch sha (KI-M001E19-002) |
| **S4 · the paged-read result shape** (`{rows,total,offset}`, the order and search rule) | **org-contract** (this change) | PH People page (PH-005 D-2/D-3; its contract test pins the shape, PH-005 §6) | Owns it | Any later shape change is additive only (new optional fields) |

No other seam: no write anywhere, no design-kit change, no DC/CRM function, no `public.*`/`crm.*`. **Cross-system change register:** there is none in this repo or in bananaworld-ph (searched), so nothing is recorded there. The seams are recorded here and in PH-005's plan §5.

## Rule sites

**Rule (new, additive):** *who an app may list from the central people record, and in what order.*
- **Today:** the only list-many read is `listPersons`. It is search-first (≥ 2 characters), active-only, capped at 50, with no paging, and it matches name or email. Everything else resolves people by id.
- **After:** that is unchanged, **plus** a second, separate rule for `pagePersonsByIds`. An app may page **only the ids it names**, at most 200 a page, any status, ordered `lower(coalesce(name, id)), id`, searched as "name (or id text) contains, any case, literally". Unknown ids are kept.

No existing rule is changed or retired.

| Site | Action | Reason |
|---|---|---|
| `src/identity/person-read.ts` (new section) | **change (create)** | the new rule's single home |
| `src/identity/person-read.ts:140-145` (`LIST_PERSONS_MIN_QUERY` / `_DEFAULT_LIMIT` / `_MAX_LIMIT` = 50) | leave | the picker's own rule. The 200 ceiling is a separate constant for a separate, id-bounded read. Raising 50 would widen the directory picker |
| `src/identity/person-read.ts:175-177` (`escapeLike`) | leave (reused) | the same literal-match rule, one definition |
| `src/identity/person-read.ts:183-213` (`listPersons`: `status = 'active'`, `like … escape '\\'`, `order by full_name asc, id asc`) | leave | the picker stays active-only, search-first and name+email. The new read orders by `lower(...)`, as the PH spec requires. The two orders are deliberately different reads |
| `src/identity/person-read.ts:16` (`UUID_RE`) | leave (reused) | the same malformed-id rule |
| `src/identity/person-read.ts:58-71` (`findPersonsByIds`) | leave | its behaviour (absent ids omitted from the Map) is relied on by `access-status.ts:85` and 25+ PH call sites |
| `src/auth/station-attribution.ts:18` (a second `UUID_RE` copy) | leave | pre-existing duplicate, outside this rule. Not touched in an additive change |
| `tests/unit/list-persons.test.ts:44`, `tests/integration/list-persons.test.ts:82-102` | leave | they pin the picker rule, which is unchanged |
| bananaworld-ph `src/server/people/reads.ts:26,63,83-96` (`byName`, the JS sort/filter/slice) | leave (**not this repo**) | retired by PH-005 when it adopts this read |

**Search terms used** (this repo `src/` + `tests/`): `escapeLike|UUID_RE|LIST_PERSONS_MAX_LIMIT|like .*escape|findPersonsByIds`. In each consumer repo (dc, crm, rms, org-admin, mangaverde, ph): `import \* as \w+ from ["']@bananaworld/org-contract|export \* from ["']@bananaworld/org-contract|pagePersonsByIds|PAGE_PERSONS|PersonPage\b|PagedPerson\b|PagePersonsOptions` (no hit anywhere); `mock\(["']@bananaworld/org-contract` (the hits are listed in §5.2); `from ["']@bananaworld/org-contract/person-read["']` (ph `src`, 31 hits, all named imports). Note for the reviewer: a recursive grep rooted at `teams/AI Dev Team 6/projects` returned nothing (ignore rules). Run these per repo, as done here.

## 8. Is this an epic? No.

It is one read function, its types and two test files: about 4 source files and about 150 lines, with no database, no screen and no new permission. No five milestones can be named. `epicRecommended: false`.

## 9. Steps (build session)

1. Add the types, constant and `pagePersonsByIds` to `person-read.ts`, the barrel lines, the unit test, and the integration test T1–T11. Run the full suite and iterate to green.
2. Bump `package.json` to 0.10.0, add the README bullet, re-run format, typecheck, unit and integration. Write `runs/change-NN/` (evidence, test results as run, the §5.2 caller audit re-run, and `technical-debt.md` carrying `ORG_CONTRACT_VERSION`), and the decision-log row. Hand the PR to the conductor. **Do not merge, tag or bump any pin from the session.**

## 10. Open questions / chosen here, flagged for review

- **Owner (in brief):** confirm the version mark `v0.10.0` goes on the merged commit after merge (the post-merge step in §5.3).
- **Chosen here (the spec leaves them open):**
  - an unaligned in-range offset is kept as given (§2.4 rule 1);
  - a focus id that is not found gives the first page (rule 3);
  - `nameContains` is trimmed, and a blank term means no filter (the `listPersons` precedent);
  - zero valid ids issue no statement (the `findPersonsByIds` precedent);
  - `personId` comes back as the canonical lowercase uuid text.
- **Collation (informational):** `order by lower(...)` follows the database's default collation. Within one call the order is consistent and total (id tiebreak), so paging is always correct. The exact placement of punctuation or accents can differ between a `C` and an `en_US` collation. PH-005 R-1 already carries "may sort slightly differently". T1 computes its expectation in Postgres so CI is collation-independent.
- **Debt carried forward → `runs/change-NN/technical-debt.md`:** `ORG_CONTRACT_VERSION` is still `"0.4.2"` (`src/index.ts:28`).
