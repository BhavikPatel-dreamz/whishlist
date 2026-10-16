import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  signPayload,
  verifyPayloadSignature,
  timingSafeEqual,
} from "../crypto.server";

// Set encryption key for tests
process.env.APP_ENCRYPTION_KEY = "test-key-for-encryption-purposes-only-32b!";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const plain = "sk_live_abc123def456";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(encrypted).toMatch(/^enc\.v1\./);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("returns empty string for empty input", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
    expect(decryptSecret(null)).toBe("");
    expect(decryptSecret(undefined)).toBe("");
  });

  it("passes through values without the enc.v1 prefix", () => {
    expect(decryptSecret("plain-value")).toBe("plain-value");
  });
});

describe("maskSecret", () => {
  it("masks a long secret", () => {
    expect(maskSecret("sk_live_1234567890abcdef")).toMatch(/^sk_l••••••cdef$/);
  });

  it("returns dots for short secrets", () => {
    expect(maskSecret("abc")).toBe("••••••••");
  });

  it("returns empty for empty", () => {
    expect(maskSecret("")).toBe("");
  });
});

describe("signPayload / verifyPayloadSignature", () => {
  it("creates a valid signature", () => {
    const payload = "alert-id-123";
    const sig = signPayload(payload);
    expect(sig).toBeTruthy();
    expect(verifyPayloadSignature(payload, sig)).toBe(true);
  });

  it("rejects tampered signatures", () => {
    expect(verifyPayloadSignature("alert-123", "bad-sig")).toBe(false);
  });

  it("rejects wrong payload with correct sig", () => {
    const sig = signPayload("alert-123");
    expect(verifyPayloadSignature("alert-456", sig)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(timingSafeEqual("abc", "def")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
