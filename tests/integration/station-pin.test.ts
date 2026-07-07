/**
 * The full station-PIN flow against a THROWAWAY Postgres (stand-in org.* schema —
 * setup.ts). Covers: happy tap-in (session + token + throttle clear + login audit + F8
 * close of the prior occupant), O(1) lookup + the NULL-lookup transition fail-safe,
 * mismatch throttling → lockout → auto-expiry, collision denial (no throttle advance),
 * unknown station, mintToken:false, and resolveIdentity(by:'pin') needing NO token secret.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import {
  configureOrgContract,
  resetOrgContractConfig,
  authenticateStationPin,
  resolveIdentity,
  verifyStationToken,
  hashPin,
  computePinLookup,
  pinLockoutThreshold,
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

RUN("station-PIN authentication (integration)", () => {
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
    configureOrgContract({
      stationPinLookupSecret: () => "integration-lookup-key",
      stationTokenSecret: () => "integration-token-key",
      isProductionEnv: () => false,
    });
    await resetOrgSchema(db);
    ({ personId } = await seedPerson(db, { fullName: "Driver One", email: "d1@test.local" }));
    stationId = await seedStation(db, { autoLogoffMinutes: 30 });
    await db.query(
      `insert into org.credential (person_id, kind, pin_hash, pin_lookup, active)
       values ($1, 'pin', $2, $3, true)`,
      [personId, await hashPin("935170"), computePinLookup("935170")],
    );
  });

  it("authenticates, opens the session, mints the station-bound token, clears the throttle, audits login", async () => {
    await db.query(
      `update org.station set failed_pin_attempts = 2, pin_first_failed_at = now() where id = $1`,
      [stationId],
    );
    const result = await authenticateStationPin(db, { pin: "935170", stationId, appCode: "rms" });
    expect(result.outcome).toBe("authenticated");
    if (result.outcome !== "authenticated") return;
    expect(result.identity.personId).toBe(personId);
    expect(result.identity.fullName).toBe("Driver One");

    const session = await db.query(`select * from org.station_session where id = $1`, [
      result.stationSessionId,
    ]);
    expect(session.rows).toHaveLength(1);
    expect(session.rows[0].ended_at).toBeNull();

    const claims = await verifyStationToken(result.token!.token);
    expect(claims).toEqual({
      personId,
      stationId,
      stationSessionId: result.stationSessionId,
    });

    const station = await db.query(
      `select failed_pin_attempts, pin_locked_at from org.station where id = $1`,
      [stationId],
    );
    expect(station.rows[0].failed_pin_attempts).toBe(0);
    expect(station.rows[0].pin_locked_at).toBeNull();

    const logins = await auditRows(db, "login");
    expect(logins).toHaveLength(1);
    expect(logins[0]!.actor_person_id).toBe(personId);
    expect(logins[0]!.app_code).toBe("rms");
    expect(logins[0]!.outcome).toBe("success");
  });

  it("F8: a fresh tap-in closes the prior occupant's session with one auto_logoff audit row", async () => {
    const first = await authenticateStationPin(db, { pin: "935170", stationId, appCode: "rms" });
    if (first.outcome !== "authenticated") throw new Error("setup failed");
    const second = await authenticateStationPin(db, { pin: "935170", stationId, appCode: "rms" });
    expect(second.outcome).toBe("authenticated");

    const prior = await db.query(`select ended_at from org.station_session where id = $1`, [
      first.stationSessionId,
    ]);
    expect(prior.rows[0].ended_at).not.toBeNull();
    const autoLogoffs = await auditRows(db, "auto_logoff");
    expect(autoLogoffs).toHaveLength(1);
    expect(autoLogoffs[0]!.actor_person_id).toBe(personId);
  });

  it("a NULL-lookup credential (pre-M002, not yet reissued) still authenticates — the transition fail-safe", async () => {
    await db.query(`update org.credential set pin_lookup = null where person_id = $1`, [personId]);
    const result = await authenticateStationPin(db, { pin: "935170", stationId, appCode: "rms" });
    expect(result.outcome).toBe("authenticated");
  });

  it("a wrong PIN denies generically, advances the throttle, and audits pin_failure", async () => {
    const result = await authenticateStationPin(db, { pin: "000001", stationId, appCode: "rms" });
    expect(result).toEqual({ outcome: "denied" });
    const station = await db.query(`select failed_pin_attempts from org.station where id = $1`, [
      stationId,
    ]);
    expect(station.rows[0].failed_pin_attempts).toBe(1);
    const failures = await auditRows(db, "pin_failure");
    expect(failures).toHaveLength(1);
    expect((failures[0]!.after as { reason: string }).reason).toBe("pin_mismatch");
  });

  it("locks after THRESHOLD failures, denies while locked WITHOUT checking the PIN, self-expires", async () => {
    const t0 = new Date();
    for (let i = 0; i < pinLockoutThreshold(); i += 1) {
      await authenticateStationPin(
        db,
        { pin: "000001", stationId, appCode: "rms" },
        new Date(t0.getTime() + i * 1000),
      );
    }
    const locked = await db.query(`select pin_locked_at from org.station where id = $1`, [
      stationId,
    ]);
    expect(locked.rows[0].pin_locked_at).not.toBeNull();

    // While locked even the CORRECT pin denies (reason 'locked', outcome 'denied').
    const denied = await authenticateStationPin(
      db,
      { pin: "935170", stationId, appCode: "rms" },
      new Date(t0.getTime() + 60_000),
    );
    expect(denied).toEqual({ outcome: "denied" });
    const lockedAudits = (await auditRows(db, "pin_failure")).filter(
      (r) => (r.after as { reason: string }).reason === "locked",
    );
    expect(lockedAudits).toHaveLength(1);

    // After the window passes the lock self-expires and the correct pin works again.
    const after = await authenticateStationPin(
      db,
      { pin: "935170", stationId, appCode: "rms" },
      new Date(t0.getTime() + 6 * 60_000),
    );
    expect(after.outcome).toBe("authenticated");
  });

  it("a cross-person collision (two NULL-lookup rows, same PIN) denies without advancing the throttle", async () => {
    const other = await seedPerson(db, { fullName: "Driver Two", email: "d2@test.local" });
    // Two pre-M002 rows share the PIN — only reachable via the NULL-lookup fail-safe path.
    await db.query(`update org.credential set pin_lookup = null where person_id = $1`, [personId]);
    await db.query(
      `insert into org.credential (person_id, kind, pin_hash, pin_lookup, active)
       values ($1, 'pin', $2, null, true)`,
      [other.personId, await hashPin("935170")],
    );
    const result = await authenticateStationPin(db, { pin: "935170", stationId, appCode: "rms" });
    expect(result).toEqual({ outcome: "denied" });
    const station = await db.query(`select failed_pin_attempts from org.station where id = $1`, [
      stationId,
    ]);
    expect(station.rows[0].failed_pin_attempts).toBe(0); // a collision never advances the guess counter
    const failures = await auditRows(db, "pin_failure");
    expect((failures[0]!.after as { reason: string }).reason).toBe("pin_collision");
  });

  it("an unknown station denies generically and audits unknown_station", async () => {
    const result = await authenticateStationPin(db, {
      pin: "935170",
      stationId: "99999999-9999-4999-8999-999999999999",
      appCode: "rms",
    });
    expect(result).toEqual({ outcome: "denied" });
    const failures = await auditRows(db, "pin_failure");
    expect((failures[0]!.after as { reason: string }).reason).toBe("unknown_station");
  });

  it("mintToken:false opens the session with token null (identity-only consumers)", async () => {
    const result = await authenticateStationPin(
      db,
      { pin: "935170", stationId, appCode: "rms" },
      new Date(),
      { mintToken: false },
    );
    expect(result.outcome).toBe("authenticated");
    if (result.outcome === "authenticated") expect(result.token).toBeNull();
  });

  it("resolveIdentity(by:'pin') projects onto the frozen shape and needs NO token secret", async () => {
    configureOrgContract({
      stationTokenSecret: () => {
        throw new Error("token secret must not be needed for identity-only resolution");
      },
    });
    const result = await resolveIdentity(db, {
      by: "pin",
      value: "935170",
      appCode: "rms",
      stationId,
    });
    expect(result.result).toBe("resolved");
    if (result.result === "resolved") {
      expect(result.personId).toBe(personId);
      expect(result.stationSessionId).toBeDefined();
      expect(result).not.toHaveProperty("token");
    }
  });
});
