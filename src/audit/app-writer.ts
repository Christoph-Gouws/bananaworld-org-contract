/**
 * The app-path audit writer — the ONE place the package calls the SECURITY DEFINER
 * function `org.audit_write_app(...)` (M1.3). Before extraction this call was re-spelled
 * inline in four modules across four repos; a drift in argument order or redaction was the
 * exact class of risk M005 exists to kill.
 *
 * `beginAppAudit` sets the transaction-local `app.audit_source='application'` var so the
 * M1.3 auto-write trigger is short-circuited and the richer app-shaped row below is the
 * only audit entry for the change. Callers run BOTH inside one transaction
 * (`withTransaction`) so the set_config is effective and atomic with the write.
 *
 * The PIN and its hash are NEVER passed here (SEC-CRED-001 / SEC-AUDIT-002).
 */

import type { Queryable } from "../queryable";
import type { AuditAction, AuditAppCode, AuditDenyLayer, AuditOutcome } from "./standard";

/** Short-circuit the auto-write trigger for the current transaction (a no-op where the
 *  trigger is absent — e.g. a consumer's stand-in test schema). */
export async function beginAppAudit(db: Queryable): Promise<void> {
  await db.query("select set_config('app.audit_source', 'application', true)");
}

export interface AppAuditInput {
  /** The attributed actor (a person id, or SYSTEM_ACTOR_ID for unresolved outcomes). */
  readonly actor: string;
  readonly appCode: AuditAppCode;
  readonly action: AuditAction;
  /** The bare entity name (e.g. `station`, `station_session`, `credential`). */
  readonly entity: string;
  /** The entity's uuid, or null where there is no single row (e.g. a scope denial). */
  readonly entityId: string | null;
  readonly before?: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly outcome: AuditOutcome;
  readonly denyLayer: AuditDenyLayer | null;
}

/** Record one app-path audit row via `org.audit_write_app`. Never the PIN or its hash. */
export async function writeAppAudit(db: Queryable, input: AppAuditInput): Promise<void> {
  await db.query(
    `select org.audit_write_app($1::uuid, $2, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8, $9)`,
    [
      input.actor,
      input.appCode,
      input.action,
      input.entity,
      input.entityId,
      input.before == null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after),
      input.outcome,
      input.denyLayer,
    ],
  );
}
