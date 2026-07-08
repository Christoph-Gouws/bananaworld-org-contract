/**
 * listPersons — the central-directory picker read (EPIC-008-M007 §D) against the stand-in
 * org.person: search-first, active-only, capped, exclude-in-app, LIKE-safe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { listPersons } from "../../src/index";
import { connect, resetOrgSchema, seedPerson, testDatabaseUrl } from "./setup";

const RUN = testDatabaseUrl() ? describe : describe.skip;

RUN("listPersons — directory picker read (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await resetOrgSchema(db);
  });

  it("matches by name (case-insensitive substring), ordered by name", async () => {
    await seedPerson(db, { fullName: "Lerato Mokoena", email: "lerato.m@bw.co.za" });
    await seedPerson(db, { fullName: "Rose Lerato Sithole", email: "rose.s@bw.co.za" });
    await seedPerson(db, { fullName: "Thabo Nkosi", email: "thabo@bw.co.za" });

    const rows = await listPersons(db, { query: "LERATO" });
    expect(rows.map((r) => r.fullName)).toEqual(["Lerato Mokoena", "Rose Lerato Sithole"]);
    expect(rows[0]!.email).toBe("lerato.m@bw.co.za");
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.personId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("matches by email substring", async () => {
    await seedPerson(db, { fullName: "Aisha Patel", email: "aisha.patel@bananaworld.co.za" });
    await seedPerson(db, { fullName: "Someone Else", email: "else@other.co.za" });
    const rows = await listPersons(db, { query: "bananaworld" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe("Aisha Patel");
  });

  it("returns only ACTIVE people (retired/archived excluded)", async () => {
    await seedPerson(db, { fullName: "Active Amy", email: "amy@bw.co.za", status: "active" });
    await seedPerson(db, {
      fullName: "Archived Amara",
      email: "amara@bw.co.za",
      status: "archived",
    });
    await seedPerson(db, { fullName: "Inactive Amos", email: "amos@bw.co.za", status: "inactive" });
    const rows = await listPersons(db, { query: "am" }); // 'am' appears in all three names
    expect(rows.map((r) => r.fullName)).toEqual(["Active Amy"]);
  });

  it("is search-first — a too-short (or blank) query returns [] without listing anyone", async () => {
    await seedPerson(db, { fullName: "Anyone AtAll", email: "a@bw.co.za" });
    expect(await listPersons(db, { query: "" })).toEqual([]);
    expect(await listPersons(db, { query: " a " })).toEqual([]); // 1 char after trim
    expect(await listPersons(db, { query: "an" })).toHaveLength(1); // 2 chars is the floor
  });

  it("excludes people already provisioned in the calling app", async () => {
    const { personId: keep } = await seedPerson(db, {
      fullName: "Keeper Kay",
      email: "k@bw.co.za",
    });
    const { personId: drop } = await seedPerson(db, {
      fullName: "Dropper Dee",
      email: "d@bw.co.za",
    });
    // both names contain 'e'
    const all = await listPersons(db, { query: "e" + "e" });
    const excluded = await listPersons(db, { query: "e" + "e", excludePersonIds: [drop] });
    expect(all.map((r) => r.personId).sort()).toEqual([keep, drop].sort());
    expect(excluded.map((r) => r.personId)).toEqual([keep]);
  });

  it("caps results: default 20 and an over-max limit clamps to 50", async () => {
    for (let i = 0; i < 60; i += 1) {
      await seedPerson(db, {
        fullName: `Sam Person ${String(i).padStart(2, "0")}`,
        email: `sam${i}@bw.co.za`,
      });
    }
    expect(await listPersons(db, { query: "Sam Person" })).toHaveLength(20); // default cap
    expect(await listPersons(db, { query: "Sam Person", limit: 999 })).toHaveLength(50); // hard ceiling
    expect(await listPersons(db, { query: "Sam Person", limit: 5 })).toHaveLength(5);
    expect(await listPersons(db, { query: "Sam Person", limit: 0 })).toHaveLength(1); // clamped up to 1
  });

  it("treats LIKE metacharacters as literals (a '%' query does not wildcard-match everyone)", async () => {
    await seedPerson(db, { fullName: "Normal Person", email: "n@bw.co.za" });
    await seedPerson(db, { fullName: "Fifty% Off Farm", email: "promo@bw.co.za" });
    const literal = await listPersons(db, { query: "y% O" });
    expect(literal.map((r) => r.fullName)).toEqual(["Fifty% Off Farm"]);
    const bareWildcard = await listPersons(db, { query: "%%" });
    expect(bareWildcard).toEqual([]); // '%%' matches nobody literally
  });
});
