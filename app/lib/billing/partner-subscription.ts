import { PLAN_CODES, type PlanCode } from "./plan.server";

export type PartnerSubscription = {
  billingPeriod?: string | null;
  cancelAtEndOfCycle?: boolean | null;
  currentBillingCycle?: { endTime?: string | null } | null;
  items?: Array<{ handle?: string | null }> | null;
};

/**
 * Maps a Shopify App Pricing plan handle onto starter, growth, or scale.
 * Legacy free/pro/gold handles still resolve during Partner Dashboard renames.
 */
export function planCodeFromHandles(handles: Array<string | null | undefined>): PlanCode | null {
  const normalized = handles
    .map((handle) => (handle || "").trim().toLowerCase())
    .filter(Boolean);

  if (
    normalized.some(
      (handle) =>
        /(^|[^a-z])scale([^a-z]|$)/.test(handle) ||
        /(^|[^a-z])gold([^a-z]|$)/.test(handle),
    )
  ) {
    return PLAN_CODES.scale;
  }
  if (
    normalized.some(
      (handle) =>
        /(^|[^a-z])growth([^a-z]|$)/.test(handle) ||
        /(^|[^a-z])pro([^a-z]|$)/.test(handle),
    )
  ) {
    return PLAN_CODES.growth;
  }
  if (
    normalized.some(
      (handle) =>
        /(^|[^a-z])starter([^a-z]|$)/.test(handle) ||
        /(^|[^a-z])free([^a-z]|$)/.test(handle),
    )
  ) {
    return PLAN_CODES.starter;
  }
  return null;
}

export function subscriptionRecordFromPartner(subscription: PartnerSubscription): {
  planCode: PlanCode;
  status: "ACTIVE" | "CANCELLED";
  currentPeriodEnd: Date | null;
} | null {
  const planCode = planCodeFromHandles((subscription.items || []).map((item) => item.handle));
  if (!planCode || planCode === PLAN_CODES.starter) return null;

  const endRaw = subscription.currentBillingCycle?.endTime;
  const currentPeriodEnd = endRaw ? new Date(endRaw) : null;
  const periodEnd = currentPeriodEnd && !Number.isNaN(currentPeriodEnd.getTime()) ? currentPeriodEnd : null;

  return {
    planCode,
    status: subscription.cancelAtEndOfCycle ? "CANCELLED" : "ACTIVE",
    currentPeriodEnd: periodEnd,
  };
}
