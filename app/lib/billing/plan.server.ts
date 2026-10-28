import type { Plan } from "@prisma/client";
import db from "../../db.server";

export const PLAN_CODES = {
  starter: "starter",
  growth: "growth",
  scale: "scale",
} as const;

export type PlanCode = (typeof PLAN_CODES)[keyof typeof PLAN_CODES];

/** SMS and WhatsApp are the Scale plan only. */
export function planAllowsSmsWhatsApp(planCode: string): boolean {
  return planCode === PLAN_CODES.scale;
}

/**
 * How many notification send-log rows a plan may view.
 * `null` = full access (Scale).
 */
export function planNotificationLogLimit(planCode: string): number | null {
  if (planCode === PLAN_CODES.growth) return 50;
  if (planCode === PLAN_CODES.scale) return null;
  return 25;
}

export function nextPlanForLogUpgrade(planCode: string): PlanCode | null {
  if (planCode === PLAN_CODES.starter) return PLAN_CODES.growth;
  if (planCode === PLAN_CODES.growth) return PLAN_CODES.scale;
  return null;
}

/**
 * Whether an email send should reserve plan quota.
 * Klaviyo is event-only. Scale with a merchant/custom provider is unlimited.
 * Starter and Growth always count (app-managed sender only).
 */
export function emailCountsTowardQuota(
  plan: Pick<Plan, "code" | "allowMerchantProvider" | "merchantSendsCountTowardQuota">,
  opts: { provider: string; usesMerchantEmailProvider: boolean },
): boolean {
  if (opts.provider === "klaviyo") return false;
  if (
    plan.code === PLAN_CODES.scale &&
    plan.allowMerchantProvider &&
    opts.usesMerchantEmailProvider
  ) {
    return false;
  }
  return plan.merchantSendsCountTowardQuota;
}

/** Statuses that still grant the paid plan until currentPeriodEnd. */
const IN_FORCE_STATUSES = ["ACTIVE", "CANCELLED"] as const;

export type SubscriptionSnapshot = {
  status: string;
  planCode: string;
  currentPeriodEnd: Date | null;
};

/**
 * A shop is on the paid plan while Shopify still considers the charge in force.
 * CANCELLED keeps the plan until currentPeriodEnd (Shopify recurring default).
 * After that instant, or with no row, the shop is Starter.
 */
export function selectInForcePlanCode(
  subscriptions: SubscriptionSnapshot[],
  now: Date = new Date(),
): PlanCode {
  const inForce = subscriptions.filter((row) => {
    if (!IN_FORCE_STATUSES.includes(row.status as (typeof IN_FORCE_STATUSES)[number])) {
      return false;
    }
    if (row.planCode === PLAN_CODES.starter) return false;
    if (row.currentPeriodEnd && row.currentPeriodEnd.getTime() <= now.getTime()) return false;
    return true;
  });

  inForce.sort((a, b) => {
    const aEnd = a.currentPeriodEnd?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bEnd = b.currentPeriodEnd?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return bEnd - aEnd;
  });

  const code = inForce[0]?.planCode;
  if (code === PLAN_CODES.growth || code === PLAN_CODES.scale) return code;
  return PLAN_CODES.starter;
}

export async function getPlan(code: PlanCode): Promise<Plan> {
  const plan = await db.plan.findUnique({ where: { code } });
  if (!plan) {
    throw new Error(`Plan "${code}" is not seeded. Run prisma migrate deploy.`);
  }
  return plan;
}

/** Active commercial plan for a shop. No in-force subscription means Starter. */
export async function getShopPlan(shopId: string, now: Date = new Date()): Promise<Plan> {
  const rows = await db.billingSubscription.findMany({
    where: { shopId },
    select: { status: true, planCode: true, currentPeriodEnd: true },
  });
  return getPlan(selectInForcePlanCode(rows, now));
}
