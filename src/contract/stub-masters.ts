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
 * the boundary views: asset carries `stewardApp` ONLY when app-stewarded (an Org-Admin-stewarded
 * asset omits it — exactly as the central asset view's null `steward_app` is dropped).
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
  // v0.2.0 (Org Admin EPIC-008-M006): legal_entity carries the re-homed business fields
  // (functional_currency, default_language, registration_no, tax_no) — central master data
  // since org-admin migration #21 (DECISION-GATE-014 choice 2).
  legal_entity: [
    {
      id: LE_DC,
      name: "Stub DC Operator",
      slug: "stub-dc-operator",
      status: "active",
      functional_currency: "ZAR",
      default_language: "en",
      registration_no: null,
      tax_no: null,
    },
    {
      id: LE_FARM,
      name: "Stub Green Farms",
      slug: "stub-green-farms",
      status: "active",
      functional_currency: "ZAR",
      default_language: null,
      registration_no: null,
      tax_no: null,
    },
    {
      id: LE_TRANSPORT,
      name: "Stub Transport Co",
      slug: "stub-transport",
      status: "inactive",
      functional_currency: "ZAR",
      default_language: null,
      registration_no: null,
      tax_no: null,
    },
  ],
  // ('farm' left the entity-role value set at EPIC-008-M006 — a farm is a SITE; the
  // farm-operator company holds no role, exactly like production data.)
  entity_role: [
    {
      id: "0000stub-0000-4000-8000-0000000er0001",
      legal_entity_id: LE_DC,
      role_type: "dc_operator",
    },
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
  // v0.3.0: the LISTABLE farm master (v_master_farm — a farm site + its code; the id IS
  // the org.site id, so the farm stub mirrors SITE_FARM).
  farm: [
    {
      id: SITE_FARM,
      legal_entity_id: LE_FARM,
      code: "FARM-N",
      name: "Stub Farm North",
      status: "active",
    },
  ],
  // v0.7.0 (RMS EPIC-010-M004): `registration` (plate) + `description` (make/model) mirror the
  // central asset view's new columns — always present as keys (null when unset), matching the
  // central select which returns both columns for every row. The transport truck carries both
  // (Org Admin stewards it and stamps them); the DC delivery truck carries neither centrally —
  // DC keeps its plate/name in its own public.truck, and its central registration/description
  // are null (its steward never stamps them) — exactly as production data looks.
  asset: [
    // App-stewarded (a DC delivery truck) → carries stewardApp (API-RES-009).
    {
      id: ASSET_DC_TRUCK,
      legal_entity_id: LE_DC,
      asset_type: "truck",
      identifier: "STUB-DC-TRK-01",
      status: "active",
      stewardApp: "dc",
      registration: null,
      description: null,
    },
    // Org-Admin-stewarded (a transport-company truck) → stewardApp OMITTED (null steward).
    {
      id: "0000stub-0000-4000-8000-0000000as0002",
      legal_entity_id: LE_TRANSPORT,
      asset_type: "truck",
      identifier: "STUB-TR-TRK-09",
      status: "active",
      registration: "STUB-TR-09",
      description: "Stub Freightliner M2",
    },
  ],
  // `station` stub RETIRED at v0.6.0 (EPIC-008-M003, Station Partition Doctrine v2): stations are
  // no longer a central master (Org Admin hosts none; RMS owns its own in `rms.station`), so
  // `org.v_master_station` was dropped and the boundary no longer serves station reads.
};
