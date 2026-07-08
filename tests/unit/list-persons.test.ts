/**
 * listPersons — the guard/clamp/escape logic that runs BEFORE (or instead of) touching the
 * DB. The SQL itself is proven in tests/integration/list-persons.test.ts; here we prove the
 * short-query short-circuit, the limit clamp, LIKE-escaping and exclude-id sanitising with a
 * recording fake connection (no database).
 */
import { describe, expect, it } from "vitest";

import { LIST_PERSONS_MAX_LIMIT, listPersons } from "../../src/index";
import type { Queryable } from "../../src/index";

interface Recorded {
  text: string;
  values: readonly unknown[] | undefined;
}

function recordingDb(rows: Array<Record<string, unknown>> = []): {
  db: Queryable;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const db: Queryable = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows };
    },
  };
  return { db, calls };
}

describe("listPersons — guards, clamps & escaping (unit)", () => {
  it("short or blank query short-circuits to [] WITHOUT querying the DB", async () => {
    const { db, calls } = recordingDb();
    expect(await listPersons(db, { query: "" })).toEqual([]);
    expect(await listPersons(db, { query: "   " })).toEqual([]);
    expect(await listPersons(db, { query: " x " })).toEqual([]); // one char after trim
    expect(calls).toHaveLength(0);
  });

  it("lowercases + wraps the search term and clamps limit to [1, MAX]", async () => {
    const { db, calls } = recordingDb();
    await listPersons(db, { query: "ThAbo", limit: 999 });
    expect(calls[0]!.values![0]).toBe("%thabo%");
    expect(calls[0]!.values![2]).toBe(LIST_PERSONS_MAX_LIMIT); // 999 -> 50
    await listPersons(db, { query: "xy", limit: -3 });
    expect(calls[1]!.values![2]).toBe(1); // -3 -> 1
    await listPersons(db, { query: "xy", limit: 7.9 });
    expect(calls[2]!.values![2]).toBe(7); // truncated
  });

  it("escapes LIKE metacharacters so the term matches literally", async () => {
    const { db, calls } = recordingDb();
    await listPersons(db, { query: "50%_x" });
    expect(calls[0]!.values![0]).toBe("%50\\%\\_x%");
  });

  it("drops malformed exclude ids; passes null (not []) when none survive", async () => {
    const good = "00000000-0000-0000-0000-000000000001";
    const { db, calls } = recordingDb();
    await listPersons(db, { query: "ab", excludePersonIds: ["not-a-uuid", good, good] });
    expect(calls[0]!.values![1]).toEqual([good]); // de-duped + sanitised
    await listPersons(db, { query: "ab", excludePersonIds: ["bad", "also-bad"] });
    expect(calls[1]!.values![1]).toBeNull();
  });
});
