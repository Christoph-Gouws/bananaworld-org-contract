import { afterEach, describe, expect, it } from "vitest";

import {
  configureOrgContract,
  resetOrgContractConfig,
  computePinLookup,
  hashPin,
  verifyPin,
  isPinLocked,
  isTrivialPin,
  registerFailedAttempt,
  validatePinStrength,
  pinLockoutThreshold,
  pinLockoutWindowMin,
  PIN_LENGTH,
  type PinLockoutState,
} from "../../src/index";

const T0 = new Date("2026-07-07T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const CLEAN: PinLockoutState = { failedPinAttempts: 0, pinFirstFailedAt: null, pinLockedAt: null };

afterEach(() => resetOrgContractConfig());

describe("PIN strength (issuance)", () => {
  it("accepts a strong 6-digit PIN", () => {
    expect(validatePinStrength("258013")).toEqual({ ok: true });
  });
  it("rejects non-digits, wrong length, and trivial runs", () => {
    expect(validatePinStrength("25a013").ok).toBe(false);
    expect(validatePinStrength("2580").ok).toBe(false);
    expect(validatePinStrength("111111").ok).toBe(false);
    expect(validatePinStrength("123456").ok).toBe(false);
    expect(validatePinStrength("654321").ok).toBe(false);
  });
  it("isTrivialPin flags repeats and ±1 runs only", () => {
    expect(isTrivialPin("000000")).toBe(true);
    expect(isTrivialPin("345678")).toBe(true);
    expect(isTrivialPin("876543")).toBe(true);
    expect(isTrivialPin("135791")).toBe(false);
  });
  it("PIN_LENGTH is the estate fixed length", () => {
    expect(PIN_LENGTH).toBe(6);
  });
});

describe("hash + verify", () => {
  it("roundtrips and rejects a wrong PIN", async () => {
    const hash = await hashPin("935170");
    expect(await verifyPin("935170", hash)).toBe(true);
    expect(await verifyPin("935171", hash)).toBe(false);
  });
  it("returns false (never throws) on a malformed stored hash", async () => {
    expect(await verifyPin("935170", "not-a-bcrypt-hash")).toBe(false);
  });
});

describe("computePinLookup (keyed blind index, M002)", () => {
  it("throws fail-closed when the secret is not configured", () => {
    expect(() => computePinLookup("935170")).toThrowError(/not configured/);
  });
  it("is deterministic under one key and diverges under another", () => {
    configureOrgContract({ stationPinLookupSecret: () => "key-one" });
    const a1 = computePinLookup("935170");
    const a2 = computePinLookup("935170");
    const b = computePinLookup("935171");
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a1);
    configureOrgContract({ stationPinLookupSecret: () => "key-two" });
    expect(computePinLookup("935170")).not.toBe(a1);
  });
});

describe("lockout arithmetic (DECISION-IMPL-005 — pure, clock-injected)", () => {
  it("defaults to the owner-ratified 5 / 5", () => {
    expect(pinLockoutThreshold()).toBe(5);
    expect(pinLockoutWindowMin()).toBe(5);
  });
  it("is tunable via injected config", () => {
    configureOrgContract({ pinLockout: { threshold: 3, windowMinutes: 10 } });
    expect(pinLockoutThreshold()).toBe(3);
    expect(pinLockoutWindowMin()).toBe(10);
  });
  it("counts failures within the window and locks at the threshold", () => {
    let state: PinLockoutState = CLEAN;
    for (let i = 1; i <= 4; i += 1) {
      state = registerFailedAttempt(state, minutes(i));
      expect(state.failedPinAttempts).toBe(i);
      expect(state.pinLockedAt).toBeNull();
    }
    state = registerFailedAttempt(state, minutes(4.5));
    expect(state.failedPinAttempts).toBe(5);
    expect(state.pinLockedAt).toEqual(minutes(4.5));
    expect(isPinLocked(state, minutes(5))).toBe(true);
  });
  it("restarts the count when the prior failure window has passed", () => {
    let state = registerFailedAttempt(CLEAN, T0);
    state = registerFailedAttempt(state, minutes(6)); // > 5min after first failure
    expect(state.failedPinAttempts).toBe(1);
    expect(state.pinFirstFailedAt).toEqual(minutes(6));
  });
  it("auto-expires the lock after the window (no admin unlock)", () => {
    const locked: PinLockoutState = {
      failedPinAttempts: 5,
      pinFirstFailedAt: T0,
      pinLockedAt: T0,
    };
    expect(isPinLocked(locked, minutes(4.99))).toBe(true);
    expect(isPinLocked(locked, minutes(5))).toBe(false);
    // The next failure after expiry starts a FRESH window at count 1 and clears the stale lock.
    const next = registerFailedAttempt(locked, minutes(7));
    expect(next.failedPinAttempts).toBe(1);
    expect(next.pinLockedAt).toBeNull();
  });
});
