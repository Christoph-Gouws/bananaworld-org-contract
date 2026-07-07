import type { Queryable } from "../queryable";

/**
 * Run `run` inside a single database transaction on ONE connection.
 *
 * THE CONNECTION LEAK THIS FIXES (the estate `EMAXCONNSESSION` cause — the
 * framework_pg_pooler_safety rule). Issuing `pool.query("begin") … pool.query("commit")`
 * directly on a pg Pool opens the transaction on a connection that is immediately handed
 * back "idle in transaction"; the following statements run on *different* connections and
 * the opener is orphaned. This helper checks out ONE client for the whole transaction and
 * releases it in `finally`, so BEGIN/COMMIT and every statement between them share one
 * backend connection, the transaction is actually atomic, and the transaction-local
 * `set_config(…, true)` audit vars are effective.
 *
 * Two shapes, one behaviour:
 *   - Given a Pool: check out one client, BEGIN/COMMIT/ROLLBACK on it, release it.
 *   - Given an already-acquired client (a PoolClient, or the integration tests' bare
 *     pg.Client): run the transaction on it directly and leave its lifecycle to the caller.
 *
 * ⚠ PACKAGE-BOUNDARY NOTE: the pool is detected STRUCTURALLY (`connect` + `totalCount`),
 * never by `instanceof Pool`. An instanceof check would silently fail when the host app's
 * `pg` is a different module instance than a package-side `pg` — and a mis-detected Pool
 * would recreate the exact BEGIN-on-Pool leak this helper exists to prevent. The structural
 * probe is true for every pg.Pool and false for pg.Client / PoolClient (neither carries
 * `totalCount`). This package deliberately has NO runtime `pg` dependency.
 */
export async function withTransaction<T>(
  db: Queryable,
  run: (tx: Queryable) => Promise<T>,
): Promise<T> {
  if (isPoolLike(db)) {
    const client = await db.connect();
    try {
      return await runInTransaction(client, run);
    } finally {
      client.release();
    }
  }
  return runInTransaction(db, run);
}

interface PoolLike extends Queryable {
  connect(): Promise<PoolClientLike>;
  totalCount: number;
}

interface PoolClientLike extends Queryable {
  release(): void;
}

function isPoolLike(db: Queryable): db is PoolLike {
  const candidate = db as Partial<PoolLike>;
  return typeof candidate.connect === "function" && typeof candidate.totalCount === "number";
}

async function runInTransaction<T>(
  client: Queryable,
  run: (tx: Queryable) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // A failed rollback (e.g. the connection is already gone) must not mask the original
      // error that put us here — swallow it and rethrow the real cause below.
    }
    throw err;
  }
}
