/**
 * The master-read contract — FROZEN (API-MASTER-001, AG-ADR-010). A consumer reads the
 * shared legal-entity / entity-role / site / asset / station lists read-only through this
 * one boundary; it holds no copy (OD-005).
 *
 * THREE gates, in order, identical across both sources (so a denial is the same either
 * side — error-model parity, API-STUB-DEV-003):
 *   1. Known, ACTIVE consuming app (UnknownAppError → UNKNOWN_APP).
 *   2. Least-privilege scope (scope.ts): an app reading a master it is not granted gets
 *      ForbiddenScopeError → FORBIDDEN_SCOPE, no row data leaked (API-TEST-005); the
 *      denial is audited in CENTRAL mode (action `master_read`, outcome `denied`).
 *   3. The rows — from the selected source — filtered + paged identically.
 *
 * The injected `mastersMode` (config.ts) selects the source: `central` reads the real
 * `org.v_master_*` boundary views (PROD); `stub` reads the in-memory fixtures (the RMS DEV
 * sandbox, where `org.*` is absent — so the app gate + scope + rows ALL come from memory
 * there). The consumer call site never branches on environment (API-PRINCIPLE-008). A
 * production deploy left in `stub` mode is refused (assertMastersModeSafe — AG-ADR-006).
 *
 * Server-side: pass any pg connection (Pool, Pool client or a test Client). In stub mode
 * the connection is unused.
 */

import { assertActiveApp, UnknownAppError } from "../registry/apps";
import { SYSTEM_ACTOR_ID } from "../audit/standard";
import { beginAppAudit, writeAppAudit } from "../audit/app-writer";
import { assertMastersModeSafe, getMastersMode } from "../config";
import { APP_CODES } from "../value-sets";
import { withTransaction } from "../db/tx";
import type { Queryable } from "../queryable";
import { appMayReadMaster } from "./scope";
import { STUB_MASTERS } from "./stub-masters";
import {
  ForbiddenScopeError,
  type MasterName,
  type MasterReadRequest,
  type MasterReadResult,
  type MasterRow,
} from "./types";

const PAGE_SIZE = 50; // API-PAGE-001 default (max 200).

interface MasterConfig {
  /** Central SELECT list; the boundary view is aliased `t`. */
  select: string;
  /** Central FROM clause — the `org.v_master_*` boundary read view (M2.3). */
  from: string;
  /** Safe filter allow-list: request filter key → the BARE column/field name (never
   *  interpolated as a value). Central reads `t.<bare>`; stub reads `row[<bare>]`. */
  filters: Record<string, string>;
  /** Optional central row shaper (asset: steward_app → stewardApp, drop null). */
  map?: (row: Record<string, unknown>) => MasterRow;
}

const MASTERS: Record<MasterName, MasterConfig> = {
  legal_entity: {
    // v0.2.1 (Org Admin EPIC-008-M006): + the re-homed business fields — additive on the
    // frozen surface (org-admin migration #21 extends the boundary view in lockstep). The
    // v0.2.0 release note claimed this select change but shipped without it — the org-admin
    // stub/central parity gate caught the divergence; fixed here.
    select:
      "t.id::text as id, t.name, t.slug, t.status, t.functional_currency, " +
      "t.default_language, t.registration_no, t.tax_no",
    from: "org.v_master_legal_entity t",
    // `id` (v0.4.1) is the uniform by-own-id filter — an indexed single-row read for a
    // consumer's detail view (DC's read-only central-master form, EPIC-008-M007 §E). The
    // historical `legal_entity_id` alias is kept (a legal entity's own id IS its
    // legal_entity_id); both map to the indexed `id` column.
    filters: { status: "status", legal_entity_id: "id", id: "id" },
  },
  entity_role: {
    select: "t.id::text as id, t.legal_entity_id::text as legal_entity_id, t.role_type",
    from: "org.v_master_entity_role t",
    filters: { legal_entity_id: "legal_entity_id", role_type: "role_type" },
  },
  site: {
    select: "t.id::text as id, t.legal_entity_id::text as legal_entity_id, t.site_type, t.name",
    from: "org.v_master_site t",
    filters: { legal_entity_id: "legal_entity_id", site_type: "site_type" },
  },
  asset: {
    select:
      "t.id::text as id, t.legal_entity_id::text as legal_entity_id, t.asset_type, " +
      "t.identifier, t.status, t.steward_app",
    from: "org.v_master_asset t",
    filters: { legal_entity_id: "legal_entity_id", asset_type: "asset_type", status: "status" },
    map: (row) => {
      const { steward_app, ...rest } = row;
      return steward_app == null
        ? (rest as MasterRow)
        : ({ ...rest, stewardApp: steward_app as string } as MasterRow);
    },
  },
  station: {
    select:
      "t.id::text as id, t.station_kind, t.site_id::text as site_id, " +
      "t.asset_id::text as asset_id, t.code, t.name",
    from: "org.v_master_station t",
    filters: { station_kind: "station_kind", site_id: "site_id", asset_id: "asset_id" },
  },
  farm: {
    // v0.3.0 (EPIC-008-M006): farms became LISTABLE — post-teardown DC/RMS pickers read
    // central farms directly (a farm is a site owned by a legal entity, EPIC-008-M001;
    // v_master_farm.id IS the org.site id).
    select:
      "t.id::text as id, t.legal_entity_id::text as legal_entity_id, t.code, t.name, t.status",
    from: "org.v_master_farm t",
    // `id` (v0.4.1) is the by-own-id filter — the indexed single-row read backing DC's
    // read-only central-master detail view (EPIC-008-M007 §E; mirrors legal_entity).
    // `legal_entity_id` here filters by the OWNING company, not the farm's own id.
    filters: { legal_entity_id: "legal_entity_id", status: "status", code: "code", id: "id" },
  },
};

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { o?: unknown };
    const offset = Number(parsed.o);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64");
}

