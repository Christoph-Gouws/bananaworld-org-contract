/**
 * The DEV-stub master data (API-STUB-001 / API-STUB-DEV-002, AG-ADR-006). In the
 * standalone RMS DEV sandbox the shared `org.*` layer is ABSENT, so the consumption
 * contract serves these in-memory fixtures instead — with the SAME `MasterRow` shapes the
 * central `org.v_master_*` views produce, so a consumer call site never branches on
 * environment (API-PRINCIPLE-008). `readMaster` filters + pages these identically to
 * central; the only difference (the central-side audit of a denial) is invisible to the
 * consumer, which is exactly the parity boundary.
 *
 * Representative, obviously-synthetic data (uuid-shaped ids prefixed `stub`) — never real
 * estate data. Kept small; it exercises shapes + filters, not scale. Field shapes mirror
 * the boundary views: station carries BOTH `site_id` and `asset_id` (one null per kind);
 * asset carries `stewardApp` ONLY when app-stewarded (an Org-Admin-stewarded asset omits
 * it — exactly as the central asset view's null `steward_app` is dropped).
 *
 * Pure data — no DB, no server-only imports.
 */

import type { MasterName, MasterRow } from "./types";

// Stable, obviously-synthetic uuid-shaped ids (the 4xxx/8xxx variant marks them stub).
const LE_DC = "0000stub-0000-4000-8000-00000000le01";
const LE_FARM = "0000stub-0000-4000-8000-00000000le02";
const LE_TRANSPORT = "0000stub-0000-4000-8000-00000000le03";
const SITE_DC = "0000stub-0000-4000-8000-0000000si0001";
const SITE_FARM = "0000stub-0000-4000-8000-0000000si0002";
const ASSET_DC_TRUCK = "0000stub-0000-4000-8000-0000000as0001";

export const STUB_MASTERS: Record<MasterName, readonly MasterRow[]> = {
  legal_entity: [
    { id: LE_DC, name: "Stub DC Operator", slug: "stub-dc-operator", status: "active" },
    { id: LE_FARM, name: "Stub Green Farms", slug: "stub-green-farms", status: "active" },
    { id: LE_TRANSPORT, name: "Stub Transport Co", slug: "stub-transport", status: "inactive" },
  ],
  entity_role: [
    {
      id: "0000stub-0000-4000-8000-0000000er0001",
      legal_entity_id: LE_DC,
      role_type: "dc_operator",
    },
    { id: "0000stub-0000-4000-8000-0000000er0002", legal_entity_id: LE_FARM, role_type: "farm" },
    {
      id: "0000stub-0000-4000-8000-0000000er0003",
      legal_entity_id: LE_TRANSPORT,
      role_type: "transport",
    },
  ],
  site: [
    { id: SITE_DC, legal_entity_id: LE_DC, site_type: "dc", name: "Stub Central DC" },
    { id: SITE_FARM, legal_entity_id: LE_FARM, site_type: "farm", name: "Stub Farm North" },
  ],
  asset: [
    // App-stewarded (a DC delivery truck) → carries stewardApp (API-RES-009).
    {
      id: ASSET_DC_TRUCK,
      legal_entity_id: LE_DC,
      asset_type: "truck",
      identifier: "STUB-DC-TRK-01",
      status: "active",
      stewardApp: "dc",
    },
    // Org-Admin-stewarded (a transport-company truck) → stewardApp OMITTED (null steward).
    {
      id: "0000stub-0000-4000-8000-0000000as0002",
      legal_entity_id: LE_TRANSPORT,
      asset_type: "truck",
      identifier: "STUB-TR-TRK-09",
      status: "active",
    },
  ],
  // ORPHAN stations only (DECISION-GATE-007): a farm bay + a transport truck-as-station.
  // No dc_bay (retired, migration #15) and no station on an app-stewarded asset — DC
  // stations live in DC's public.station.
  station: [
    {
      id: "0000stub-0000-4000-8000-0000000st0001",
      station_kind: "farm_bay",
      site_id: SITE_FARM,
      asset_id: null,
      code: "STUB-BAY-1",
      name: "Stub Farm Bay 1",
    },
    {
      id: "0000stub-0000-4000-8000-0000000st0002",
      station_kind: "truck",
      site_id: null,
      asset_id: "0000stub-0000-4000-8000-0000000as0002",
      code: "STUB-TRK-01",
      name: "Stub Truck 01",
    },
  ],
};
