/**
 * org.credential lifecycle: issuance, supersession (reset), the M002 duplicate_pin
 * cross-person uniqueness at issuance, revoke, and status.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import {
  configureOrgContract,
  resetOrgContractConfig,
  computePinLookup,
  hashPin,
  issueActivePin,
  issueOrResetPin,
  revokeActivePin,
  getCredentialStatus,
  findActivePinCandidatesForLookup,
} from "../../src/index";
import { auditRows, connect, resetOrgSchema, seedPerson, testDatabaseUrl } from "./setup";

const RUN = testDatabaseUrl() ? describe : describe.skip;

RUN("credential store (integration)", () => {
  let db: Client;
  let personId: string;

  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    resetOrgContractConfig();
    configureOrgContract({ stationPinLookupSecret: () => "integration-lookup-key" });
    await resetOrgSchema(db);
    ({ personId } = await seedPerson(db, { fullName: "Pin Holder", email: "p@test.local" }));
  });

  async function pinInput(personId: string, pin: string) {
    return { personId, pinHash: await hashPin(pin), pinLookup: computePinLookup(pin) };
  }

  it("issues, then RESETS by supersession (one active per person, audited pin_issue → pin_reset)", async () => {
    const issued = await issueOrResetPin(db, await pinInput(personId, "935170"));
    expect(issued).toMatchObject({ result: "issued" });
    expect(await getCredentialStatus(db, personId)).toMatchObject({ pinSet: true });

    const reset = await issueOrResetPin(db, await pinInput(personId, "802461"));
    expect(reset).toMatchObject({ result: "reset" });

    const active = await db.query(
      `select count(*)::int as n from org.credential where person_id = $1 and active`,
      [personId],
    );
    expect(active.rows[0].n).toBe(1);
    expect((await auditRows(db, "pin_issue")).length).toBe(1);
    expect((await auditRows(db, "pin_reset")).length).toBe(1);
  });

  it("REFUSES a PIN another active person holds — duplicate_pin at issuance (M002, F1)", async () => {
    await issueOrResetPin(db, await pinInput(personId, "935170"));
    const other = await seedPerson(db, { fullName: "Other", email: "o@test.local" });
    const result = await issueOrResetPin(db, await pinInput(other.personId, "935170"));
    expect(result).toEqual({ result: "duplicate_pin" });
    // The refused person still has NO active credential (the txn rolled back atomically).
    expect(await getCredentialStatus(db, other.personId)).toMatchObject({ pinSet: false });
  });

  it("issueActivePin maps the one-active-per-person violation to duplicate_active", async () => {
    await issueActivePin(db, await pinInput(personId, "935170"));
    const second = await issueActivePin(db, await pinInput(personId, "802461"));
    expect(second).toEqual({ result: "duplicate_active" });
  });

  it("the lookup read returns the single keyed candidate (+ NULL-lookup rows only)", async () => {
    await issueOrResetPin(db, await pinInput(personId, "935170"));
    const other = await seedPerson(db, { fullName: "Legacy", email: "l@test.local" });
    await db.query(
      `insert into org.credential (person_id, kind, pin_hash, pin_lookup, active)
       values ($1, 'pin', $2, null, true)`,
      [other.personId, await hashPin("246800")],
    );
    const candidates = await findActivePinCandidatesForLookup(db, computePinLookup("935170"));
    // exactly: the keyed match + the one legacy NULL row riding the fail-safe
    expect(candidates.map((c) => c.personId).sort()).toEqual([personId, other.personId].sort());
  });

  it("revoke deactivates without replacement; a second revoke reports none_active", async () => {
    await issueOrResetPin(db, await pinInput(personId, "935170"));
    expect(await revokeActivePin(db, personId)).toEqual({ result: "revoked" });
    expect(await getCredentialStatus(db, personId)).toMatchObject({ pinSet: false });
    expect(await revokeActivePin(db, personId)).toEqual({ result: "none_active" });
  });
});
