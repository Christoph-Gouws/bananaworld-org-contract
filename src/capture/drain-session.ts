/**
 * The capture verification chain + the confined drain session (CR-ORG-CONTRACT-002;
 * TA-OFF-008, STI-DEV-005, API-OFF-001, DLC-DEC-083).
 *
 * SERVER-ONLY. A drained offline action is replayed under a short HS256 credential that names
 * ONE person (taken only from the verified floor token — never from the action body), one
 * device, one device session and one capture. It grants no elevated write: the host runs the
 * action under that person's own row-level security. The `bw_session: "drain"` marker and a
 * distinct audience keep it from ever passing as a station token, and the host refuses it on
 * every endpoint except the drain endpoint (`drain_session_confined`).
 */

import { SignJWT, compactVerify, jwtVerify } from "jose";

import { getCaptureTokenKey, getDrainSessionSecret } from "../config";
import {
  captureMessage,
  verifyCaptureDeviceSignature,
  type AcceptedCapture,
  type CaptureEnvelope,
  type CaptureRefusalCode,
} from "./signed-capture";

export const DRAIN_SESSION_MARKER = "drain" as const;
export const DRAIN_SESSION_CONFINED = "drain_session_confined" as const;
export const DRAIN_SESSION_MAX_SECONDS = 300;
const DRAIN_AUDIENCE = "bw-drain";

function keyBytes(key: string | Uint8Array): Uint8Array {
  return typeof key === "string" ? new TextEncoder().encode(key) : key;
}

/** The device facts, read by the caller from its own device record. `registered` means the
 *  device is active and its key is not revoked (STI-DEV-006). */
export interface CaptureDevice {
  readonly id: string;
  readonly publicKeySpki: string | null;
  readonly registered: boolean;
}

export interface VerifiedCapture {
  /** From the floor token only. */
  readonly personId: string;
  readonly deviceId: string;
  readonly deviceSessionId: string;
  readonly tokenIssuedAt: Date;
  readonly tokenExpiresAt: Date;
  readonly kind: CaptureEnvelope["kind"];
  readonly sequence: number;
  readonly idempotencyKey: string;
  readonly deviceTime: string;
}

export type VerifyCaptureResult =
  | { readonly ok: true; readonly capture: VerifiedCapture }
  | { readonly ok: false; readonly code: CaptureRefusalCode };

const refuse = (code: CaptureRefusalCode): VerifyCaptureResult => ({ ok: false, code });

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Verifies the floor-token signature (expiry deliberately NOT enforced — the grace window in
 *  `decideCaptureAcceptance` replaces it, measured from the server record), then the device
 *  signature, in the order TA-OFF-008 gives. */
export async function verifySignedCapture(
  signed: { readonly envelope: CaptureEnvelope; readonly signature: string },
  device: CaptureDevice,
): Promise<VerifyCaptureResult> {
  if (!device.registered || !device.publicKeySpki) return refuse("device_not_registered");
  const { envelope } = signed;

  const tokenKey = keyBytes(getCaptureTokenKey()); // a config error propagates (fail closed)
  let claims: Record<string, unknown>;
  try {
    const { payload } = await compactVerify(envelope.jwt, tokenKey, {
      algorithms: ["HS256"],
    });
    claims = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
  } catch {
    return refuse("capture_signature_invalid");
  }

  const personId = str(claims.sub);
  const deviceId = str(claims.device_id);
  const deviceSessionId = str(claims.device_session_id);
  const { iat, exp } = claims;
  if (
    personId === null ||
    deviceId === null ||
    deviceSessionId === null ||
    typeof iat !== "number" ||
    typeof exp !== "number"
  ) {
    return refuse("capture_signature_invalid");
  }
  // A token copied to a second device.
  if (deviceId !== device.id) return refuse("capture_signature_invalid");

  try {
    captureMessage(envelope); // a malformed envelope has no signable form
  } catch {
    return refuse("capture_signature_invalid");
  }
  if (!(await verifyCaptureDeviceSignature(device.publicKeySpki, envelope, signed.signature))) {
    return refuse("capture_signature_invalid");
  }

  return {
    ok: true,
    capture: {
      personId,
      deviceId,
      deviceSessionId,
      tokenIssuedAt: new Date(iat * 1000),
      tokenExpiresAt: new Date(exp * 1000),
      kind: envelope.kind,
      sequence: envelope.sequence,
      idempotencyKey: envelope.idempotencyKey,
      deviceTime: envelope.deviceTime,
    },
  };
}

export interface MintDrainSessionInput {
  readonly capture: VerifiedCapture;
  /** The accepted result of `decideCaptureAcceptance`. */
  readonly acceptance: AcceptedCapture;
  /** The caller states its drain-time re-checks passed: role + assignment, and the device. */
  readonly personStillPermitted: true;
  readonly deviceStillRegistered: true;
  readonly ttlSeconds?: number;
  /** Injectable for deterministic tests (as `mintStationToken`); defaults to now. */
  readonly issuedAt?: Date;
}

export interface DrainSessionClaims {
  readonly personId: string;
  readonly deviceId: string;
  readonly deviceSessionId: string;
  readonly captureId: string;
}

export async function mintDrainSession(
  input: MintDrainSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const ttl = input.ttlSeconds ?? DRAIN_SESSION_MAX_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > DRAIN_SESSION_MAX_SECONDS) {
    throw new Error(
      `mintDrainSession: ttlSeconds must be an integer 1..${DRAIN_SESSION_MAX_SECONDS}`,
    );
  }
  const { capture } = input;
  const iat = Math.floor((input.issuedAt ?? new Date()).getTime() / 1000);
  const exp = iat + ttl;
  const token = await new SignJWT({
    role: "authenticated",
    person_id: capture.personId,
    device_id: capture.deviceId,
    device_session_id: capture.deviceSessionId,
    capture_id: capture.idempotencyKey,
    bw_session: DRAIN_SESSION_MARKER,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(capture.personId)
    .setAudience(DRAIN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(keyBytes(getDrainSessionSecret()));
  return { token, expiresAt: new Date(exp * 1000) };
}

/** The drain claims, or null for ANY failure (never throws on a malformed token). */
export async function verifyDrainSession(token: string): Promise<DrainSessionClaims | null> {
  const key = keyBytes(getDrainSessionSecret()); // a config error propagates (fail closed)
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      audience: DRAIN_AUDIENCE,
    });
    if (payload.bw_session !== DRAIN_SESSION_MARKER) return null;
    const personId = str(payload.sub);
    const deviceId = str(payload.device_id);
    const deviceSessionId = str(payload.device_session_id);
    const captureId = str(payload.capture_id);
    if (personId === null || deviceId === null || deviceSessionId === null || captureId === null) {
      return null;
    }
    return { personId, deviceId, deviceSessionId, captureId };
  } catch {
    return null;
  }
}

/** Lets every other endpoint recognise a drain session and refuse it as `drain_session_confined`. */
export async function isDrainSession(token: string): Promise<boolean> {
  return (await verifyDrainSession(token)) !== null;
}

/** The claims a host sets as its database session claims; `bw_session: "drain"` lets the host's
 *  database functions refuse it. `person_id` is the claim DC and Org Admin functions read. */
export function drainSessionDbClaims(claims: DrainSessionClaims): Record<string, string> {
  return {
    sub: claims.personId,
    role: "authenticated",
    person_id: claims.personId,
    device_id: claims.deviceId,
    device_session_id: claims.deviceSessionId,
    capture_id: claims.captureId,
    bw_session: DRAIN_SESSION_MARKER,
  };
}
