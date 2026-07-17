/**
 * The person ACCESS-STATUS read (v0.8.0, Org Admin EPIC-010-M001).
 *
 * The matrix that matters is the whole point of the feature: login-only · PIN-only · both ·
 * neither · inactive. Strategy gap G4 was that NOTHING in the estate could tell these apart,
 * so "granted a role but never given a login" surfaced as a generic login error far from its
 * cause. These tests are that distinction, pinned.
 *
 * The batch form additionally guards the query COUNT: an app users-screen renders a chip per
 * row, so an N+1 here would land in every consumer at once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { getPersonAccessStatus, getPersonAccessStatuses } from "../../src/index";
import { connect, resetOrgSchema, seedPerson, testDatabaseUrl } from "./setup";

const RUN = testDatabaseUrl() ? describe : describe.skip;

/** Give a person an estate login (what the M002 account desk will stamp). */
async function stampLogin(db: Client, personId: string): Promise<string> {
  const { rows } = await db.query(
    `update org.person set auth_user_id = gen_random_uuid()
      where id = $1 returning auth_user_id::text as auth_user_id`,
    [personId],
  );
  return rows[0].auth_user_id as string;
}

/** Give a person an active works PIN (kind='pin' — the only kind since migration #21). */
async function givePin(db: Client, personId: string): Promise<void> {
  await db.query(
    `insert into org.credential (person_id, kind, pin_hash, pin_lookup, active)
     values ($1, 'pin', 'not-a-real-hash', gen_random_uuid()::text, true)`,
    [personId],
  );
}

