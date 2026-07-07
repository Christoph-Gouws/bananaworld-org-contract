/**
 * Central-master OVERLAY helpers — the UUID-keyed batch reads + the fold rule every
 * consumer applies when it decorates its LOCAL operational rows with central identity
 * (name + active status). Canonicalised into the package at EPIC-008-M005 from DC's
 * post-M004 `central-masters.ts` (XSYS-DC-008, DECISION-GATE-012 — the link-key doctrine).
 *
 * LINK KEYS ARE UUIDs, ONLY (DECISION-GATE-013 choice 2 — estate-wide, no exceptions).
 * A local row links to its central master by the STABLE `org_*_id` UUID it carries:
 *   - company legal_entity: org_legal_entity_id → org.v_master_legal_entity.id
 *   - farm     site:        org_site_id         → org.v_master_farm.id
 *   - truck    asset:       org_asset_id        → org.v_master_asset.id
 *   - dc site (warehouse):  org_site_id         → org.v_master_site.id
 * A rename on either side can never break a link (the UUID is immutable).
 *
 * THE FIELD-SHAPE REALITY. The frozen views expose only the shared identity of a master,
 * by design (least-privilege, no PINs, no second copy):
 *   - v_master_legal_entity: id, name, slug, status → overlay NAME + ACTIVE.
 *   - v_master_farm:         id, code, name, status → overlay NAME + ACTIVE.
 *   - v_master_asset:        id, …, identifier, status → overlay ACTIVE (no name).
 *   - v_master_site:         id, …, site_type, name    → existence + NAME (no status).
 *
 * TWO fold semantics (DECISION-GATE-012, "loud-but-degraded"):
 *   - org_*_id IS NULL → the local row has NO central counterpart (a sandbox DC, a local-
 *     only truck) — a genuinely-optional overlay: keep the LOCAL identity (fail-OPEN, quiet).
 *   - org_*_id present but unresolved (a deleted master / a lost GRANT on the boundary
 *     view) → a BROKEN LINK: keep local identity so the list still renders (degraded), BUT
 *     report it LOUD (config.onUnresolvedCentralLink → the estate console.error/Sentry
 *     convention) and mark the row `unresolved` — never a silent stale value.
 *
 * App-side source TOGGLES (`*_MASTERS_SOURCE`, retired at M006) stay in the consumer:
 * these helpers overlay unconditionally; a consumer in `local` mode simply does not call.
 */

import type { Queryable } from "../queryable";
import { reportCentralReadFailure, reportUnresolvedCentralLink } from "../config";

// The central identity of one master, keyed by its central UUID `id`. `name` is null for a
// master whose frozen view carries no name (asset/truck); `active` is null for a view that
// carries no status (site/warehouse) — the fold treats null-active as "no central status ⇒
// leave local".
export interface CentralMasterIdentity {
  readonly name: string | null;
  readonly active: boolean | null;
}

// The result of folding a central identity onto a local row. `unresolved` is true ONLY for
// a BROKEN LINK (a populated org_*_id that did not resolve centrally) — never for a null
// link (local-only).
export interface FoldedIdentity {
  readonly name: string;
  readonly isActive: boolean;
  readonly unresolved: boolean;
}

// The central master kinds consumers overlay. Each maps to a frozen view.
export type CentralMasterKind = "legal_entity" | "farm" | "asset" | "site";

// Reads central legal-entity identities (companies) keyed by central `id`. Mirrors
// v_master_legal_entity (id, name, slug, status). `status='active'` → active.
async function readCentralLegalEntitiesById(
  client: Queryable,
  ids: readonly string[],
): Promise<Map<string, CentralMasterIdentity>> {
  const out = new Map<string, CentralMasterIdentity>();
  const { rows } = await client.query(
    `SELECT id::text AS id, name, status FROM org.v_master_legal_entity WHERE id = ANY($1::uuid[])`,
    [[...ids]],
  );
  for (const raw of rows as unknown as ReadonlyArray<{
    id: string;
    name: string;
    status: string;
  }>) {
    out.set(raw.id, { name: raw.name, active: raw.status === "active" });
  }
  return out;
}

// Reads central FARM identities keyed by central `id` (EPIC-008-M001). A farm is a site
// owned by a legal entity; the frozen v_master_farm view exposes id, code, name, status.
async function readCentralFarmsById(
  client: Queryable,
  ids: readonly string[],
): Promise<Map<string, CentralMasterIdentity>> {
  const out = new Map<string, CentralMasterIdentity>();
  const { rows } = await client.query(
    `SELECT id::text AS id, name, status FROM org.v_master_farm WHERE id = ANY($1::uuid[])`,
    [[...ids]],
  );
  for (const raw of rows as unknown as ReadonlyArray<{
    id: string;
    name: string;
    status: string;
  }>) {
    out.set(raw.id, { name: raw.name, active: raw.status === "active" });
  }
  return out;
}

