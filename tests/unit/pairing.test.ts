import { describe, expect, it } from "vitest";

import { generatePairingCode, hashPairingCode, PAIRING_CODE_LENGTH } from "../../src/index";

describe("station device-pairing codes", () => {
  it("generates an 8-char unambiguous code + its stored SHA-256", () => {
    const { code, codeHash } = generatePairingCode();
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/); // no 0/O/1/I/L
    expect(codeHash).toBe(hashPairingCode(code));
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashing case-folds + trims so the device-side entry matches", () => {
    expect(hashPairingCode("  abcd2345 ")).toBe(hashPairingCode("ABCD2345"));
  });
});
