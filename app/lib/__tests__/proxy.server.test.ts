import { describe, it, expect } from "vitest";
import {
  numericId,
  assertEmail,
  ProxyError,
  verifyAppProxySignature,
} from "../proxy.server";

describe("numericId", () => {
  it("extracts numeric id from a plain number string", () => {
    expect(numericId("12345")).toBe("12345");
  });

  it("extracts numeric id from a GID string", () => {
    expect(numericId("gid://shopify/Product/12345")).toBe("12345");
  });

  it("returns null for null/undefined", () => {
    expect(numericId(null)).toBeNull();
    expect(numericId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(numericId("")).toBeNull();
    expect(numericId("  ")).toBeNull();
  });

  it("returns null for non-numeric strings", () => {
    expect(numericId("abc")).toBeNull();
  });

  it("handles trailing numbers", () => {
    expect(numericId("prefix-42")).toBe("42");
  });
});

describe("assertEmail", () => {
  it("returns normalised email", () => {
    expect(assertEmail("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("throws ProxyError for invalid email", () => {
    expect(() => assertEmail("not-an-email")).toThrow(ProxyError);
    expect(() => assertEmail("")).toThrow(ProxyError);
    expect(() => assertEmail(undefined)).toThrow(ProxyError);
  });

  it("throws for emails over 254 chars", () => {
    const long = "a".repeat(250) + "@b.com";
    expect(() => assertEmail(long)).toThrow(ProxyError);
  });
});

describe("ProxyError", () => {
  it("has status, message, and code", () => {
    const err = new ProxyError(404, "Not found", "not_found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err.code).toBe("not_found");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults code to 'error'", () => {
    const err = new ProxyError(500, "oops");
    expect(err.code).toBe("error");
  });
});

describe("verifyAppProxySignature", () => {
  it("returns false when signature is missing", () => {
    const url = new URL("https://example.com/api?foo=bar");
    expect(verifyAppProxySignature(url, "secret")).toBe(false);
  });

  it("returns false when secret is empty", () => {
    const url = new URL("https://example.com/api?foo=bar&signature=abc");
    expect(verifyAppProxySignature(url, "")).toBe(false);
  });

  it("returns false for invalid signature", () => {
    const url = new URL("https://example.com/api?foo=bar&signature=invalid");
    expect(verifyAppProxySignature(url, "secret")).toBe(false);
  });
});
