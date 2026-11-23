/**
 * pagePersonsByIds — the paged, id-limited people read (CR-ORG-CONTRACT-004) against the
 * stand-in org.person. Expected orders are computed by Postgres so CI collation never matters.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { pagePersonsByIds } from "../../src/index";
import { connect, resetOrgSchema, seedPerson, testDatabaseUrl } from "./setup";

const RUN = testDatabaseUrl() ? describe : describe.skip;

RUN("pagePersonsByIds — paged id-limited read (integration)", () => {
  let db: Client;
  let le: string;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });
  beforeEach(async () => {
    await resetOrgSchema(db);
    const r = await db.query(
      `insert into org.legal_entity (name, slug) values ('T', 't') returning id::text as id`,
    );
    le = r.rows[0].id as string;
  });

  async function seedNamed(names: string[], status = "active"): Promise<string[]> {
    const ids: string[] = [];
    for (const n of names) ids.push((await seedPerson(db, { fullName: n, status })).personId);
    return ids;
  }

  async function seedMany(n: number): Promise<string[]> {
    const r = await db.query(
      `insert into org.person (full_name, home_legal_entity_id)
       select 'Person ' || lpad(g::text, 5, '0'), $1 from generate_series(1, $2) g
       returning id::text as id`,
      [le, n],
    );
    return r.rows.map((x) => x.id as string);
  }

  async function pgOrder(ids: string[]): Promise<string[]> {
    const r = await db.query(
      `select u.id::text as id from unnest($1::uuid[]) u(id)
         left join org.person p on p.id = u.id
        order by lower(coalesce(p.full_name, u.id::text)), u.id`,
      [ids],
    );
    return r.rows.map((x) => x.id as string);
  }

  it("T1 orders by lower(coalesce(name, id)), id; ties by id; unknown id sorts by id text", async () => {
    const ids = await seedNamed(["bob", "Alice", "alice", "Carol", "BOB"]);
    ids.push(randomUUID());
    const page = await pagePersonsByIds(db, { ids, limit: 50 });
    expect(page.rows.map((r) => r.personId)).toEqual(await pgOrder(ids));
  });

  it("T2 paging covers each id exactly once", async () => {
    const ids = await seedMany(50);
    const seen: string[] = [];
    for (let off = 0; off < 50; off += 7) {
      const p = await pagePersonsByIds(db, { ids, limit: 7, offset: off });
      expect(p.total).toBe(50);
      seen.push(...p.rows.map((r) => r.personId));
    }
    expect(seen).toEqual(await pgOrder(ids));
  });

  it("T3 search treats % and _ literally", async () => {
    const ids = await seedNamed(["Fifty% Off", "Under_Score", "UnderXScore"]);
    const q = async (s: string) =>
      pagePersonsByIds(db, { ids, limit: 10, nameContains: s }).then((p) => [
        p.total,
        p.rows.map((r) => r.fullName),
      ]);
    expect(await q("Y% o")).toEqual([1, ["Fifty% Off"]]);
    expect(await q("r_s")).toEqual([1, ["Under_Score"]]);
    expect(await q("%")).toEqual([1, ["Fifty% Off"]]);
    expect(await q("_")).toEqual([1, ["Under_Score"]]);
  });

  it("T4 past-the-end clamps to the last page; unaligned in-range offset kept", async () => {
    const ids = await seedMany(23);
    const far = await pagePersonsByIds(db, { ids, limit: 10, offset: 500 });
    expect([far.offset, far.rows.length, far.total]).toEqual([20, 3, 23]);
    const exact = await pagePersonsByIds(db, { ids, limit: 10, offset: 23 });
    expect([exact.offset, exact.rows.length]).toEqual([20, 3]);
    const mid = await pagePersonsByIds(db, { ids, limit: 10, offset: 15 });
    expect([mid.offset, mid.rows.length]).toEqual([15, 8]);
  });

  it("T5 focus page; absent/filtered focus -> 0; explicit offset beats focus", async () => {
    const ids = await seedMany(23);
    const order = await pgOrder(ids);
    const focus = order[14]!;
    const p = await pagePersonsByIds(db, { ids, limit: 10, focusId: focus });
    expect(p.offset).toBe(10);
    expect(p.rows.map((r) => r.personId)).toContain(focus);
    expect((await pagePersonsByIds(db, { ids, limit: 10, focusId: randomUUID() })).offset).toBe(0);
    const filtered = await pagePersonsByIds(db, {
      ids,
      limit: 10,
      focusId: focus,
      nameContains: "00001",
    });
    expect(filtered.offset).toBe(0);
    expect((await pagePersonsByIds(db, { ids, limit: 10, focusId: focus, offset: 0 })).offset).toBe(
      0,
    );
  });

  it("T6 unknown ids are kept with null name/status/login and counted", async () => {
    const ids = [randomUUID(), randomUUID()];
    const p = await pagePersonsByIds(db, { ids, limit: 10 });
    expect(p.total).toBe(2);
    for (const r of p.rows) {
      expect([r.fullName, r.status, r.authUserId]).toEqual([null, null, null]);
    }
  });

  it("T7 malformed ids skipped, duplicates (incl. case variants) counted once", async () => {
    const [id] = await seedNamed(["Solo"]);
    const p = await pagePersonsByIds(db, {
      ids: ["", "nope", "123", id!, id!, id!.toUpperCase()],
      limit: 10,
    });
    expect(p.total).toBe(1);
    expect(p.rows.map((r) => r.personId)).toEqual([id]);
    expect(await pagePersonsByIds(db, { ids: ["x", ""], limit: 10 })).toEqual({
      rows: [],
      total: 0,
      offset: 0,
    });
  });

  it("T8 limit clamps: 0 -> 1, 999 -> 200, 2.7 -> 2", async () => {
    const ids = await seedMany(250);
    expect((await pagePersonsByIds(db, { ids, limit: 0 })).rows).toHaveLength(1);
    expect((await pagePersonsByIds(db, { ids, limit: 999 })).rows).toHaveLength(200);
    expect((await pagePersonsByIds(db, { ids, limit: 2.7 })).rows).toHaveLength(2);
  });

  it("T9 handles 2,000+ ids in one call and a full walk covers all once", async () => {
    const ids = await seedMany(2000);
    for (let i = 0; i < 25; i++) ids.push(randomUUID());
    const first = await pagePersonsByIds(db, { ids, limit: 200 });
    expect([first.total, first.rows.length]).toEqual([2025, 200]);
    const last = await pagePersonsByIds(db, { ids, limit: 200, offset: 99999 });
    expect([last.offset, last.rows.length]).toEqual([2000, 25]);
    const seen: string[] = [];
    for (let off = 0; off < 2025; off += 200) {
      seen.push(
        ...(await pagePersonsByIds(db, { ids, limit: 200, offset: off })).rows.map(
          (r) => r.personId,
        ),
      );
    }
    expect(seen).toEqual(await pgOrder(ids));
  });

  it("T10 never returns anyone not named; no email on rows", async () => {
    const all = await seedNamed(["A One", "B Two", "C Three", "D Four", "E Five"]);
    const ids = all.slice(0, 2);
    for (const nameContains of [undefined, "", "%", "_"]) {
      const p = await pagePersonsByIds(db, { ids, limit: 200, nameContains });
      expect(p.rows.map((r) => r.personId).every((x) => ids.includes(x))).toBe(true);
      expect(p.total).toBe(nameContains === "%" || nameContains === "_" ? 0 : 2);
    }
    const p = await pagePersonsByIds(db, { ids, limit: 10 });
    expect(Object.keys(p.rows[0]!).sort()).toEqual([
      "authUserId",
      "fullName",
      "personId",
      "status",
    ]);
  });

  it("T11 does not filter on status", async () => {
    const ids = await seedNamed(["Gone Gail"], "archived");
    const p = await pagePersonsByIds(db, { ids, limit: 10 });
    expect(p.rows[0]!.status).toBe("archived");
  });
});
