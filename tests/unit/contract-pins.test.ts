/**
 * Lockstep pins — the frozen value sets this package now owns estate-wide. A diff here is
 * a CONTRACT CHANGE: it requires an owner gate + a deliberate version bump in every
 * consumer, never a silent edit (AG-ADR-010 / the M2.3 scope decision / AG-ADR-003).
 */
import { describe, expect, it } from "vitest";

import {
  APP_CODES,
  MASTER_READ_SCOPE,
  appMayReadMaster,
  AUDIT_ACTIONS,
  AUDIT_APP_CODES,
  AUDIT_DENY_LAYERS,
  AUDIT_OUTCOMES,
  AUDIT_REDACTED_COLUMNS,
  SYSTEM_ACTOR_ID,
} from "../../src/index";

describe("consuming-app registry pin", () => {
  it("APP_CODES is exactly dc/crm/rms/mv", () => {
    // mv (Manga Verde) registered at v0.4.2 — EPIC-001-M-04, DECISION-080.
    expect([...APP_CODES]).toEqual(["dc", "crm", "rms", "mv"]);
  });
});

describe("least-privilege scope matrix pin (owner-approved, M2.3 gate; farm added at v0.3.0 — EPIC-008-M006, DECISION-GATE-014; station REMOVED at v0.6.0 — EPIC-008-M003 Station Partition Doctrine v2)", () => {
  it("is exactly the approved matrix", () => {
    expect(MASTER_READ_SCOPE).toEqual({
      dc: ["legal_entity", "entity_role", "site", "asset", "farm"],
      crm: ["legal_entity", "entity_role", "site"],
      rms: ["legal_entity", "site", "asset", "farm"],
      mv: ["legal_entity", "site"], // v0.4.2 — Manga Verde (DECISION-060/080)
    });
  });
  it("covers every registered app", () => {
    for (const app of APP_CODES) {
      expect(MASTER_READ_SCOPE[app].length).toBeGreaterThan(0);
    }
  });
  it("denies the un-granted reads", () => {
    expect(appMayReadMaster("crm", "asset")).toBe(false);
    expect(appMayReadMaster("crm", "farm")).toBe(false);
    expect(appMayReadMaster("rms", "entity_role")).toBe(false);
    expect(appMayReadMaster("dc", "farm")).toBe(true);
  });
});

describe("estate audit standard pin (AG-ADR-003)", () => {
  it("app codes / outcomes / deny layers are the frozen sets", () => {
    expect([...AUDIT_APP_CODES]).toEqual(["dc", "crm", "rms", "mv", "org"]);
    expect([...AUDIT_OUTCOMES]).toEqual(["success", "denied", "failed"]);
    expect([...AUDIT_DENY_LAYERS]).toEqual(["middleware", "repository", "rls", "trigger"]);
  });
  it("actions include the full estate superset", () => {
    for (const action of [
      "create",
      "update",
      "deactivate",
      "pin_issue",
      "pin_reset",
      "role_assign",
      "role_revoke",
      "login",
      "logout",
      "auto_logoff",
      "pin_failure",
      "master_read",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });
  it("the PIN hash is redacted and the system actor is the nil uuid", () => {
    expect(AUDIT_REDACTED_COLUMNS.credential).toEqual(["pin_hash"]);
    expect(SYSTEM_ACTOR_ID).toBe("00000000-0000-0000-0000-000000000000");
  });
});
