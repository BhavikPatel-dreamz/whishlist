import { describe, it, expect } from "vitest";
import { requireIdentity, getWishlistOrderSummary } from "../wishlist.server";
import { ProxyError } from "../../lib/proxy.server";

describe("requireIdentity", () => {
  it("returns valid identity with customerId", () => {
    const result = requireIdentity({ customerId: "123", guestToken: null });
    expect(result).toEqual({ customerId: "123", guestToken: null });
  });

  it("returns valid identity with guestToken", () => {
    const token = "a".repeat(32);
    const result = requireIdentity({ customerId: null, guestToken: token });
    expect(result).toEqual({ customerId: null, guestToken: token });
  });

  it("throws when both are null", () => {
    expect(() =>
      requireIdentity({ customerId: null, guestToken: null }),
    ).toThrow(ProxyError);
  });

  it("throws for short guest token", () => {
    expect(() =>
      requireIdentity({ customerId: null, guestToken: "short" }),
    ).toThrow(ProxyError);
  });

  it("throws for long guest token", () => {
    const long = "a".repeat(65);
    expect(() =>
      requireIdentity({ customerId: null, guestToken: long }),
    ).toThrow(ProxyError);
  });

  it("trims whitespace from inputs", () => {
    const result = requireIdentity({ customerId: "  123  ", guestToken: null });
    expect(result).toEqual({ customerId: "123", guestToken: null });
  });

  it("treats whitespace-only as null", () => {
    expect(() =>
      requireIdentity({ customerId: "   ", guestToken: null }),
    ).toThrow(ProxyError);
  });

  it("calculates wishlist order totals and averages from real counts", () => {
    const summary = getWishlistOrderSummary(12, 3);

    expect(summary).toEqual({
      totalOrders: 3,
      averageOrdersPerSave: 0.25,
    });
  });

  it("returns zero average when there are no wishlist saves", () => {
    const summary = getWishlistOrderSummary(0, 0);

    expect(summary).toEqual({
      totalOrders: 0,
      averageOrdersPerSave: 0,
    });
  });
});
