import { describe, expect, it } from "vitest";
import { notificationIdempotencyKey, usagePeriodKey } from "../usage.server";

describe("usagePeriodKey", () => {
  const instant = new Date("2026-10-22T23:30:00.000Z");

  it("uses the UTC month when the plan window is month", () => {
    expect(usagePeriodKey("month", instant)).toBe("2026-10");
  });

  it("uses the UTC day for Starter, Growth, and Scale", () => {
    expect(usagePeriodKey("day", instant)).toBe("2026-10-22");
  });
});

describe("notificationIdempotencyKey", () => {
  it("stays the same for retries of one signup generation", () => {
    expect(notificationIdempotencyKey("alert-1", 1)).toBe("alert-1:1");
    expect(notificationIdempotencyKey("alert-1", 1)).toBe(notificationIdempotencyKey("alert-1", 1));
  });

  it("changes after the shopper subscribes again", () => {
    expect(notificationIdempotencyKey("alert-1", 2)).toBe("alert-1:2");
  });
});
