import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureOrgContract,
  resetOrgContractConfig,
  decideCaptureAcceptance,
  drainSessionDbClaims,
  isDrainSession,
  mintDrainSession,
  mintStationToken,
  signCapture,
  verifyDrainSession,
  verifySignedCapture,
  verifyStationToken,
  DRAIN_SESSION_MAX_SECONDS,
  type CaptureDevice,
  type CaptureEnvelope,
} from "../../src/index";

type CryptoKey = import("node:crypto").webcrypto.CryptoKey;
const enc = (s: string) => new TextEncoder().encode(s);
const PERSON = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "dev-1";
const KEYS = { capture: "capture-key", drain: "drain-key", station: "station-key" };

async function floorJwt(over: { key?: string; deviceId?: string; sub?: string | null } = {}) {
  const jwt = new SignJWT({ device_id: over.deviceId ?? DEVICE_ID, device_session_id: "ds-1" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.parse("2026-10-11T06:00:00Z") / 1000))
    .setExpirationTime(Math.floor(Date.parse("2026-10-11T08:00:00Z") / 1000));
  if (over.sub !== null) jwt.setSubject(over.sub ?? PERSON);
  return jwt.sign(enc(over.key ?? KEYS.capture));
}

async function setup() {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey));
  const device: CaptureDevice = {
    id: DEVICE_ID,
    publicKeySpki: Buffer.from(spki).toString("base64"),
    registered: true,
  };
  return { privateKey: pair.privateKey, device };
}

async function signed(privateKey: CryptoKey, over: Partial<CaptureEnvelope> = {}) {
  const envelope: CaptureEnvelope = {
    kind: "action",
    // A person id in the body must be ignored.
    action: { person_id: "99999999-9999-4999-8999-999999999999", op: "weigh" },
    idempotencyKey: "cap-1",
    sequence: 1,
    jwt: await floorJwt(),
    deviceTime: "2026-10-11T07:00:00.000Z",
    ...over,
  };
  return { envelope, signature: await signCapture(privateKey, envelope) };
}

beforeEach(() =>
  configureOrgContract({
    captureTokenKey: () => KEYS.capture,
    drainSessionSecret: () => KEYS.drain,
    stationTokenSecret: () => KEYS.station,
  }),
);
afterEach(() => {
  resetOrgContractConfig();
  vi.useRealTimers();
});

describe("verifySignedCapture", () => {
  it("accepts a valid capture; the person comes from the token only", async () => {
    const { privateKey, device } = await setup();
    const result = await verifySignedCapture(await signed(privateKey), device);
    expect(result).toMatchObject({ ok: true, capture: { personId: PERSON, deviceId: DEVICE_ID } });
  });

  it("refuses an unregistered / keyless device first", async () => {
    const { privateKey, device } = await setup();
    const s = await signed(privateKey);
    expect(await verifySignedCapture(s, { ...device, registered: false })).toEqual({
      ok: false,
      code: "device_not_registered",
    });
    expect(await verifySignedCapture(s, { ...device, publicKeySpki: null })).toEqual({
      ok: false,
      code: "device_not_registered",
    });
  });

  it("refuses a JWT under another key, for another device, malformed, or missing a claim", async () => {
    const { privateKey, device } = await setup();
    for (const jwt of [
      await floorJwt({ key: "other-key" }),
      await floorJwt({ deviceId: "dev-2" }),
      await floorJwt({ sub: null }),
      "not.a.jwt",
    ]) {
      expect(await verifySignedCapture(await signed(privateKey, { jwt }), device)).toEqual({
        ok: false,
        code: "capture_signature_invalid",
      });
    }
  });

  it("refuses a bad device signature and a tampered envelope", async () => {
    const { privateKey, device } = await setup();
    const s = await signed(privateKey);
    expect(
      await verifySignedCapture({ ...s, envelope: { ...s.envelope, sequence: 2 } }, device),
    ).toEqual({ ok: false, code: "capture_signature_invalid" });
    expect(await verifySignedCapture({ ...s, signature: "AAAA" }, device)).toEqual({
      ok: false,
      code: "capture_signature_invalid",
    });
  });

  it("does not enforce the token's own expiry (the grace window replaces it)", async () => {
    const { privateKey, device } = await setup();
    const result = await verifySignedCapture(await signed(privateKey), device);
    expect(result.ok).toBe(true); // the floor JWT above expired in 2026-10-11T08:00Z
  });

  it("fails closed when captureTokenKey is not configured", async () => {
    const { privateKey, device } = await setup();
    const s = await signed(privateKey);
    resetOrgContractConfig();
    await expect(verifySignedCapture(s, device)).rejects.toThrowError(/not configured/);
  });
});

