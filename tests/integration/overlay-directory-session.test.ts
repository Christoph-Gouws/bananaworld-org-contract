/**
 * The remaining consumer surfaces against the stand-in schema: UUID-keyed overlay reads,
 * the Estate Station Directory (fail-open), session close/logout, and open-session
 * attribution.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "pg";

import {
  configureOrgContract,
  resetOrgContractConfig,
  readCentralMasterIdentities,
  findEstateStations,
  listEstateStations,
  logoutStationSession,
  endOpenSessionsAtStation,
  resolveOpenStationSession,
  beginAppAudit,
} from "../../src/index";
import {
  auditRows,
  connect,
  resetOrgSchema,
  seedPerson,
  seedStation,
  testDatabaseUrl,
} from "./setup";

const RUN = testDatabaseUrl() ? describe : describe.skip;

RUN("UUID-keyed central-master overlay reads (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    resetOrgContractConfig();
    await resetOrgSchema(db);
  });

  it("reads each kind by central UUID with the per-view identity shape", async () => {
    const le = await db.query(
      `insert into org.v_master_legal_entity (name, slug, status) values ('Alpha', 'alpha', 'active') returning id::text as id`,
    );
    const farm = await db.query(
      `insert into org.v_master_farm (code, name, status) values ('GF', 'Green Farms', 'inactive') returning id::text as id`,
    );
    const truck = await db.query(
      `insert into org.v_master_asset (asset_type, identifier, status) values ('truck', 'TRK-01', 'active') returning id::text as id`,
    );
    const site = await db.query(
      `insert into org.v_master_site (site_type, name) values ('dc', 'Nelspruit DC') returning id::text as id`,
    );

    const les = await readCentralMasterIdentities(db, "legal_entity", [le.rows[0].id]);
    expect(les.get(le.rows[0].id)).toEqual({ name: "Alpha", active: true });

    const farms = await readCentralMasterIdentities(db, "farm", [farm.rows[0].id]);
    expect(farms.get(farm.rows[0].id)).toEqual({ name: "Green Farms", active: false });

    const trucks = await readCentralMasterIdentities(db, "asset", [truck.rows[0].id]);
    expect(trucks.get(truck.rows[0].id)).toEqual({ name: null, active: true }); // no name on the asset view

    const sites = await readCentralMasterIdentities(db, "site", [site.rows[0].id]);
    expect(sites.get(site.rows[0].id)).toEqual({ name: "Nelspruit DC", active: null }); // no status on the site view
  });

  it("a non-truck asset and a non-dc site are NOT resolved (view filters hold)", async () => {
    const vehicle = await db.query(
      `insert into org.v_master_asset (asset_type, identifier) values ('vehicle', 'BAKKIE-1') returning id::text as id`,
    );
    const farmSite = await db.query(
      `insert into org.v_master_site (site_type, name) values ('farm', 'North Field') returning id::text as id`,
    );
    expect((await readCentralMasterIdentities(db, "asset", [vehicle.rows[0].id])).size).toBe(0);
    expect((await readCentralMasterIdentities(db, "site", [farmSite.rows[0].id])).size).toBe(0);
  });

  it("degrades LOUD-not-crash when the boundary relation is gone (the lost-GRANT class)", async () => {
    const failHook = vi.fn();
    configureOrgContract({ onCentralReadFailure: failHook });
    await db.query(`drop table org.v_master_farm`);
    const map = await readCentralMasterIdentities(db, "farm", [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(map.size).toBe(0);
    expect(failHook).toHaveBeenCalledOnce();
  });
});

RUN("Estate Station Directory read (integration, fail-open)", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    resetOrgContractConfig();
    await resetOrgSchema(db);
    await db.query(`
      insert into org.v_estate_station (owner_app, kind, code, name, active, site_name) values
        ('dc', 'receiving_bay', 'RB-1', 'Receiving Bay 1', true, 'Demo DC'),
        ('org', 'truck', 'TRK-01', 'Demo Transport Truck', true, null),
        ('org', 'farm_bay', 'BAY-9', 'Retired Bay', false, 'Farm North')
    `);
  });

  it("finds by id set and lists with owner/active filters (frozen shape)", async () => {
    const listed = await listEstateStations(db, { ownerApp: "org", activeOnly: true });
    expect(listed.available).toBe(true);
    expect(listed.stations.map((s) => s.code)).toEqual(["TRK-01"]);

    const all = await listEstateStations(db);
    expect(all.stations).toHaveLength(3);

    const found = await findEstateStations(db, [
      all.stations[0].stationId,
      all.stations[0].stationId,
    ]);
    expect(found.available).toBe(true);
    expect(found.stations.size).toBe(1);
    expect(found.stations.get(all.stations[0].stationId)?.ownerApp).toBe("dc");
  });

  it("an absent view reports available:false — never a throw, never a block", async () => {
    await db.query(`drop table org.v_estate_station`);
    const found = await findEstateStations(db, ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(found).toEqual({ available: false, stations: new Map() });
    const listed = await listEstateStations(db);
    expect(listed.available).toBe(false);
  });
});

RUN("station-session lifecycle + attribution (integration)", () => {
  let db: Client;
  let stationId: string;
  let personId: string;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    resetOrgContractConfig();
    await resetOrgSchema(db);
    ({ personId } = await seedPerson(db, { fullName: "Session Person", email: "s@test.local" }));
    stationId = await seedStation(db, { autoLogoffMinutes: 30 });
  });

  async function openSession(): Promise<string> {
    const r = await db.query(
      `insert into org.station_session (station_id, person_id) values ($1, $2) returning id::text as id`,
      [stationId, personId],
    );
    return r.rows[0].id as string;
  }

  it("logoutStationSession closes an open session with a `logout` audit; a re-run is not_open", async () => {
    const sessionId = await openSession();
    expect(await logoutStationSession(db, { stationSessionId: sessionId, appCode: "rms" })).toBe(
      "closed",
    );
    const logouts = await auditRows(db, "logout");
    expect(logouts).toHaveLength(1);
    expect(logouts[0].actor_person_id).toBe(personId);
    expect(await logoutStationSession(db, { stationSessionId: sessionId, appCode: "rms" })).toBe(
      "not_open",
    );
  });

  it("endOpenSessionsAtStation closes every open session with one auto_logoff each", async () => {
    await openSession();
    await openSession();
    await db.query("begin");
    await beginAppAudit(db);
    const closed = await endOpenSessionsAtStation(db, { stationId, appCode: "rms" });
    await db.query("commit");
    expect(closed).toBe(2);
    expect(await auditRows(db, "auto_logoff")).toHaveLength(2);
  });

  it("resolveOpenStationSession attributes an OPEN in-window session; ended/expired/retired → null", async () => {
    const sessionId = await openSession();
    const ctx = await resolveOpenStationSession(db, sessionId);
    expect(ctx).toEqual({ personId, stationId, email: "s@test.local" });

    // Expired (auto-logoff window passed) → null.
    expect(
      await resolveOpenStationSession(db, sessionId, new Date(Date.now() + 31 * 60_000)),
    ).toBeNull();

    // Retired person → null.
    await db.query(`update org.person set status = 'inactive' where id = $1`, [personId]);
    expect(await resolveOpenStationSession(db, sessionId)).toBeNull();
    await db.query(`update org.person set status = 'active' where id = $1`, [personId]);

    // Ended → null.
    await db.query(`update org.station_session set ended_at = now() where id = $1`, [sessionId]);
    expect(await resolveOpenStationSession(db, sessionId)).toBeNull();

    // Malformed id → clean null.
    expect(await resolveOpenStationSession(db, "nope")).toBeNull();
  });
});
