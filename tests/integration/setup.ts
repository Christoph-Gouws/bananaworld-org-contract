/**
 * Integration-test harness: a THROWAWAY Postgres (TEST_DATABASE_URL) + a minimal `org.*`
 * STAND-IN schema shaped exactly like the columns/functions this package touches — the
 * same pattern the consumer repos' seam tests use. The real schema lives in org-admin's
 * migrations; org-admin's own integration suite exercises this package against it.
 *
 * ⚠ ENV-DEV-002: this file DROPS SCHEMA org CASCADE. Only ever point TEST_DATABASE_URL at
 * a disposable database (the CI service container / a local throwaway docker PG).
 */

import { Client } from "pg";

export function testDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL;
}

export async function connect(): Promise<Client> {
  const url = testDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Drop + recreate the stand-in `org` schema (fresh per test file). */
export async function resetOrgSchema(db: Client): Promise<void> {
  await db.query("drop schema if exists org cascade");
  await db.query("create schema org");
  await db.query(`
    create table org.app (
      app_code text primary key,
      name text not null,
      status text not null default 'active'
    );

    create table org.legal_entity (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null,
      status text not null default 'active'
    );

    create table org.person (
      id uuid primary key default gen_random_uuid(),
      full_name text not null,
      email text unique,
      login text unique,
      status text not null default 'active',
      home_legal_entity_id uuid not null references org.legal_entity(id),
      -- v0.3.1 (EPIC-008-M006): the ONE estate browser login (org-admin migration #22)
      auth_user_id uuid unique
    );

    create table org.credential (
      id uuid primary key default gen_random_uuid(),
      person_id uuid not null references org.person(id),
      kind text not null,
      pin_hash text,
      pin_lookup text,
      active boolean not null default true,
      set_at timestamptz not null default now(),
      created_by uuid,
      updated_by uuid
    );
    create unique index credential_one_active_per_person
      on org.credential (person_id) where active;
    create unique index credential_pin_lookup_unique
      on org.credential (pin_lookup) where active and kind = 'pin' and pin_lookup is not null;

    create table org.station (
      id uuid primary key default gen_random_uuid(),
      name text not null default 'Test Station',
      auto_logoff_minutes int not null default 30,
      failed_pin_attempts int not null default 0,
      pin_first_failed_at timestamptz,
      pin_locked_at timestamptz
    );

    create table org.station_session (
      id uuid primary key default gen_random_uuid(),
      station_id uuid not null references org.station(id),
      person_id uuid not null references org.person(id),
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      created_by uuid
    );

    -- ⚠ TD-M001-001 (fixed, EPIC-010-M005 gate ruling): this stand-in previously drifted
    -- from the REAL org.audit_log — 'entity_type' vs the real 'entity', 'created_at' vs
    -- the real 'at', a bigint id vs the real uuid, and none of the real CHECKs. Two stale
    -- things agreeing look exactly like lockstep: the package's audit tests were passing
    -- against a table shape that exists nowhere. Kept aligned to org-admin migrations
    -- ...0630000008 (table) + ...0630000011 (writer) + ...0717000001 (the live action
    -- CHECK). If org-admin re-cuts either, re-cut THIS in the same change.
    create table org.audit_log (
      id uuid primary key default gen_random_uuid(),
      actor_person_id uuid not null,
      app_code text not null,
      action text not null check (action in (
        'create', 'update', 'deactivate',
        'pin_issue', 'pin_reset',
        'role_assign', 'role_revoke',
        'login', 'logout', 'auto_logoff', 'pin_failure',
        'audit_log_read', 'audit_log_export',
        'master_read',
        'login_issue', 'login_link_issue', 'login_reconcile',
        'session_revoke', 'invite_send'
      )),
      entity text not null check (length(trim(entity)) > 0),
      entity_id uuid,
      before jsonb,
      after jsonb,
      outcome text not null default 'success' check (outcome in ('success', 'denied', 'failed')),
      deny_layer text,
      at timestamptz not null default now(),
      constraint audit_log_deny_layer_when_denied check (
        (outcome = 'denied' and deny_layer in ('middleware', 'repository', 'rls', 'trigger'))
        or (outcome <> 'denied' and deny_layer is null)
      )
    );

    -- Stand-in for the SECURITY DEFINER app-path writer (M1.3) — the real signature,
    -- defaults and coalesces (org-admin ...0630000011). SECURITY DEFINER itself is not
    -- reproduced: the stand-in has no RLS to bypass, and the calling surface is identical.
    create function org.audit_write_app(
      p_actor uuid, p_app_code text, p_action text, p_entity text, p_entity_id uuid,
      p_before jsonb, p_after jsonb, p_outcome text default 'success',
      p_deny_layer text default null
    ) returns uuid language plpgsql as $$
    declare
      v_id uuid;
    begin
      insert into org.audit_log
        (actor_person_id, app_code, action, entity, entity_id, before, after, outcome, deny_layer)
      values
        (coalesce(p_actor, '00000000-0000-0000-0000-000000000000'::uuid),
         coalesce(nullif(p_app_code, ''), 'org'),
         p_action, p_entity, p_entity_id, p_before, p_after,
         coalesce(nullif(p_outcome, ''), 'success'), p_deny_layer)
      returning id into v_id;
      return v_id;
    end;
    $$;

    -- The frozen boundary-view shapes, as stand-in TABLES (a table satisfies the same
    -- SELECTs; the real views are proven by org-admin's own migration-backed suite).
    create table org.v_master_legal_entity (
      id uuid primary key default gen_random_uuid(),
      name text not null, slug text not null, status text not null default 'active',
      -- v0.2.0 (EPIC-008-M006): the re-homed business fields (org-admin migration #21)
      functional_currency text, default_language text, registration_no text, tax_no text
    );
    create table org.v_master_entity_role (
      id uuid primary key default gen_random_uuid(),
      legal_entity_id uuid not null, role_type text not null
    );
    create table org.v_master_farm (
      id uuid primary key default gen_random_uuid(),
      -- v0.3.0 (EPIC-008-M006): farm is LISTABLE via readMaster — carries the owner link
      legal_entity_id uuid,
      code text not null, name text not null, status text not null default 'active'
    );
    create table org.v_master_site (
      id uuid primary key default gen_random_uuid(),
      legal_entity_id uuid, site_type text not null, name text not null
    );
    create table org.v_master_asset (
      id uuid primary key default gen_random_uuid(),
      legal_entity_id uuid, asset_type text not null, identifier text not null,
      status text not null default 'active', steward_app text,
      registration text, description text
    );
    -- (org.v_master_station stand-in REMOVED at v0.6.0 — EPIC-008-M003 Station Partition Doctrine
    --  v2: station is no longer a central master; the boundary no longer serves station reads.)
    create table org.v_estate_station (
      station_id uuid primary key default gen_random_uuid(),
      owner_app text not null, kind text not null, code text not null, name text not null,
      active boolean not null default true, site_id uuid, site_name text
    );
  `);
  // The consuming-app registry rows the contract gates on.
  await db.query(`
    insert into org.app (app_code, name, status) values
      ('dc', 'Bananaworld-DC', 'active'),
      ('crm', 'Bananaworld-CRM', 'active'),
      ('rms', 'Bananaworld-RMS', 'active')
  `);
}

export async function seedPerson(
  db: Client,
  opts: { fullName: string; email?: string; status?: string },
): Promise<{ personId: string; legalEntityId: string }> {
  const le = await db.query(
    `insert into org.legal_entity (name, slug) values ('Test Co', 'test-co-' || gen_random_uuid())
     returning id::text as id`,
  );
  const legalEntityId = le.rows[0].id as string;
  const p = await db.query(
    `insert into org.person (full_name, email, status, home_legal_entity_id)
     values ($1, $2, $3, $4) returning id::text as id`,
    [opts.fullName, opts.email ?? null, opts.status ?? "active", legalEntityId],
  );
  return { personId: p.rows[0].id as string, legalEntityId };
}

export async function seedStation(
  db: Client,
  opts: { autoLogoffMinutes?: number } = {},
): Promise<string> {
  const r = await db.query(
    `insert into org.station (auto_logoff_minutes) values ($1) returning id::text as id`,
    [opts.autoLogoffMinutes ?? 30],
  );
  return r.rows[0].id as string;
}

export async function auditRows(
  db: Client,
  action?: string,
): Promise<Array<Record<string, unknown>>> {
  // ⚠ `order by at`, not `id` — the real id is a random uuid (gen_random_uuid()), so id
  // order is meaningless. Autocommit inserts get distinct now() values.
  const { rows } = action
    ? await db.query(`select * from org.audit_log where action = $1 order by at`, [action])
    : await db.query(`select * from org.audit_log order by at`);
  return rows;
}
