import { describe, expect, it } from "vitest";
import {
  emailCountsTowardQuota,
  PLAN_CODES,
  selectInForcePlanCode,
} from "../plan.server";

const now = new Date("2026-10-22T12:00:00.000Z");
const future = new Date("2026-11-22T12:00:00.000Z");
const past = new Date("2026-09-22T12:00:00.000Z");

const starterPlan = {
  code: PLAN_CODES.starter,
  allowMerchantProvider: false,
  merchantSendsCountTowardQuota: true,
};
const growthPlan = {
  code: PLAN_CODES.growth,
  allowMerchantProvider: false,
  merchantSendsCountTowardQuota: true,
};
const scalePlan = {
  code: PLAN_CODES.scale,
  allowMerchantProvider: true,
  merchantSendsCountTowardQuota: true,
};

describe("emailCountsTowardQuota", () => {
  it("counts Starter and Growth managed sends", () => {
    expect(
      emailCountsTowardQuota(starterPlan, {
        provider: "brevo",
        usesMerchantEmailProvider: false,
      }),
    ).toBe(true);
    expect(
      emailCountsTowardQuota(growthPlan, {
        provider: "brevo",
        usesMerchantEmailProvider: false,
      }),
    ).toBe(true);
  });

  it("counts Scale managed sends against the daily allowance", () => {
    expect(
      emailCountsTowardQuota(scalePlan, {
        provider: "brevo",
        usesMerchantEmailProvider: false,
      }),
    ).toBe(true);
  });

  it("skips quota for Scale with a merchant provider", () => {
    expect(
      emailCountsTowardQuota(scalePlan, {
        provider: "resend",
        usesMerchantEmailProvider: true,
      }),
    ).toBe(false);
  });

  it("never counts Klaviyo", () => {
    expect(
      emailCountsTowardQuota(scalePlan, {
        provider: "klaviyo",
        usesMerchantEmailProvider: true,
      }),
    ).toBe(false);
  });
});

describe("selectInForcePlanCode", () => {
  it("returns starter when the shop has no subscription", () => {
    expect(selectInForcePlanCode([], now)).toBe(PLAN_CODES.starter);
  });

  it("returns the active paid plan", () => {
    expect(
      selectInForcePlanCode(
        [{ status: "ACTIVE", planCode: "growth", currentPeriodEnd: future }],
        now,
      ),
    ).toBe(PLAN_CODES.growth);
  });

  it("keeps a cancelled plan until the period ends", () => {
    expect(
      selectInForcePlanCode(
        [{ status: "CANCELLED", planCode: "scale", currentPeriodEnd: future }],
        now,
      ),
    ).toBe(PLAN_CODES.scale);
  });

  it("drops to starter after the cancelled period ends", () => {
    expect(
      selectInForcePlanCode(
        [{ status: "CANCELLED", planCode: "scale", currentPeriodEnd: past }],
        now,
      ),
    ).toBe(PLAN_CODES.starter);
  });

  it("ignores pending and expired rows", () => {
    expect(
      selectInForcePlanCode(
        [
          { status: "PENDING", planCode: "scale", currentPeriodEnd: future },
          { status: "EXPIRED", planCode: "growth", currentPeriodEnd: future },
        ],
        now,
      ),
    ).toBe(PLAN_CODES.starter);
  });
});
