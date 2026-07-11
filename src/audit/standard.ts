/**
 * The estate AUDIT STANDARD — Org Admin owns it (AG-ADR-003, SEC-AUDIT-001); this package
 * is its single app-side home from EPIC-008-M005 (org-admin re-exports it).
 *
 * The source of truth for the `org.audit_log` value sets + redaction rules, kept in
 * LOCKSTEP with the database CHECK constraints and the auto-write trigger
 * (framework_check_recreate_superset / DB-MIG-003). Whenever a value is added to one of
 * these sets, the DB CHECK is recreated with the FULL superset + the new value and this
 * file is updated in the same change. Org-admin's unit test pins these so code/schema
 * drift is caught before it ships.
 *
 * This is the standard each consuming app's own conforming log is built to: DC's live
 * `public.audit_log` conforms; RMS's `rms.audit_log` is built to it (XSYS-RMS-003); the
 * unified read-only viewer federates the per-app logs into one estate-wide timeline.
 *
 * Pure data — no DB, no server-only imports — importable from anywhere (UI, API, tests).
 */

/** `org.audit_log.app_code` (DB-FIELD-050) — the system through which a change was
 *  made. Superset of the consuming-app registry (dc/crm/rms/mv) + `org` (Org Admin
 *  itself, the auto-write default). */
export const AUDIT_APP_CODES = ["dc", "crm", "rms", "mv", "org"] as const;
export type AuditAppCode = (typeof AUDIT_APP_CODES)[number];

/** `org.audit_log.action` (DB-FIELD-051) — the estate action superset (DC-aligned +
 *  org-specific). The auto-write trigger emits only the master-lifecycle actions
 *  (`create`/`update`/`deactivate`); the rest are wired by their owning flows. */
export const AUDIT_ACTIONS = [
  // master lifecycle (auto-write, M1.3)
  "create",
  "update",
  "deactivate",
  // credential events (Epic 2 / console)
  "pin_issue",
  "pin_reset",
  // console role grants (M1.4 / Epic 4)
  "role_assign",
  "role_revoke",
  // auth events (Epic 2)
  "login",
  "logout",
  "auto_logoff",
  "pin_failure",
  // (the strangler cutover actions — cutover_switch_reads/_move_admin/_retire_ownership —
  // were RETIRED at Org Admin EPIC-008-M006: never emitted by any writer, 0 rows estate-wide;
  // the DB CHECK is recreated without them in org-admin migration #21)
  // audit viewer reads (Epic 4)
  "audit_log_read",
  "audit_log_export",
  // consumption-contract least-privilege denial (Epic 2 / M2.3) — a master read an app
  // is not granted is audited (outcome='denied', deny_layer='repository'); successful
  // reads use operational logging (API-LOG-003), not the immutable trail.
  "master_read",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** `org.audit_log.outcome` (DB-FIELD-061) — DC-aligned. The auto-write trigger always
 *  records `success`; `denied`/`failed` come from auth + authorization events. */
export const AUDIT_OUTCOMES = ["success", "denied", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** `org.audit_log.deny_layer` (DB-FIELD-062) — the authorization layer that denied,
 *  present exactly when `outcome='denied'` (DC parity). */
export const AUDIT_DENY_LAYERS = ["middleware", "repository", "rls", "trigger"] as const;
export type AuditDenyLayer = (typeof AUDIT_DENY_LAYERS)[number];

/** Secret columns stripped from `before`/`after` in EVERY audit write path (the DB
 *  auto-write trigger and any app-layer writer). The PIN hash is NEVER written to the
 *  trail (DB-AUDIT-004, SEC-AUDIT-002). Keyed by bare table name; kept in lockstep with
 *  the redaction branch in org-admin migration `…0010_audit_auto_write.sql`. */
export const AUDIT_REDACTED_COLUMNS: Record<string, readonly string[]> = {
  credential: ["pin_hash"],
};

/** The sentinel actor for system / unattributed changes (e.g. a migration seed) when
 *  no human actor (created_by/updated_by) and no `app.actor_person_id` session var is
 *  set. Satisfies `org.audit_log.actor_person_id` NOT NULL (DB-CON-020); DB-FIELD-049
 *  permits a service-account id. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** Transaction-local session variables the auto-write trigger reads. An app-layer
 *  writer sets `audit_source='application'` to short-circuit the trigger, and
 *  `actor_person_id` / `app_code` to attribute the change. */
export const AUDIT_SESSION_VARS = {
  source: "app.audit_source",
  actor: "app.actor_person_id",
  appCode: "app.app_code",
} as const;
