import { describe, expect, it } from "vitest";

import { withTransaction, type Queryable } from "../../src/index";

function recordingClient(log: string[]): Queryable {
  return {
    async query(text: string) {
      log.push(text);
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("withTransaction (framework_pg_pooler_safety)", () => {
  it("detects a Pool STRUCTURALLY (connect + totalCount) — checks out ONE client and releases it", async () => {
    const log: string[] = [];
    let released = 0;
    const client = { ...recordingClient(log), release: () => (released += 1) };
    // A pool-like from a *different* pg module instance — instanceof would miss it.
    const pool: Queryable & { connect(): Promise<typeof client>; totalCount: number } = {
      ...recordingClient([]),
      connect: async () => client,
      totalCount: 0,
    };
    const result = await withTransaction(pool, async (tx) => {
      await tx.query("select 1");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(log).toEqual(["begin", "select 1", "commit"]);
    expect(released).toBe(1);
  });

  it("runs directly on an already-acquired client (no connect, no release)", async () => {
    const log: string[] = [];
    await withTransaction(recordingClient(log), async (tx) => {
      await tx.query("select 2");
    });
    expect(log).toEqual(["begin", "select 2", "commit"]);
  });

  it("rolls back on error and rethrows the ORIGINAL cause even when rollback fails", async () => {
    const log: string[] = [];
    const flaky: Queryable = {
      async query(text: string) {
        log.push(text);
        if (text === "rollback") throw new Error("connection gone");
        return { rows: [], rowCount: 0 };
      },
    };
    await expect(
      withTransaction(flaky, async () => {
        throw new Error("the real cause");
      }),
    ).rejects.toThrowError("the real cause");
    expect(log).toEqual(["begin", "rollback"]);
  });
});
