/**
 * pagePersonsByIds — the input normalisation that runs BEFORE the statement (CR-ORG-CONTRACT-004).
 * The SQL itself is proven in tests/integration/page-persons.test.ts.
 */
import { describe, expect, it } from "vitest";

import { PAGE_PERSONS_MAX_LIMIT, pagePersonsByIds } from "../../src/index";
import type { Queryable } from "../../src/index";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

function recordingDb(): { db: Queryable; calls: Array<readonly unknown[]> } {
  const calls: Array<readonly unknown[]> = [];
  const db: Queryable = {
    async query(_text, values) {
      calls.push(values ?? []);
      return { rows: [{ total: 1, offset: 0, rows: null }] };
    },
  };
  return { db, calls };
}

// values: [ids, pattern, limit, offset, focus]
describe("pagePersonsByIds — normalisation (unit)", () => {
  it("issues no statement for zero valid ids", async () => {
    const { db, calls } = recordingDb();
    expect(await pagePersonsByIds(db, { ids: ["", "nope", "123"], limit: 10 })).toEqual({
      rows: [],
      total: 0,
      offset: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("one statement per call; dedupes and drops malformed ids; null rows become []", async () => {
    const { db, calls } = recordingDb();
    const page = await pagePersonsByIds(db, { ids: [A, "bad", A, B], limit: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual([A, B]);
    expect(page.rows).toEqual([]);
  });

  it("clamps limit to [1, MAX], NaN and 0 to 1, Infinity to MAX, truncates", async () => {
    const { db, calls } = recordingDb();
    for (const limit of [0, -5, Number.NaN, 999, Infinity, 2.7]) {
      await pagePersonsByIds(db, { ids: [A], limit });
    }
    expect(calls.map((c) => c[2])).toEqual([
      1,
      1,
      1,
      PAGE_PERSONS_MAX_LIMIT,
      PAGE_PERSONS_MAX_LIMIT,
      2,
    ]);
  });

  it("offset: absent -> null; negative/NaN -> 0; fractional truncated", async () => {
    const { db, calls } = recordingDb();
    await pagePersonsByIds(db, { ids: [A], limit: 5 });
    await pagePersonsByIds(db, { ids: [A], limit: 5, offset: -4 });
    await pagePersonsByIds(db, { ids: [A], limit: 5, offset: Number.NaN });
    await pagePersonsByIds(db, { ids: [A], limit: 5, offset: 7.9 });
    expect(calls.map((c) => c[3])).toEqual([null, 0, 0, 7]);
  });

  it("focus: valid id passes through; malformed is null", async () => {
    const { db, calls } = recordingDb();
    await pagePersonsByIds(db, { ids: [A], limit: 5, focusId: B });
    await pagePersonsByIds(db, { ids: [A], limit: 5, focusId: "zzz" });
    expect(calls.map((c) => c[4])).toEqual([B, null]);
  });

  it("term: trimmed; blank -> null; % _ \\ escaped", async () => {
    const { db, calls } = recordingDb();
    await pagePersonsByIds(db, { ids: [A], limit: 5, nameContains: "  Ab  " });
    await pagePersonsByIds(db, { ids: [A], limit: 5, nameContains: "   " });
    await pagePersonsByIds(db, { ids: [A], limit: 5, nameContains: "5%_\\" });
    expect(calls.map((c) => c[1])).toEqual(["Ab", null, "5\\%\\_\\\\"]);
  });
});
