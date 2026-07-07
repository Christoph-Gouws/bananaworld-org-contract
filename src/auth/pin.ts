/**
 * Central station-PIN handling — hashing, strength rules, the keyed lookup, and the
 * lockout policy (SEC-CRED-001, SEC-AUTH-003, SEC-PRINCIPLE-004, OD-004). One estate-wide
 * hashed PIN per person, verified server-side, never plaintext. The single implementation
 * from EPIC-008-M005 (org-admin + RMS carried hand-mirrored copies before).
 *
 * SERVER-ONLY (prose marker — the estate convention, so it stays unit-testable).
 * `bcryptjs` is a Node dependency; this module must never reach a client bundle. The raw
 * PIN exists only transiently in the tap-in request; only the bcrypt fingerprint is
 * persisted (`org.credential.pin_hash`, DB-DATA-004). The lockout evaluation here is PURE
 * (values + an injected clock) so it is unit-testable without a database;
 * station-pin.ts performs the DB reads/writes.
 *
 * Lockout policy (owner decision DECISION-IMPL-005): a station locks after THRESHOLD
 * failures within WINDOW, and the lock AUTO-EXPIRES once WINDOW passes — no administrator
 * unlock. Per-STATION, never a per-person estate-wide lock. Tuning comes from the injected
 * package config (`configureOrgContract({ pinLockout })`), defaults 5 / 5.
 */

import { hash as bcryptHash, compare as bcryptCompare } from "bcryptjs";
import { createHmac } from "node:crypto";

import {
  getPinLockoutThreshold,
  getPinLockoutWindowMin,
  getStationPinLookupSecret,
} from "../config";

// SEC-CRED-001 — bcrypt work factor. >= 12 is mandated estate-wide; exactly 12 (the floor)
// balances cost against the per-tap-in verification budget.
export const PIN_BCRYPT_COST = 12;

// The estate PIN format (OD-004): a FIXED length so a station surface can auto-submit the
// instant the final digit lands.
export const PIN_LENGTH = 6;

/** The configured lockout threshold (failures within the window that lock the station). */
export function pinLockoutThreshold(): number {
  return getPinLockoutThreshold();
}

/** The configured lockout window, minutes (also the lock's auto-expiry). */
export function pinLockoutWindowMin(): number {
  return getPinLockoutWindowMin();
}

// ---------------------------------------------------------------------------
// Strength (issuance)
// ---------------------------------------------------------------------------

export type PinStrengthResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

// Validates a PIN for ISSUANCE: digits-only, exactly PIN_LENGTH digits, not a single
// repeated digit, not a strictly ascending/descending run. A reason is returned for the
// admin issuance surface; the tap-in path never echoes a reason (SEC-CRED-001).
export function validatePinStrength(pin: string): PinStrengthResult {
  if (/^\d+$/.test(pin) === false) {
    return { ok: false, reason: "PIN must contain digits only." };
  }
  if (pin.length !== PIN_LENGTH) {
    return { ok: false, reason: `PIN must be exactly ${PIN_LENGTH} digits.` };
  }
  if (isTrivialPin(pin)) {
    return { ok: false, reason: "PIN is too easy to guess (no repeated or sequential digits)." };
  }
  return { ok: true };
}

// Trivial = every digit identical (000000) or a strictly ascending (123456) / descending
// (654321) run of step 1.
export function isTrivialPin(pin: string): boolean {
  if (/^(\d)\1*$/.test(pin)) return true; // all same digit
  const digits = [...pin].map((c) => Number(c));
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1] as number) + 1);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1] as number) - 1);
  return ascending || descending;
}

// ---------------------------------------------------------------------------
// Hashing (SEC-CRED-001)
// ---------------------------------------------------------------------------

// One-way bcrypt fingerprint of a PIN (cost PIN_BCRYPT_COST). Callers validate strength first.
export async function hashPin(pin: string): Promise<string> {
  return bcryptHash(pin, PIN_BCRYPT_COST);
}

// Verifies a candidate PIN against a stored fingerprint. Returns false (never throws) on
// any malformed hash so a bad stored value denies rather than 500s.
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  try {
    return await bcryptCompare(pin, storedHash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Keyed lookup / "blind index" (M002 — F1 PIN uniqueness + F2 O(1) login)
// ---------------------------------------------------------------------------

// The DETERMINISTIC keyed fingerprint of a PIN — the value stored in
// `org.credential.pin_lookup`. Unlike the (salted, per-row-unique) bcrypt hash, this is
// identical for identical PINs, so:
//   • a partial-unique index on it enforces cross-person PIN uniqueness AT ISSUANCE (F1), and
//   • station login SELECTs the single candidate by lookup instead of bcrypt-scanning every
//     active hash (F2, O(1)).
// It is NOT a credential and NOT reversible to the PIN: bcrypt (`pin_hash`) remains the
// at-rest verifier (SEC-CRED-001); this is a lookup key only, keyed by a server-only secret
// so a bare DB dump cannot enumerate the 6-digit space without also holding the key.
// HMAC-SHA256 over the raw PIN under the injected stationPinLookupSecret (shared estate-wide,
// byte-identical in every app that reads org.credential — see config.ts).
export function computePinLookup(pin: string): string {
  return createHmac("sha256", getStationPinLookupSecret()).update(pin, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Lockout policy (SEC-AUTH-003) — PURE, clock-injected
// ---------------------------------------------------------------------------

// The lockout-relevant subset of an org.station row.
export interface PinLockoutState {
  readonly failedPinAttempts: number;
  readonly pinFirstFailedAt: Date | null;
  readonly pinLockedAt: Date | null;
}

// A station is currently locked when it crossed the threshold AND the auto-expiry window
// has not yet elapsed since it locked (DECISION-IMPL-005 — the lock self-clears). Once
// `now >= pinLockedAt + window` the station is open again; the next failed attempt starts
// a fresh window (see registerFailedAttempt).
export function isPinLocked(
  state: PinLockoutState,
  now: Date,
  windowMinutes: number = pinLockoutWindowMin(),
): boolean {
  if (state.pinLockedAt === null) return false;
  const windowMs = windowMinutes * 60 * 1000;
  return now.getTime() - state.pinLockedAt.getTime() < windowMs;
}

// The persisted throttle after ONE failed attempt (the caller has already confirmed the
// station is not currently locked). PURE — the caller writes the returned values. A
// failure outside the current window (or after a prior lock auto-expired) restarts the
// count at 1 and clears any stale lock; the threshold-th failure within the window sets
// pinLockedAt = now (locked until now + window).
export interface NextFailureState {
  readonly failedPinAttempts: number;
  readonly pinFirstFailedAt: Date;
  readonly pinLockedAt: Date | null;
}

export function registerFailedAttempt(
  state: PinLockoutState,
  now: Date,
  threshold: number = pinLockoutThreshold(),
  windowMinutes: number = pinLockoutWindowMin(),
): NextFailureState {
  const windowMs = windowMinutes * 60 * 1000;
  const withinWindow =
    state.pinFirstFailedAt !== null && now.getTime() - state.pinFirstFailedAt.getTime() <= windowMs;

  const failedPinAttempts = withinWindow ? state.failedPinAttempts + 1 : 1;
  const pinFirstFailedAt = withinWindow ? (state.pinFirstFailedAt as Date) : now;
  // A fresh window clears any stale (auto-expired) lock; otherwise lock at the threshold.
  const pinLockedAt = failedPinAttempts >= threshold ? now : null;

  return { failedPinAttempts, pinFirstFailedAt, pinLockedAt };
}
