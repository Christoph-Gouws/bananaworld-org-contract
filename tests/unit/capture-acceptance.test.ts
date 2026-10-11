import { describe, expect, it } from "vitest";

import {
  CAPTURE_GRACE_MAX_MINUTES,
  decideCaptureAcceptance,
  type CaptureTokenRecord,
} from "../../src/capture/signed-capture";

const MIN = 60_000;
const ISSUED = new Date("2026-10-11T06:00:00.000Z");
const EXPIRES = new Date("2026-10-11T08:00:00.000Z");
const RECORD: CaptureTokenRecord = {
  issuedAt: ISSUED,
  expiresAt: EXPIRES,
  revokedAt: null,
  signedOutAtSequence: null,
};

function decide(over: Partial<Parameters<typeof decideCaptureAcceptance>[0]> = {}) {
  return decideCaptureAcceptance({
    tokenRecord: RECORD,
    sequence: 1,
    deviceTime: "2026-10-11T07:00:00.000Z",
    receivedAt: new Date(EXPIRES.getTime() + 30 * MIN),
    graceMinutes: 90,
    ...over,
  });
}

describe("capture acceptance (API-OFF-001)", () => {
  it("accepts 30 minutes after expiry, and at exactly the 90-minute edge", () => {
    expect(decide().ok).toBe(true);
    expect(decide({ receivedAt: new Date(EXPIRES.getTime() + 90 * MIN) }).ok).toBe(true);
  });

  it("refuses 91 minutes after expiry — even with the device clock set back", () => {
    const late = new Date(EXPIRES.getTime() + 91 * MIN);
    expect(decide({ receivedAt: late })).toEqual({ ok: false, code: "capture_expired" });
    expect(decide({ receivedAt: late, deviceTime: "2026-10-11T06:30:00.000Z" })).toEqual({
      ok: false,
      code: "capture_expired",
    });
  });

  it("a centrally revoked token is refused", () => {
    const tokenRecord = { ...RECORD, revokedAt: new Date(EXPIRES.getTime() - MIN) };
    expect(decide({ tokenRecord })).toEqual({ ok: false, code: "capture_token_revoked" });
  });

  it("an action after the offline sign-out sequence is refused; at or before it is accepted", () => {
    const tokenRecord = { ...RECORD, signedOutAtSequence: 5 };
    expect(decide({ tokenRecord, sequence: 6 })).toEqual({
      ok: false,
      code: "capture_token_revoked",
    });
    expect(decide({ tokenRecord, sequence: 5 }).ok).toBe(true);
    expect(decide({ tokenRecord, sequence: 4 }).ok).toBe(true);
  });

  it("dates the action from the device time, clamped to the token's validity", () => {
    const dated = (deviceTime: string) => {
      const r = decide({ deviceTime });
      return r.ok ? r.datingTime.toISOString() : null;
    };
    expect(dated("2026-10-11T07:00:00.000Z")).toBe("2026-10-11T07:00:00.000Z");
    expect(dated("2026-10-11T05:00:00.000Z")).toBe(ISSUED.toISOString());
    expect(dated("2026-10-11T09:00:00.000Z")).toBe(EXPIRES.toISOString());
    expect(dated("garbage")).toBe(ISSUED.toISOString());
  });

  it("grace outside 0..90 (or non-integer) throws — fails closed", () => {
    for (const graceMinutes of [-1, CAPTURE_GRACE_MAX_MINUTES + 1, 1.5, Number.NaN]) {
      expect(() => decide({ graceMinutes })).toThrow();
    }
    expect(decide({ graceMinutes: 0, receivedAt: new Date(EXPIRES.getTime() + MIN) })).toEqual({
      ok: false,
      code: "capture_expired",
    });
  });
});
