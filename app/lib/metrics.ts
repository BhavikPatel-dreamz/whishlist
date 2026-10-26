/**
 * Metric helpers for the analytics reports (ANALYTICS_REPORTS_SPEC.md section 7).
 *
 * Every rate in the app must be computed through `safeRate` / `rates` so an empty
 * denominator produces `0` instead of `NaN` or `Infinity`. Never divide inline in a
 * report — the helpers below are the only place division happens.
 */

/** A ratio between two counts. Returns 0 when there is nothing to divide by. */
export const safeRate = (n: number, d: number) => (d > 0 ? n / d : 0);

/**
 * The canonical rate calculations. Each one takes plain counts so a report never
 * has to remember the order of the arguments.
 */
export const rates = {
  /** Wishlist save rate: saves ÷ product views. */
  saveRate: (saves: number, views: number) => safeRate(saves, views),
  /** Save-to-cart rate: wishlisted items added to cart ÷ saves. */
  saveToCartRate: (carted: number, saves: number) => safeRate(carted, saves),
  /** Wishlist conversion rate: purchases of saved items ÷ saves. */
  wishlistConversion: (purchased: number, saves: number) =>
    safeRate(purchased, saves),
  /** Share of savers who went on to buy. */
  wishlistShopperRate: (buyers: number, savers: number) =>
    safeRate(buyers, savers),
  /** Notification rate: notified ÷ subscribed. */
  notificationRate: (notified: number, subs: number) =>
    safeRate(notified, subs),
  /** Open rate: opened ÷ delivered. */
  openRate: (opened: number, delivered: number) =>
    safeRate(opened, delivered),
  /** Click-through rate: clicked ÷ delivered. */
  clickRate: (clicked: number, delivered: number) =>
    safeRate(clicked, delivered),
  /** Click-to-purchase rate: purchased ÷ clicked. */
  clickToPurchase: (purchased: number, clicked: number) =>
    safeRate(purchased, clicked),
  /** Restock conversion rate: purchased ÷ subscribed. */
  restockConversion: (purchased: number, subs: number) =>
    safeRate(purchased, subs),
  /** Revenue per notification: attributed revenue ÷ sent. */
  revenuePerNotif: (revenue: number, sent: number) => safeRate(revenue, sent),
  /** Drop-off between two funnel stages: 1 − (stage ÷ previous stage). */
  dropOffRate: (curr: number, prev: number) => (prev > 0 ? 1 - curr / prev : 0),
  /** Waiting demand gap: waiting shoppers − stock. */
  demandGap: (waiting: number, stock: number) => waiting - stock,
};

/**
 * Relative change between the current and the previous period, used for the
 * KPI deltas. A previous value of 0 means "no baseline", which is reported as 0
 * rather than as an infinite growth.
 */
export const periodDelta = (current: number, previous: number) =>
  previous > 0 ? (current - previous) / previous : 0;

/** Rounds a ratio to a fixed number of decimals without float noise. */
export const roundRate = (value: number, decimals = 4) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Rounds a currency amount to two decimals. */
export const roundMoney = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

/**
 * Funnel stages never shrink as the funnel narrows. A stage that would exceed its
 * predecessor is clamped to it so a report can never show an impossible funnel
 * (e.g. more clicks than delivered notifications caused by a data gap).
 */
export const clampFunnel = (counts: number[]) => {
  let previous = Number.POSITIVE_INFINITY;
  return counts.map((count) => {
    const clamped = Math.max(0, Math.min(count, previous));
    previous = clamped;
    return clamped;
  });
};

/** Formats a ratio as a percentage string, e.g. `12.3%`. */
export const formatPercent = (value: number, decimals = 1) => {
  const safe = Number.isFinite(value) ? value : 0;
  return `${(safe * 100).toFixed(decimals)}%`;
};

/**
 * A funnel stage: the count, the rate from the previous stage, and how many
 * shoppers dropped off (count and rate).
 */
export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** Share of the previous stage that continued. */
  rateFromPrevious: number;
  /** How many of the previous stage did not continue. */
  dropOff: number;
  /** Share of the previous stage that dropped off. */
  dropOffRate: number;
};

/**
 * Builds the funnel stages from a list of `[key, label, count]` tuples. The counts
 * are clamped so the funnel is monotonic, and every rate goes through `safeRate`.
 */
export const buildFunnel = (
  stages: Array<[string, string, number]>,
): FunnelStage[] => {
  const clamped = clampFunnel(stages.map(([, , count]) => count));
  return stages.map(([key, label], index) => {
    const count = clamped[index];
    const previous = index === 0 ? count : clamped[index - 1];
    return {
      key,
      label,
      count,
      rateFromPrevious: index === 0 ? 1 : safeRate(count, previous),
      dropOff: index === 0 ? 0 : Math.max(0, previous - count),
      dropOffRate: index === 0 ? 0 : rates.dropOffRate(count, previous),
    };
  });
};

/**
 * Revenue is always labelled so a merchant knows whether it is proven or inferred.
 * (ANALYTICS_REPORTS_SPEC.md section 3, rule 4.)
 */
export const REVENUE_LABEL = {
  direct: "direct",
  estimated: "estimated",
  mixed: "direct + estimated",
} as const;

export type RevenueLabel = (typeof REVENUE_LABEL)[keyof typeof REVENUE_LABEL];
