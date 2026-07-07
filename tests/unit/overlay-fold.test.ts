/**
 * The M004 fold rule + picker overlay — pure paths with a fake client, incl. the
 * loud-but-degraded telemetry hooks (DECISION-GATE-012).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureOrgContract,
  resetOrgContractConfig,
  foldCentralIdentity,
  overlayCentralPicker,
  readCentralMasterIdentities,
  type CentralMasterIdentity,
  type Queryable,
} from "../../src/index";

const LINK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => resetOrgContractConfig());

describe("foldCentralIdentity (loud-but-degraded, DECISION-GATE-012)", () => {
  const central = new Map<string, CentralMasterIdentity>([
    [LINK_A, { name: "Central Name", active: false }],
  ]);

  it("null link = local-only → keep local, QUIET (fail-open)", () => {
    const hook = vi.fn();
    configureOrgContract({ onUnresolvedCentralLink: hook });
    expect(foldCentralIdentity("legal_entity", "Local", true, null, central)).toEqual({
      name: "Local",
      isActive: true,
      unresolved: false,
    });
    expect(hook).not.toHaveBeenCalled();
  });

  it("resolved link → central name, active = local AND central", () => {
    expect(foldCentralIdentity("legal_entity", "Local", true, LINK_A, central)).toEqual({
      name: "Central Name",
      isActive: false,
      unresolved: false,
    });
  });

  it("null central status (site view) → leave local active; null central name (asset) → keep local name", () => {
    const site = new Map([[LINK_A, { name: "Central Site", active: null }]]);
    expect(foldCentralIdentity("site", "Local WH", true, LINK_A, site)).toEqual({
      name: "Central Site",
      isActive: true,
      unresolved: false,
    });
    const asset = new Map([[LINK_A, { name: null, active: true }]]);
    expect(foldCentralIdentity("asset", "Truck 9", true, LINK_A, asset)).toEqual({
      name: "Truck 9",
      isActive: true,
      unresolved: false,
    });
  });

  it("BROKEN link → keep local, flag unresolved, report LOUD via the hook", () => {
    const hook = vi.fn();
    configureOrgContract({ onUnresolvedCentralLink: hook });
    expect(foldCentralIdentity("farm", "Local Farm", true, LINK_B, central)).toEqual({
      name: "Local Farm",
      isActive: true,
      unresolved: true,
    });
    expect(hook).toHaveBeenCalledWith("farm", LINK_B);
  });
});

describe("readCentralMasterIdentities — degrade-not-crash", () => {
  it("a central read failure reports loud and returns an EMPTY map (the list still renders)", async () => {
    const failHook = vi.fn();
    configureOrgContract({ onCentralReadFailure: failHook });
    const broken: Queryable = {
      async query() {
        throw new Error("permission denied for view v_master_farm");
      },
    };
    const map = await readCentralMasterIdentities(broken, "farm", [LINK_A, LINK_B]);
    expect(map.size).toBe(0);
    expect(failHook).toHaveBeenCalledWith("farm", 2, expect.any(Error));
  });

  it("empty input short-circuits without touching the db", async () => {
    const neverDb: Queryable = {
      async query() {
        throw new Error("must not query");
      },
    };
    expect((await readCentralMasterIdentities(neverDb, "asset", [])).size).toBe(0);
  });
});

describe("overlayCentralPicker (active-only picker contract)", () => {
  type Row = { orgId: string | null; label: string };
  const fake = (byId: Record<string, { name: string; status: string }>): Queryable => ({
    async query(_text, values) {
      const ids = (values?.[0] ?? []) as string[];
      return {
        rows: ids
          .filter((id) => byId[id])
          .map((id) => ({ id, name: byId[id].name, status: byId[id].status })),
        rowCount: null,
      };
    },
  });

  it("renames from central, drops centrally-retired, keeps local-only and broken links", async () => {
    configureOrgContract({ onUnresolvedCentralLink: () => {} });
    const rows: Row[] = [
      { orgId: LINK_A, label: "Old Name" }, // resolved, renamed
      { orgId: LINK_B, label: "Broken" }, // broken link — stays, loud elsewhere
      { orgId: null, label: "Local-only" }, // no counterpart — stays
    ];
    const out = await overlayCentralPicker(
      fake({ [LINK_A]: { name: "New Central Name", status: "active" } }),
      "legal_entity",
      rows,
      (r) => r.orgId,
      (r) => r.label,
      (r, name) => ({ ...r, label: name }),
    );
    expect(out.map((r) => r.label)).toEqual(["New Central Name", "Broken", "Local-only"]);

    const dropped = await overlayCentralPicker(
      fake({ [LINK_A]: { name: "Retired Co", status: "inactive" } }),
      "legal_entity",
      [{ orgId: LINK_A, label: "Retired Co" }],
      (r) => r.orgId,
      (r) => r.label,
      (r, name) => ({ ...r, label: name }),
    );
    expect(dropped).toEqual([]); // centrally retired ⇒ out of the active picker
  });
});
