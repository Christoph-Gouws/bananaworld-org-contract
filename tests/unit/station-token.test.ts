import { afterEach, describe, expect, it } from "vitest";

import {
  configureOrgContract,
  resetOrgContractConfig,
  mintStationToken,
  verifyStationToken,
} from "../../src/index";

const INPUT = {
  personId: "11111111-1111-4111-8111-111111111111",
  stationId: "22222222-2222-4222-8222-222222222222",
  stationSessionId: "33333333-3333-4333-8333-333333333333",
  autoLogoffMinutes: 30,
};

afterEach(() => resetOrgContractConfig());

describe("station-bound token (SEC-AUTH-003)", () => {
  it("fails CLOSED when the secret is not configured", async () => {
    await expect(mintStationToken(INPUT)).rejects.toThrowError(/not configured/);
  });

  it("mint → verify roundtrips the claims", async () => {
    configureOrgContract({ stationTokenSecret: () => "unit-test-token-key" });
    const minted = await mintStationToken(INPUT);
    expect(minted.expiresAtSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const claims = await verifyStationToken(minted.token);
    expect(claims).toEqual({
      personId: INPUT.personId,
      stationId: INPUT.stationId,
      stationSessionId: INPUT.stationSessionId,
    });
  });

  it("expiry IS the auto-logoff window", async () => {
    configureOrgContract({ stationTokenSecret: () => "unit-test-token-key" });
    const issuedAt = new Date(Date.now() - 31 * 60_000); // minted 31 min ago, 30-min window
    const minted = await mintStationToken({ ...INPUT, issuedAt });
    expect(await verifyStationToken(minted.token)).toBeNull();
  });

  it("rejects a token signed under a different secret (null, never a throw)", async () => {
    configureOrgContract({ stationTokenSecret: () => "key-A" });
    const minted = await mintStationToken(INPUT);
    configureOrgContract({ stationTokenSecret: () => "key-B" });
    expect(await verifyStationToken(minted.token)).toBeNull();
  });

  it("rejects garbage without throwing", async () => {
    configureOrgContract({ stationTokenSecret: () => "unit-test-token-key" });
    expect(await verifyStationToken("not.a.jwt")).toBeNull();
  });
});