describe("drain session", () => {
  async function accepted() {
    const { privateKey, device } = await setup();
    const verified = await verifySignedCapture(await signed(privateKey), device);
    if (!verified.ok) throw new Error("setup failed");
    const acceptance = decideCaptureAcceptance({
      tokenRecord: {
        issuedAt: verified.capture.tokenIssuedAt,
        expiresAt: verified.capture.tokenExpiresAt,
        revokedAt: null,
        signedOutAtSequence: null,
      },
      sequence: 1,
      deviceTime: verified.capture.deviceTime,
      receivedAt: new Date("2026-10-11T08:30:00Z"),
      graceMinutes: 90,
    });
    if (!acceptance.ok) throw new Error("setup failed");
    return { capture: verified.capture, acceptance };
  }
  const mint = async (ttlSeconds?: number) =>
    mintDrainSession({
      ...(await accepted()),
      personStillPermitted: true,
      deviceStillRegistered: true,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    });

  it("round-trips, acting only as the token's person", async () => {
    const { token, expiresAt } = await mint();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const claims = await verifyDrainSession(token);
    expect(claims).toEqual({
      personId: PERSON,
      deviceId: DEVICE_ID,
      deviceSessionId: "ds-1",
      captureId: "cap-1",
    });
    expect(await isDrainSession(token)).toBe(true);
    expect(drainSessionDbClaims(claims!)).toMatchObject({
      sub: PERSON,
      person_id: PERSON,
      role: "authenticated",
      bw_session: "drain",
    });
  });

  it("is refused after 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T08:30:00Z"));
    const { token } = await mint();
    vi.setSystemTime(new Date("2026-10-11T08:36:00Z"));
    expect(await verifyDrainSession(token)).toBeNull();
  });

  it("caps the lifetime at 300 s", async () => {
    await expect(mint(DRAIN_SESSION_MAX_SECONDS + 1)).rejects.toThrow();
    await expect(mint(0)).rejects.toThrow();
    await expect(mint(60)).resolves.toBeDefined();
  });

  it("a drain token is refused by verifyStationToken; a station token by verifyDrainSession", async () => {
    const { token } = await mint();
    // Even when the station secret WERE the drain secret, the marker still refuses it.
    expect(await verifyStationToken(token)).toBeNull();
    configureOrgContract({ stationTokenSecret: () => KEYS.drain });
    expect(await verifyStationToken(token)).toBeNull();
    const station = await mintStationToken({
      personId: PERSON,
      stationId: "s",
      stationSessionId: "ss",
      autoLogoffMinutes: 10,
    });
    configureOrgContract({ stationTokenSecret: () => KEYS.station });
    expect(await verifyDrainSession(station.token)).toBeNull();
    expect(await isDrainSession("garbage")).toBe(false);
  });

  it("refuses a token with the right key but no audience / marker", async () => {
    const bare = await new SignJWT({ person_id: PERSON, bw_session: "drain" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(PERSON)
      .setExpirationTime("5m")
      .sign(enc(KEYS.drain));
    expect(await verifyDrainSession(bare)).toBeNull();
  });

  it("refuses to run when the drain secret equals another token key", async () => {
    configureOrgContract({ drainSessionSecret: () => KEYS.station });
    await expect(mint()).rejects.toThrowError(/must differ/);
    configureOrgContract({ drainSessionSecret: () => KEYS.capture });
    await expect(verifyDrainSession("x")).rejects.toThrowError(/must differ/);
  });

  it("fails closed when drainSessionSecret is not configured", async () => {
    const m = await accepted();
    resetOrgContractConfig();
    await expect(
      mintDrainSession({ ...m, personStillPermitted: true, deviceStillRegistered: true }),
    ).rejects.toThrowError(/not configured/);
  });
});
