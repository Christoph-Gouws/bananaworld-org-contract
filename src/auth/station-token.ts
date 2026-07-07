/**
 * The station-bound session token — minting + verification (SEC-AUTH-003, API-AUTH-001 /
 * API-AUTH-IDENT-002).
 *
 * SERVER-ONLY. A station tap-in authenticates by PIN, not by a browser Supabase session,
 * so after the central resolver verifies the PIN it MINTS this short-lived JWT — signed
 * HS256 with the injected station-token secret (the shared estate `SUPABASE_JWT_SECRET`,
 * the same trust material as DC), carrying the central { person, station } binding. The
 * `station_id` is sealed by the SERVER, which is exactly what makes it un-forgeable by the
 * device (SEC-AUTH-003). Expiry IS the auto-logoff (the station's `auto_logoff_minutes`):
 * once the token lapses the server rejects it and re-entry is by PIN. A
 * `bw_session: "station"` marker means the token is only ever accepted on a station path
 * and is never confused with a browser session.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import { getStationTokenSecret } from "../config";

export const STATION_SESSION_MARKER = "station" as const;

function secretKey(): Uint8Array {
  // getStationTokenSecret() throws if unconfigured — a station tap-in fails closed rather
  // than minting against an empty secret.
  return new TextEncoder().encode(getStationTokenSecret());
}

export interface MintStationTokenInput {
  /** The central person resolved by the PIN (org.person.id) — the token subject. */
  readonly personId: string;
  /** The station tapped in at (org.station.id) — sealed server-side (SEC-AUTH-003). */
  readonly stationId: string;
  /** The opened org.station_session.id, carried for the session record. */
  readonly stationSessionId: string;
  /** Auto-logoff window in minutes (org.station.auto_logoff_minutes) → the token expiry. */
  readonly autoLogoffMinutes: number;
  // Injectable for deterministic tests; defaults to now.
  readonly issuedAt?: Date;
}

export interface MintedStationToken {
  readonly token: string;
  // Absolute expiry in both forms — unix seconds for an API response, a Date for callers.
  readonly expiresAtSeconds: number;
  readonly expiresAt: Date;
}

// Mints a station-bound session token. The caller has already verified the PIN against
// the one active credential, opened the session, and confirmed the lockout is clear.
export async function mintStationToken(input: MintStationTokenInput): Promise<MintedStationToken> {
  const issued = input.issuedAt ?? new Date();
  const iatSeconds = Math.floor(issued.getTime() / 1000);
  const expSeconds = iatSeconds + input.autoLogoffMinutes * 60;

  const token = await new SignJWT({
    role: "authenticated",
    bw_session: STATION_SESSION_MARKER,
    station_id: input.stationId,
    station_session_id: input.stationSessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.personId)
    .setIssuedAt(iatSeconds)
    .setExpirationTime(expSeconds)
    .sign(secretKey());

  return { token, expiresAtSeconds: expSeconds, expiresAt: new Date(expSeconds * 1000) };
}

export interface StationTokenClaims {
  readonly personId: string;
  readonly stationId: string;
  readonly stationSessionId: string;
}

// Verifies a station-session token: a genuine HS256 signature with our secret, not
// expired, carrying the station marker + the required claims. Returns the claims on
// success, or null for ANY failure (bad signature, expired, wrong marker, missing claim) —
// the caller maps null to a 401. Never throws on a malformed token (only the secret-missing
// config error propagates).
export async function verifyStationToken(token: string): Promise<StationTokenClaims | null> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] }));
  } catch {
    return null; // bad signature, expired, malformed
  }

  if (payload.bw_session !== STATION_SESSION_MARKER) return null;

  const personId = typeof payload.sub === "string" ? payload.sub : null;
  const stationId = typeof payload.station_id === "string" ? payload.station_id : null;
  const stationSessionId =
    typeof payload.station_session_id === "string" ? payload.station_session_id : null;

  if (personId === null || stationId === null || stationSessionId === null) return null;
  return { personId, stationId, stationSessionId };
}
