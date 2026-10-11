import { createPublicKey, verify as nodeVerify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CAPTURE_MESSAGE_PREFIX,
  canonicalJson,
  captureMessage,
  signCapture,
  verifyCaptureDeviceSignature,
  type CaptureEnvelope,
} from "../../src/capture/signed-capture";

const ENVELOPE: CaptureEnvelope = {
  kind: "action",
  action: { b: 2, a: [1, { z: null, y: "x" }] },
  idempotencyKey: "key-1",
  sequence: 3,
  jwt: "a.b.c",
  deviceTime: "2026-10-11T08:00:00.000Z",
};

async function makeDevice() {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", pair.publicKey));
  return { privateKey: pair.privateKey, spkiBase64: Buffer.from(spki).toString("base64") };
}

describe("canonical message (bw-capture-v1)", () => {
  it("matches the golden bytes", () => {
    const text = new TextDecoder().decode(captureMessage(ENVELOPE));
    expect(text).toBe(
      'bw-capture-v1\n{"action":{"a":[1,{"y":"x","z":null}],"b":2},"deviceTime":"2026-10-11T08:00:00.000Z","idempotencyKey":"key-1","jwt":"a.b.c","kind":"action","sequence":3}',
    );
    expect(text.startsWith(CAPTURE_MESSAGE_PREFIX)).toBe(true);
  });

  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("throws on values with no stable form", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson(new Map())).toThrow();
  });

  it("rejects a sequence that is not a positive safe integer", () => {
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => captureMessage({ ...ENVELOPE, sequence })).toThrow();
    }
  });
});

describe("device signature", () => {
  it("signs and verifies; every tampered field fails", async () => {
    const device = await makeDevice();
    const signature = await signCapture(device.privateKey, ENVELOPE);
    expect(await verifyCaptureDeviceSignature(device.spkiBase64, ENVELOPE, signature)).toBe(true);

    const tampered: CaptureEnvelope[] = [
      { ...ENVELOPE, kind: "sign_out" },
      { ...ENVELOPE, action: { a: 1 } },
      { ...ENVELOPE, idempotencyKey: "key-2" },
      { ...ENVELOPE, sequence: 4 },
      { ...ENVELOPE, jwt: "a.b.d" },
      { ...ENVELOPE, deviceTime: "2026-10-11T08:00:01.000Z" },
    ];
    for (const envelope of tampered) {
      expect(await verifyCaptureDeviceSignature(device.spkiBase64, envelope, signature)).toBe(
        false,
      );
    }
  });

  it("a WebCrypto signature verifies through node:crypto IEEE-P1363 (the packhouse's verifier)", async () => {
    const device = await makeDevice();
    const signature = await signCapture(device.privateKey, ENVELOPE);
    const key = createPublicKey({
      key: Buffer.from(device.spkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = nodeVerify(
      "sha256",
      captureMessage(ENVELOPE),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64"),
    );
    expect(ok).toBe(true);
  });

  it("a signature by another device's key fails", async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    const signature = await signCapture(a.privateKey, ENVELOPE);
    expect(await verifyCaptureDeviceSignature(b.spkiBase64, ENVELOPE, signature)).toBe(false);
  });

  it("returns false (never throws) on a malformed key or signature", async () => {
    const device = await makeDevice();
    expect(await verifyCaptureDeviceSignature("not-base64!!", ENVELOPE, "AAAA")).toBe(false);
    expect(await verifyCaptureDeviceSignature(device.spkiBase64, ENVELOPE, "%%%")).toBe(false);
  });

  it("a device challenge signature is never accepted as a capture", async () => {
    const device = await makeDevice();
    const challenge = new TextEncoder().encode("some-online-challenge");
    const sig = new Uint8Array(
      await globalThis.crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        device.privateKey,
        challenge,
      ),
    );
    expect(
      await verifyCaptureDeviceSignature(
        device.spkiBase64,
        ENVELOPE,
        Buffer.from(sig).toString("base64"),
      ),
    ).toBe(false);
  });
});
