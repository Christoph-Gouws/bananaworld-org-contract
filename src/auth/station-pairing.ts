/**
 * Station device-pairing codes — generation + hashing (EPIC-004-M4.2, DB-DATA-008,
 * DB-FIELD-038, DB-VAL-005).
 *
 * SERVER-ONLY (`node:crypto`) — used only from server actions / repos, never a client
 * bundle (the estate convention: a prose marker, not an `import "server-only"`, so it
 * stays unit-testable). A pairing code is a single-use secret an administrator reads ONCE
 * off the console and types into a device to bind it to a station. Only the code's SHA-256
 * fingerprint is ever persisted (`org.station_device.pairing_code_hash`); the raw code is
 * never stored and never re-displayed after it is generated. Redeeming the code
 * (pending → paired) is the DEVICE side; this module supplies the code + the hash the
 * console stores and the device later matches against.
 */

import { createHash, randomInt } from "node:crypto";

// An unambiguous alphabet (no 0/O/1/I/L) so a human can read the code off the screen and
// key it into a device without confusion. 8 chars over 30 symbols ≈ 40 bits of entropy —
// ample for a single-use, short-lived, server-rate-limited pairing code.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 8;

/** A freshly generated pairing code: the raw code (shown once) + the hash to persist. */
export interface GeneratedPairingCode {
  /** The human-readable code — returned to the admin ONCE, never stored. */
  readonly code: string;
  /** The SHA-256 fingerprint stored in org.station_device.pairing_code_hash. */
  readonly codeHash: string;
}

/** Generate a single-use pairing code + its stored hash. Uses a CSPRNG (crypto.randomInt). */
export function generatePairingCode(): GeneratedPairingCode {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return { code, codeHash: hashPairingCode(code) };
}

/** The SHA-256 fingerprint of a pairing code (case-folded to match generation). The device
 *  side hashes the entered code the same way to find its pending pairing row. */
export function hashPairingCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
