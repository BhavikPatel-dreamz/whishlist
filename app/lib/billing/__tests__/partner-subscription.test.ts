import { describe, expect, it } from "vitest";
import { planCodeFromHandles, subscriptionRecordFromPartner } from "../partner-subscription";

describe("planCodeFromHandles", () => {
  it("maps scale, growth, and starter handles", () => {
    expect(planCodeFromHandles(["scale-monthly"])).toBe("scale");
    expect(planCodeFromHandles(["Growth Yearly"])).toBe("growth");
    expect(planCodeFromHandles(["starter"])).toBe("starter");
  });

  it("still maps legacy gold, pro, and free handles", () => {
    expect(planCodeFromHandles(["gold-monthly"])).toBe("scale");
    expect(planCodeFromHandles(["Pro Yearly"])).toBe("growth");
    expect(planCodeFromHandles(["free"])).toBe("starter");
  });

  it("prefers scale when both paid handles are present", () => {
    expect(planCodeFromHandles(["growth", "scale"])).toBe("scale");
    expect(planCodeFromHandles(["pro", "gold"])).toBe("scale");
  });

  it("returns null for an unknown handle", () => {
    expect(planCodeFromHandles(["basic"])).toBeNull();
  });
});

describe("subscriptionRecordFromPartner", () => {
  it("keeps a cancelled subscription until the cycle ends", () => {
    const record = subscriptionRecordFromPartner({
      cancelAtEndOfCycle: true,
      currentBillingCycle: { endTime: "2026-11-01T00:00:00.000Z" },
      items: [{ handle: "growth" }],
    });
    expect(record).toEqual({
      planCode: "growth",
      status: "CANCELLED",
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
    });
  });

  it("ignores starter subscriptions", () => {
    expect(subscriptionRecordFromPartner({ items: [{ handle: "starter" }] })).toBeNull();
    expect(subscriptionRecordFromPartner({ items: [{ handle: "free" }] })).toBeNull();
  });
});
