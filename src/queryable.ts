/**
 * The minimal pg surface every function in this package speaks (the estate's proven
 * injection seam — a pg Pool, a pooled PoolClient, and a bare test Client all satisfy it).
 *
 * The package NEVER constructs a connection: the host app owns its pool (and its pooler
 * doctrine — the estate runs the 6543 transaction pooler) and passes a connection in.
 *
 * `rowCount` is optional so consumers' existing fake test clients (which return only
 * `{ rows }`) remain structurally assignable.
 */
export interface Queryable {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}