/** Slice the page out of an already-ordered row set + emit the next cursor. Shared by
 *  both sources so paging behaves identically (API-PAGE-001). */
function paginate(rows: MasterRow[], offset: number): MasterReadResult {
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return hasMore ? { items, nextCursor: encodeCursor(offset + PAGE_SIZE) } : { items };
}

/** Audit a least-privilege denial to the immutable log (CENTRAL only — the stub sandbox
 *  has no `org.audit_log`; the consumer-facing error is identical either way). One row
 *  per denial via the M1.3 app-path writer: action `master_read`, outcome `denied`,
 *  deny_layer `repository`. Never any row data. */
async function auditScopeDenied(db: Queryable, req: MasterReadRequest): Promise<void> {
  await withTransaction(db, async (tx) => {
    await beginAppAudit(tx);
    await writeAppAudit(tx, {
      actor: SYSTEM_ACTOR_ID,
      appCode: req.appCode,
      action: "master_read",
      entity: req.master,
      entityId: null,
      after: { reason: "forbidden_scope", master: req.master, app_code: req.appCode },
      outcome: "denied",
      denyLayer: "repository",
    });
  });
}

async function readCentral(
  db: Queryable,
  cfg: MasterConfig,
  req: MasterReadRequest,
): Promise<MasterReadResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (req.filter) {
    for (const [key, bare] of Object.entries(cfg.filters)) {
      if (key in req.filter) {
        params.push(req.filter[key]);
        where.push(`t.${bare} = $${params.length}`);
      }
    }
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const offset = decodeCursor(req.cursor);
  params.push(PAGE_SIZE + 1); // one extra row detects a next page
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await db.query(
    `select ${cfg.select} from ${cfg.from} ${whereSql} order by t.id limit $${limitIdx} offset $${offsetIdx}`,
    params,
  );
  const shaped = cfg.map ? rows.map(cfg.map) : (rows as MasterRow[]);
  return paginate(shaped, offset);
}

function readStub(cfg: MasterConfig, req: MasterReadRequest): MasterReadResult {
  let rows = [...STUB_MASTERS[req.master]];
  if (req.filter) {
    for (const [key, bare] of Object.entries(cfg.filters)) {
      if (key in req.filter) {
        const want = req.filter[key];
        rows = rows.filter((r) => r[bare] != null && String(r[bare]) === want);
      }
    }
  }
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const offset = decodeCursor(req.cursor);
  // Take one extra (like central's PAGE_SIZE+1) so `paginate` detects a next page.
  return paginate(rows.slice(offset, offset + PAGE_SIZE + 1), offset);
}

export async function readMaster(db: Queryable, req: MasterReadRequest): Promise<MasterReadResult> {
  // Fail closed: a production deploy must never serve the DEV stub (AG-ADR-006).
  assertMastersModeSafe();
  const mode = getMastersMode();

  // Gate 1: the caller must be a registered, active consuming app (least-privilege per app).
  if (mode === "stub") {
    // The sandbox has no org.app table — validate against the known registry in memory.
    if (!APP_CODES.includes(req.appCode)) throw new UnknownAppError(req.appCode);
  } else {
    await assertActiveApp(db, req.appCode);
  }

  // Gate 2: least-privilege scope. A denial is audited (central) and never leaks row data.
  if (!appMayReadMaster(req.appCode, req.master)) {
    if (mode === "central") await auditScopeDenied(db, req);
    throw new ForbiddenScopeError(req.appCode, req.master);
  }

  const cfg = MASTERS[req.master];
  if (!cfg) throw new Error(`Unknown master: ${req.master}`);

  // Gate 3: the rows, from the selected source, filtered + paged identically.
  return mode === "stub" ? readStub(cfg, req) : readCentral(db, cfg, req);
}