// Reads central truck-asset identities keyed by central `id`. Mirrors v_master_asset (…,
// identifier, status). The view carries no name, so `name` is null (the consumer keeps the
// truck name local); central is authority for existence + active status only. Filtered to
// trucks (asset_type='truck').
async function readCentralTrucksById(
  client: Queryable,
  ids: readonly string[],
): Promise<Map<string, CentralMasterIdentity>> {
  const out = new Map<string, CentralMasterIdentity>();
  const { rows } = await client.query(
    `SELECT id::text AS id, status FROM org.v_master_asset
      WHERE asset_type = 'truck' AND id = ANY($1::uuid[])`,
    [[...ids]],
  );
  for (const raw of rows as unknown as ReadonlyArray<{ id: string; status: string }>) {
    out.set(raw.id, { name: null, active: raw.status === "active" });
  }
  return out;
}

// Reads central DC-site identities (warehouses) keyed by central `id`. Mirrors v_master_site
// (…, site_type, name), site_type='dc'. The view carries no status, so `active` is null
// (existence + name).
async function readCentralDcSitesById(
  client: Queryable,
  ids: readonly string[],
): Promise<Map<string, CentralMasterIdentity>> {
  const out = new Map<string, CentralMasterIdentity>();
  const { rows } = await client.query(
    `SELECT id::text AS id, name FROM org.v_master_site WHERE site_type = 'dc' AND id = ANY($1::uuid[])`,
    [[...ids]],
  );
  for (const raw of rows as unknown as ReadonlyArray<{ id: string; name: string }>) {
    out.set(raw.id, { name: raw.name, active: null });
  }
  return out;
}

// One entry point per kind — resolve a set of central UUID ids to their central identities.
// Keeps the per-view column knowledge HERE (the frozen-contract implementation) so callers
// only speak in {kind, ids} (API-PRINCIPLE-001, "one place reads the master"). Empty input
// short-circuits (no query).
//
// DEGRADE-NOT-CRASH (DECISION-GATE-012): a central read failure — most importantly a lost
// GRANT on a boundary view (permission denied) — must NOT 500 the whole page. We report it
// loud and return an empty map, so every keyed row folds to `unresolved` (local identity
// shown + each logged) and the list still renders. The "degraded" half of loud-but-degraded.
export async function readCentralMasterIdentities(
  client: Queryable,
  kind: CentralMasterKind,
  ids: readonly string[],
): Promise<Map<string, CentralMasterIdentity>> {
  if (ids.length === 0) return new Map();
  try {
    switch (kind) {
      case "legal_entity":
        return await readCentralLegalEntitiesById(client, ids);
      case "farm":
        return await readCentralFarmsById(client, ids);
      case "asset":
        return await readCentralTrucksById(client, ids);
      case "site":
        return await readCentralDcSitesById(client, ids);
    }
  } catch (error) {
    reportCentralReadFailure(kind, ids.length, error);
    return new Map();
  }
}

// Fold a central identity into a local {name, isActive} pair by the stable UUID link — the
// shared overlay rule, so every read path (generic repositories + option-pickers) applies
// it identically:
//   - linkId === null          → no central counterpart (local-only) → keep LOCAL, fail-open.
//   - linkId present, resolved  → name = central canonical name (or local when the view has
//                                 none), isActive = local AND central (never weaker;
//                                 centrally-retired drops).
//   - linkId present, MISSING   → BROKEN LINK → keep local for display (degraded) + report
//                                 loud + flag `unresolved`.
export function foldCentralIdentity(
  kind: CentralMasterKind,
  localName: string,
  localActive: boolean,
  linkId: string | null,
  central: ReadonlyMap<string, CentralMasterIdentity>,
): FoldedIdentity {
  if (linkId === null) return { name: localName, isActive: localActive, unresolved: false };
  const hit = central.get(linkId);
  if (hit === undefined) {
    reportUnresolvedCentralLink(kind, linkId);
    return { name: localName, isActive: localActive, unresolved: true };
  }
  const centralActive = hit.active === null ? true : hit.active;
  return { name: hit.name ?? localName, isActive: localActive && centralActive, unresolved: false };
}

// Overlay central identity onto a simple ACTIVE-only option-picker list. Replaces each
// row's display `name` with the central canonical name (when the frozen view has one) and
// DROPS a row that is inactive centrally (the picker contract is active-only). A row whose
// link is null (local-only) OR a broken link keeps its local name and STAYS in the picker
// (degraded — a broken link is reported loud by the fold, not hidden). `keyOf` returns the
// row's central link id (org_*_id), or null when the row has no central counterpart.
// `nameOf`/`withName` read + rewrite the row's name field so this works for pickers whose
// name lives under any property. The consumer's source toggle gates the CALL, not this
// helper (a `local`-mode consumer does not call).
export async function overlayCentralPicker<T>(
  client: Queryable,
  kind: CentralMasterKind,
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  nameOf: (row: T) => string,
  withName: (row: T, name: string) => T,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const keyed = rows.map((row) => ({ row, key: keyOf(row) }));
  const ids = [...new Set(keyed.map((k) => k.key).filter((k): k is string => k !== null))];
  const central = await readCentralMasterIdentities(client, kind, ids);
  const out: T[] = [];
  for (const { row, key } of keyed) {
    const folded = foldCentralIdentity(kind, nameOf(row), true, key, central);
    if (folded.isActive === false) continue; // centrally retired ⇒ out of the active picker
    out.push(folded.name === nameOf(row) ? row : withName(row, folded.name));
  }
  return out;
}
