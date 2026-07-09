/**
 * resolveIdentity (email/id/login halves) + readMaster (central source) against the
 * stand-in org.* schema: gates, filters, paging, and the audited scope denial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import {
  configureOrgContract,
  resetOrgContractConfig,
  resolveIdentity,
  readMaster,
  ForbiddenScopeError,
  UnknownAppError,
  SYSTEM_ACTOR_ID,
} from "../../src/index";
import { auditRows, connect, resetOrgSchema, seedPerson, testDatabaseUrl } from "./setup";

const RUN = testDatabaseUrl() ? describe : describe.skip;

RUN("resolveIdentity — email/id/login (integration)", () => {
  let db: Client;
  let personId: string;
  let legalEntityId: string;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    resetOrgContractConfig();
    configureOrgContract({ isProductionEnv: () => false });
    await resetOrgSchema(db);
    ({ personId, legalEntityId } = await seedPerson(db, {
      fullName: "Ada Person",
      email: "ada@test.local",
    }));
  });

  it("resolves by email (case-folded) with the frozen identity-only shape", async () => {
    const result = await resolveIdentity(db, {
      by: "email",
      value: "ADA@TEST.LOCAL",
      appCode: "dc",
    });
    expect(result).toEqual({
      result: "resolved",
      personId,
      fullName: "Ada Person",
      legalEntityId,
      status: "active",
    });
  });

  it("resolves by id; a malformed uuid is a clean not_found", async () => {
    expect((await resolveIdentity(db, { by: "id", value: personId, appCode: "crm" })).result).toBe(
      "resolved",
    );
    expect(await resolveIdentity(db, { by: "id", value: "not-a-uuid", appCode: "crm" })).toEqual({
      result: "not_found",
    });
  });

  it("gates on a registered ACTIVE app first (UnknownAppError)", async () => {
    await db.query(`update org.app set status = 'inactive' where app_code = 'rms'`);
    await expect(
      resolveIdentity(db, { by: "email", value: "ada@test.local", appCode: "rms" }),
    ).rejects.toBeInstanceOf(UnknownAppError);
  });

  it("by='pin' without a stationId is a caller error (API-REQ-003)", async () => {
    await expect(
      resolveIdentity(db, { by: "pin", value: "935170", appCode: "rms" }),
    ).rejects.toThrowError(/stationId is required/);
  });
});

RUN("readMaster — central source (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    resetOrgContractConfig();
    configureOrgContract({ isProductionEnv: () => false, mastersMode: () => "central" });
    await resetOrgSchema(db);
    await db.query(`
      insert into org.v_master_legal_entity (name, slug, status) values
        ('Alpha Co', 'alpha', 'active'),
        ('Beta Co', 'beta', 'inactive')
    `);
    await db.query(`
      insert into org.v_master_asset (asset_type, identifier, status, steward_app) values
        ('truck', 'TRK-01', 'active', 'dc'),
        ('truck', 'TRK-02', 'active', null)
    `);
  });

  it("reads the frozen view shape with the safe filter allow-list", async () => {
    const all = await readMaster(db, { master: "legal_entity", appCode: "crm" });
    expect(all.items).toHaveLength(2);
    const active = await readMaster(db, {
      master: "legal_entity",
      appCode: "crm",
      filter: { status: "active" },
    });
    expect(active.items).toHaveLength(1);
    expect(active.items[0]!.slug).toBe("alpha");
  });

  it("reads a single row by its own id via the central source (v0.4.1)", async () => {
    const all = await readMaster(db, { master: "legal_entity", appCode: "crm" });
    const beta = all.items.find((r) => r.slug === "beta")!;
    const one = await readMaster(db, {
      master: "legal_entity",
      appCode: "crm",
      filter: { id: String(beta.id) },
    });
    expect(one.items).toHaveLength(1);
    expect(one.items[0]!.id).toBe(beta.id);
    expect(one.items[0]!.slug).toBe("beta");
  });

  it("shapes the asset steward_app → stewardApp and DROPS the null steward key (API-RES-009)", async () => {
    const trucks = await readMaster(db, { master: "asset", appCode: "rms" });
    const stewarded = trucks.items.find((r) => r.identifier === "TRK-01");
    const central = trucks.items.find((r) => r.identifier === "TRK-02");
    expect(stewarded?.stewardApp).toBe("dc");
    expect(central && "stewardApp" in central).toBe(false);
  });

  it("pages at 50 with an opaque cursor, identically to the stub source", async () => {
    for (let i = 0; i < 55; i += 1) {
      await db.query(
        `insert into org.v_master_entity_role (legal_entity_id, role_type) values (gen_random_uuid(), 'farm')`,
      );
    }
    const page1 = await readMaster(db, { master: "entity_role", appCode: "dc" });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).toBeDefined();
    const page2 = await readMaster(db, {
      master: "entity_role",
      appCode: "dc",
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(5);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("audits a least-privilege denial (master_read / denied / repository) and leaks no rows", async () => {
    await expect(readMaster(db, { master: "asset", appCode: "crm" })).rejects.toBeInstanceOf(
      ForbiddenScopeError,
    );
    const denials = await auditRows(db, "master_read");
    expect(denials).toHaveLength(1);
    expect(denials[0]!.actor_person_id).toBe(SYSTEM_ACTOR_ID);
    expect(denials[0]!.app_code).toBe("crm");
    expect(denials[0]!.outcome).toBe("denied");
    expect(denials[0]!.deny_layer).toBe("repository");
    expect((denials[0]!.after as { reason: string }).reason).toBe("forbidden_scope");
  });
});
