/**
 * The consuming-app registry — typed read over org.app (DB-DATA-010, DB-TABLE-010).
 *
 * org.app is the register of the systems that consume the central layer (DC, CRM, RMS;
 * extensible). The consumption contract (resolver, master-read) reads through this to
 * scope every call to a KNOWN, ACTIVE app — the first gate of least-privilege-per-app
 * consumption (API-PRINCIPLE-004, SEC-CONC-001). This module READS the registry; it never
 * writes it (org.app is administered by the Org Admin console).
 *
 * Server-side: pass any pg connection (Pool, Pool client or a test Client).
 */

import type { AppCode } from "../value-sets";
import type { Queryable } from "../queryable";

export interface ConsumingApp {
  appCode: AppCode;
  name: string;
  status: "active" | "inactive";
}

/** Thrown when a consumption call names an app that is not registered or not active. */
export class UnknownAppError extends Error {
  readonly appCode: string;
  constructor(appCode: string) {
    super(`Unknown or inactive consuming app: ${appCode}`);
    this.name = "UnknownAppError";
    this.appCode = appCode;
  }
}

/** The registered consuming apps (active only by default), ordered by code. */
export async function listConsumingApps(
  db: Queryable,
  options: { includeInactive?: boolean } = {},
): Promise<ConsumingApp[]> {
  const { rows } = await db.query(
    `select app_code, name, status
       from org.app
      where $1 or status = 'active'
      order by app_code`,
    [options.includeInactive === true],
  );
  return rows.map(toApp);
}

/** Resolve one app by code, or null if it is not registered. */
export async function resolveApp(db: Queryable, appCode: string): Promise<ConsumingApp | null> {
  const { rows } = await db.query(
    "select app_code, name, status from org.app where app_code = $1",
    [appCode],
  );
  const row = rows[0];
  return row ? toApp(row) : null;
}

/** Resolve one app, or throw UnknownAppError if it is not registered or not active.
 *  The guard every consumption-contract entry point calls first. */
export async function assertActiveApp(db: Queryable, appCode: string): Promise<ConsumingApp> {
  const app = await resolveApp(db, appCode);
  if (!app || app.status !== "active") {
    throw new UnknownAppError(appCode);
  }
  return app;
}

function toApp(row: Record<string, unknown>): ConsumingApp {
  return {
    appCode: row.app_code as AppCode,
    name: row.name as string,
    status: row.status as "active" | "inactive",
  };
}
