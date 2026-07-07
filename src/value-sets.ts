/**
 * The value sets the consumption contract itself speaks — kept in LOCKSTEP with the
 * database CHECK constraints (framework_check_recreate_superset / DB-MIG-003), exactly as
 * in the org-admin source they were extracted from. Org Admin's own value-sets module
 * re-exports these so there is ONE definition estate-wide.
 *
 * Deliberately minimal: the package carries only the sets the CONTRACT needs (the
 * consuming-app registry). Console/master-CRUD value sets stay in org-admin.
 *
 * Pure data — no DB, no server-only imports.
 */

/** `org.app.app_code` (DB-CON-018) — the registry of consuming systems (extensible). */
export const APP_CODES = ["dc", "crm", "rms"] as const;
export type AppCode = (typeof APP_CODES)[number];