RUN("person access status (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await resetOrgSchema(db);
  });

  describe("the credential matrix — holding one never implies the other (strategy Rule 1)", () => {
    it("neither: a person with no login and no PIN", async () => {
      const { personId } = await seedPerson(db, { fullName: "Nobody", email: "n@test.local" });

      expect(await getPersonAccessStatus(db, personId)).toEqual({
        personId,
        status: "active",
        hasLogin: false,
        pinSet: false,
      });
    });

    it("PIN-only: the floor worker who scans but CANNOT log in — a deliberate state, not a bug", async () => {
      const { personId } = await seedPerson(db, { fullName: "Floor Worker" });
      await givePin(db, personId);

      const status = await getPersonAccessStatus(db, personId);
      expect(status).toMatchObject({ hasLogin: false, pinSet: true });
    });

    it("login-only: the office user with browser access and no PIN", async () => {
      const { personId } = await seedPerson(db, { fullName: "Office User", email: "o@test.local" });
      await stampLogin(db, personId);

      const status = await getPersonAccessStatus(db, personId);
      expect(status).toMatchObject({ hasLogin: true, pinSet: false });
    });

    it("both: a supervisor who logs in AND scans", async () => {
      const { personId } = await seedPerson(db, { fullName: "Supervisor", email: "s@test.local" });
      await stampLogin(db, personId);
      await givePin(db, personId);

      const status = await getPersonAccessStatus(db, personId);
      expect(status).toMatchObject({ hasLogin: true, pinSet: true });
    });
  });

  describe("status is reported independently of the credentials", () => {
    it("an INACTIVE person still reports their credentials — the caller reads status first", async () => {
      // The off-switch is org.person.status (strategy Rule 5): inactive denies at the next
      // request in every app regardless of credentials. This read reports the raw facts and
      // does NOT fold status into hasLogin/pinSet - a UI that showed "Login: no" for a
      // deactivated person would misrepresent WHY they cannot get in, and a reactivation
      // would look like it had to re-mint a login it never lost.
      const { personId } = await seedPerson(db, {
        fullName: "Leaver",
        email: "l@test.local",
        status: "inactive",
      });
      await stampLogin(db, personId);
      await givePin(db, personId);

      expect(await getPersonAccessStatus(db, personId)).toEqual({
        personId,
        status: "inactive",
        hasLogin: true,
        pinSet: true,
      });
    });
  });

  describe("a superseded PIN is not an active PIN", () => {
    it("pinSet is false once the only credential is deactivated", async () => {
      const { personId } = await seedPerson(db, { fullName: "Ex Scanner" });
      await givePin(db, personId);
      await db.query(`update org.credential set active = false where person_id = $1`, [personId]);

      const status = await getPersonAccessStatus(db, personId);
      expect(status).toMatchObject({ pinSet: false });
    });
  });

  describe("unknown and malformed ids are clean nulls, never DB errors", () => {
    it("returns null for a well-formed id that matches no person", async () => {
      expect(await getPersonAccessStatus(db, "00000000-0000-0000-0000-0000000000ff")).toBeNull();
    });

    it("returns null for a malformed id without touching the database", async () => {
      expect(await getPersonAccessStatus(db, "not-a-uuid")).toBeNull();
    });
  });

  describe("batch form", () => {
    it("resolves a mixed set correctly in ONE pass", async () => {
      const both = await seedPerson(db, { fullName: "Both", email: "b@test.local" });
      const loginOnly = await seedPerson(db, { fullName: "Login Only", email: "lo@test.local" });
      const pinOnly = await seedPerson(db, { fullName: "Pin Only" });
      const neither = await seedPerson(db, { fullName: "Neither" });

      await stampLogin(db, both.personId);
      await givePin(db, both.personId);
      await stampLogin(db, loginOnly.personId);
      await givePin(db, pinOnly.personId);

      const map = await getPersonAccessStatuses(db, [
        both.personId,
        loginOnly.personId,
        pinOnly.personId,
        neither.personId,
      ]);

      expect(map.size).toBe(4);
      expect(map.get(both.personId)).toMatchObject({ hasLogin: true, pinSet: true });
      expect(map.get(loginOnly.personId)).toMatchObject({ hasLogin: true, pinSet: false });
      expect(map.get(pinOnly.personId)).toMatchObject({ hasLogin: false, pinSet: true });
      expect(map.get(neither.personId)).toMatchObject({ hasLogin: false, pinSet: false });
    });

    it("agrees with the single read, person for person", async () => {
      const a = await seedPerson(db, { fullName: "A", email: "a@test.local" });
      const b = await seedPerson(db, { fullName: "B" });
      await stampLogin(db, a.personId);
      await givePin(db, b.personId);

      const map = await getPersonAccessStatuses(db, [a.personId, b.personId]);
      for (const id of [a.personId, b.personId]) {
        expect(map.get(id)).toEqual(await getPersonAccessStatus(db, id));
      }
    });

    it("omits unknown ids rather than inventing a credential-less person", async () => {
      const real = await seedPerson(db, { fullName: "Real" });
      const map = await getPersonAccessStatuses(db, [
        real.personId,
        "00000000-0000-0000-0000-0000000000ff",
        "not-a-uuid",
      ]);

      expect([...map.keys()]).toEqual([real.personId]);
    });

    it("is empty, and touches nothing, for an empty input", async () => {
      expect((await getPersonAccessStatuses(db, [])).size).toBe(0);
    });

    it("stays at TWO queries however many people are asked for — never an N+1", async () => {
      // The guard that matters for consumers: RMS/CRM render a chip per row on their user
      // screens. If this fanned out, the N+1 would land in every consumer at once. Counting
      // real queries is the only honest way to assert it.
      const people = [];
      for (let i = 0; i < 12; i++) {
        const p = await seedPerson(db, { fullName: `Person ${i}` });
        if (i % 2 === 0) await stampLogin(db, p.personId);
        if (i % 3 === 0) await givePin(db, p.personId);
        people.push(p.personId);
      }

      const original = db.query.bind(db);
      let queries = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).query = (...args: unknown[]) => {
        queries++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)(...args);
      };
      try {
        const map = await getPersonAccessStatuses(db, people);
        expect(map.size).toBe(12);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).query = original;
      }

      expect(queries).toBe(2);
    });
  });
});
