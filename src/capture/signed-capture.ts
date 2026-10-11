/**
 * Device-key signed offline capture — the shared format and the acceptance rule
 * (CR-ORG-CONTRACT-002; packhouse TA-OFF-005/008, STI-DEV-005, API-OFF-001).
 *
 * ISOMORPHIC (browser + server): WebCrypto only. It imports no jose, no config, no pg and no
 * `node:crypto`, so a browser bundle can take it through the `./signed-capture` subpath.
 *
 * The key format matches the packhouse's registered floor device byte for byte: ECDSA P-256 with
 * SHA-256, public key as SPKI DER in base64, signatures in IEEE-P1363 encoding (which is what
 * WebCrypto produces natively). A format change later is a new `bw-capture-v2` prefix, never an
 * edit to v1.
 */

// Type-only (erased at build): the package compiles without the DOM lib.
import type { webcrypto } from "node:crypto";

type CryptoKey = webcrypto.CryptoKey;

/** Domain-separation prefix. It holds a newline, which a device challenge never does, so a
 *  challenge signature can never verify as a capture, nor the reverse. */
export const CAPTURE_MESSAGE_PREFIX = "bw-capture-v1\n";

/** The longest grace window the server may grant after the token's recorded expiry. */
export const CAPTURE_GRACE_MAX_MINUTES = 90;

export const CAPTURE_REFUSAL_CODES = [
  "capture_expired",
  "capture_token_revoked",
  "capture_signature_invalid",
  "device_not_registered",
] as const;
export type CaptureRefusalCode = (typeof CAPTURE_REFUSAL_CODES)[number];

export type CanonicalJson =
  null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/** One queued action (or the offline sign-out event) as the device signs it (TA-OFF-008). */
export interface CaptureEnvelope {
  readonly kind: "action" | "sign_out";
  /** The queued action body; null for `sign_out`. Never read for identity. */
  readonly action: CanonicalJson | null;
  readonly idempotencyKey: string;
  /** Position in the device queue — a positive safe integer. */
  readonly sequence: number;
  /** The station-bound floor token the action was captured under. */
  readonly jwt: string;
  /** The device's ISO-8601 clock reading, kept as a string so the signed bytes stay stable. */
  readonly deviceTime: string;
}

/** The server's OWN record of the floor token — never the JWT's or the device's figures. */
export interface CaptureTokenRecord {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  /** The sequence of the offline sign-out event, once the server has seen one. */
  readonly signedOutAtSequence: number | null;
}

export interface AcceptedCapture {
  readonly ok: true;
  /** The device time clamped to the token's validity (TA-OFF-005). */
  readonly datingTime: Date;
}

export type CaptureAcceptance =
  AcceptedCapture | { readonly ok: false; readonly code: CaptureRefusalCode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Sorted-key, whitespace-free JSON. Throws on anything that has no single stable form. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported value (${typeof value})`);
}

/** The exact bytes a device signs and the server verifies. Throws on a malformed envelope. */
export function captureMessage(envelope: CaptureEnvelope): Uint8Array {
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1) {
    throw new Error("captureMessage: sequence must be a positive safe integer");
  }
  return new TextEncoder().encode(CAPTURE_MESSAGE_PREFIX + canonicalJson(envelope));
}

const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Device side: signs the envelope with the device's (non-extractable) private key. */
export async function signCapture(
  privateKey: CryptoKey,
  envelope: CaptureEnvelope,
): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    ECDSA_SHA256,
    privateKey,
    captureMessage(envelope),
  );
  return toBase64(new Uint8Array(signature));
}

/** Server side: true only for a genuine signature by the device's key. Never throws on a
 *  malformed key, signature or envelope. */
export async function verifyCaptureDeviceSignature(
  publicKeySpkiBase64: string,
  envelope: CaptureEnvelope,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      fromBase64(publicKeySpkiBase64),
      ECDSA_P256,
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      ECDSA_SHA256,
      key,
      fromBase64(signatureBase64),
      captureMessage(envelope),
    );
  } catch {
    return false;
  }
}

export interface DecideCaptureAcceptanceInput {
  readonly tokenRecord: CaptureTokenRecord;
  readonly sequence: number;
  readonly deviceTime: string;
  /** The SERVER clock. The device's time is never used for acceptance. */
  readonly receivedAt: Date;
  readonly graceMinutes: number;
}

/** The pure acceptance rule (API-OFF-001). `graceMinutes` outside 0..90 throws — a
 *  misconfiguration fails closed. */
export function decideCaptureAcceptance(input: DecideCaptureAcceptanceInput): CaptureAcceptance {
  const { tokenRecord: record, graceMinutes } = input;
  if (
    !Number.isInteger(graceMinutes) ||
    graceMinutes < 0 ||
    graceMinutes > CAPTURE_GRACE_MAX_MINUTES
  ) {
    throw new Error(
      `decideCaptureAcceptance: graceMinutes must be an integer 0..${CAPTURE_GRACE_MAX_MINUTES}`,
    );
  }
  if (record.revokedAt !== null) return { ok: false, code: "capture_token_revoked" };
  if (record.signedOutAtSequence !== null && input.sequence > record.signedOutAtSequence) {
    return { ok: false, code: "capture_token_revoked" };
  }
  const lastAcceptable = record.expiresAt.getTime() + graceMinutes * 60_000;
  if (input.receivedAt.getTime() > lastAcceptable) return { ok: false, code: "capture_expired" };

  const issued = record.issuedAt.getTime();
  const device = Date.parse(input.deviceTime);
  const dated = Number.isNaN(device)
    ? issued
    : Math.min(Math.max(device, issued), record.expiresAt.getTime());
  return { ok: true, datingTime: new Date(dated) };
}
