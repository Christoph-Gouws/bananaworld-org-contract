/**
 * The DEV-stub source + the parity/error-model gates of `readMaster` — everything that is
 * provable WITHOUT a database (the central source is covered by the integration suite).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configureOrgContract,
  resetOrgContractConfig,
  readMaster,
  STUB_MASTERS,
  ForbiddenScopeError,
  UnknownAppError,
  type Queryable,
} from "../../src/index";

const NO_DB: Queryable = {
  async query() {
    throw new Error("the stub source must never touch the database");
  },
};

beforeEach(() => configureOrgContract({ mastersMode: () => "stub", isProductionEnv: () => false }));
afterEach(() => resetOrgContractConfig());

describe("readMaster (stub source, API-STUB-001)", () => {
  it("REFUSES to serve the stub in a production environment (AG-ADR-006)", async () => {
    configureOrgContract({ isProductionEnv: () => true });
    await expect(readMaster(NO_DB, { master: "site", appCode: "dc" })).rejects.toThrowError(
      /production/,
    );
  });

  it("REFUSES by default when the host never configured the environment (fail closed)", async () => {
    resetOrgContractConfig();
    configureOrgContract({ mastersMode: () => "stub" });
    await expect(readMaster(NO_DB, { master: "site", appCode: "dc" })).rejects.toThrowError(
      /production/,
    );
  });

  it("gates on the in-memory app registry (UnknownAppError parity)", async () => {
    await expect(
      readMaster(NO_DB, { master: "site", appCode: "hub" as never }),
    ).rejects.toBeInstanceOf(UnknownAppError);
  });

  it("denies an un-granted master identically to central (ForbiddenScopeError)", async () => {
    await expect(readMaster(NO_DB, { master: "asset", appCode: "crm" })).rejects.toBeInstanceOf(
      ForbiddenScopeError,
    );
  });

  it("serves the stub rows with the frozen shapes", async () => {
    const result = await readMaster(NO_DB, { master: "legal_entity", appCode: "dc" });
    expect(result.items).toHaveLength(STUB_MASTERS.legal_entity.length);
    expect(result.items[0]).toHaveProperty("id");
    expect(result.items[0]).toHaveProperty("slug");
    expect(result.nextCursor).toBeUndefined();
  });

  it("applies the safe filter allow-list in memory", async () => {
    const active = await readMaster(NO_DB, {
      master: "legal_entity",
      appCode: "dc",
      filter: { status: "active" },
    });
    expect(active.items.every((r) => r.status === "active")).toBe(true);
    const trucksAtDc = await readMaster(NO_DB, {
      master: "asset",
      appCode: "rms",
      filter: { asset_type: "truck", status: "active" },
    });
    expect(trucksAtDc.items.length).toBeGreaterThan(0);
  });

  it("ignores an unknown filter key (allow-list, never interpolated)", async () => {
    const all = await readMaster(NO_DB, { master: "site", appCode: "dc" });
    const filtered = await readMaster(NO_DB, {
      master: "site",
      appCode: "dc",
      filter: { "name; drop table": "x" },
    });
    expect(filtered.items).toEqual(all.items);
  });

  it("a malformed cursor falls back to offset 0 (never throws)", async () => {
    const result = await readMaster(NO_DB, {
      master: "station",
      appCode: "rms",
      cursor: "!!!not-base64!!!",
    });
    expect(result.items.length).toBeGreaterThan(0);
  });
});
