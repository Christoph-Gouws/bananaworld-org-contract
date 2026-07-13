import { afterEach, describe, expect, it } from "vitest";

import {
  configureOrgContract,
  getStationSessionTable,
  getStationTable,
  resetOrgContractConfig,
} from "../../src/config";
import { resolveOpenStationSession } from "../../src/auth/station-attribution";
import type { Queryable } from "../../src/queryable";

/**
 * The station-auth table binding (EPIC-008-M001 / XSYS-RMS-010; the `org.station` default was
 * RETIRED at EPIC-008-M003, Station Partition Doctrine v2). The shared station-PIN / session /
 * attribution flows read the caller's station tables. There is NO default: a station-owning
 * consumer (RMS) MUST inject `rms.*`; an uninjected flow fails LOUD (a clear config error), never
 * against the dropped `org.station`. Identifiers are allow-listed to a bare lowercase
 * `schema.table` so a typo fails closed rather than building broken (or unsafe) SQL. No DB — the
 * binding + its interpolation are pure config.
 */

/** A fake pg client that records every SQL it is handed and returns no rows. */
function captureDb(): { db: Queryable; sql: () => string[] } {
  const seen: string[] = [];
  return {
    db: {
      query: (text: string) => {
        seen.push(text);
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Queryable,
    sql: () => seen,
  };
}

const A_UUID = "7b1e2f33-5678-4abc-9def-aabbccddeeff";

afterEach(() => {
  resetOrgContractConfig();
});

describe("station-auth table binding", () => {
  it("fails LOUD when unconfigured — no org.station default (Doctrine v2, EPIC-008-M003)", () => {
    resetOrgContractConfig();
    expect(() => getStationTable()).toThrow(/is not configured/);
    expect(() => getStationTable()).toThrow(/stationTables\.station/);
    expect(() => getStationSessionTable()).toThrow(/stationTables\.stationSession/);
  });

  it("returns the injected tables when a station-owning consumer binds its own (RMS)", () => {
    configureOrgContract({
      stationTables: { station: "rms.station", stationSession: "rms.station_session" },
    });
    expect(getStationTable()).toBe("rms.station");
    expect(getStationSessionTable()).toBe("rms.station_session");
  });

  it("requires BOTH tables — injecting only one still fails loud on the other", () => {
    configureOrgContract({ stationTables: { station: "rms.station" } });
    expect(getStationTable()).toBe("rms.station");
    expect(() => getStationSessionTable()).toThrow(/stationTables\.stationSession/);
  });

  it("the attribution read runs against the INJECTED tables (rms.*)", async () => {
    configureOrgContract({
      stationTables: { station: "rms.station", stationSession: "rms.station_session" },
    });
    const cap = captureDb();
    await resolveOpenStationSession(cap.db, A_UUID);
    const joined = cap.sql().join("\n");
    expect(joined).toContain("from rms.station_session ss");
    expect(joined).toContain("join rms.station s on s.id = ss.station_id");
    // Person stays central regardless of the station binding.
    expect(joined).toContain("join org.person p");
    // No org.station* leak once rms.* is bound.
    expect(joined).not.toContain("from org.station_session");
  });

  it("the attribution read fails loud when unconfigured — never queries a ghost org.station", async () => {
    resetOrgContractConfig();
    const cap = captureDb();
    await expect(resolveOpenStationSession(cap.db, A_UUID)).rejects.toThrow(/is not configured/);
    // The table accessor throws while building the SQL, so no query is ever issued.
    expect(cap.sql()).toHaveLength(0);
  });

  it("rejects a non-schema.table identifier — fail closed at use, never broken/unsafe SQL", () => {
    configureOrgContract({ stationTables: { station: "rms.station; drop table x" } });
    expect(() => getStationTable()).toThrow(/invalid station table identifier/);
    configureOrgContract({ stationTables: { station: "notqualified" } });
    expect(() => getStationTable()).toThrow(/invalid station table identifier/);
  });
});
