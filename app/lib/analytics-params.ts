/**
 * Shared query-string handling for the analytics report endpoints
 * (ANALYTICS_REPORTS_SPEC.md section 9).
 *
 * Every report accepts the same parameters, so they are parsed in one place and
 * every endpoint agrees on what "the same request" means.
 */

export type DateRange = {
  /** Inclusive UTC day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive UTC day, `YYYY-MM-DD`. */
  to: string;
};

export type GroupBy = "day" | "week" | "month";

export type ReportFormat = "json" | "csv";

export type AnalyticsParams = {
  from: string;
  to: string;
  compare: boolean;
  groupBy: GroupBy;
  productId: string | null;
  customerType: string | null;
  status: string | null;
  channel: string | null;
  q: string | null;
  page: number;
  pageSize: number;
  sort: string | null;
  order: "asc" | "desc";
  format: ReportFormat;
};

const DAY_MS = 86400000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  const base = Date.parse(`${day}T00:00:00Z`);
  return toIsoDay(new Date(base + amount * DAY_MS));
}

/** Today in UTC, as an inclusive day string. */
export function today(now = new Date()): string {
  return toIsoDay(now);
}

/**
 * The default window: the last 30 days ending today. Analytics reports look at
 * behaviour over a window, so a month is a more useful default than the
 * seven days the dashboard widget uses.
 */
export function defaultRange(now = new Date()): DateRange {
  const end = today(now);
  return { from: addDays(end, -29), to: end };
}

/**
 * The period immediately before the given one, with the same length. Used for
 * the "compare to previous period" mode.
 */
export function previousRange(range: DateRange): DateRange {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const days = Math.round((to - from) / DAY_MS) + 1;
  const previousTo = new Date(from - DAY_MS);
  const previousFrom = new Date(from - days * DAY_MS);
  return { from: toIsoDay(previousFrom), to: toIsoDay(previousTo) };
}

/** The number of days a range covers, inclusive. */
export function rangeLength(range: DateRange): number {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  return Math.max(1, Math.round((to - from) / DAY_MS) + 1);
}

/** Half-open UTC bounds for an inclusive day range. */
export function rangeBounds(range: DateRange) {
  return {
    gte: new Date(`${range.from}T00:00:00Z`),
    lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + DAY_MS),
  };
}

/** Every day in the range, as `YYYY-MM-DD` strings. */
export function rangeDays(range: DateRange): string[] {
  const days: string[] = [];
  const end = Date.parse(`${range.to}T00:00:00Z`);
  for (
    let cursor = Date.parse(`${range.from}T00:00:00Z`);
    cursor <= end;
    cursor += DAY_MS
  ) {
    days.push(toIsoDay(new Date(cursor)));
  }
  return days;
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/**
 * Parses the report query string. Invalid values fall back to sane defaults
 * rather than erroring, so a bookmarked URL never breaks the page.
 */
export function parseAnalyticsParams(
  params: URLSearchParams,
  options: { now?: Date; maxPageSize?: number } = {},
): AnalyticsParams {
  const now = options.now ?? new Date();
  const fallback = defaultRange(now);
  const maxPageSize = options.maxPageSize ?? 200;

  let from = params.get("from")?.trim() || fallback.from;
  let to = params.get("to")?.trim() || fallback.to;
  if (!isIsoDay(from)) from = fallback.from;
  if (!isIsoDay(to)) to = fallback.to;
  if (from > to) [from, to] = [to, from];
  const lastDay = today(now);
  if (to > lastDay) to = lastDay;
  if (from > to) from = to;

  const groupByParam = params.get("groupBy");
  const groupBy: GroupBy =
    groupByParam === "week" || groupByParam === "month" ? groupByParam : "day";

  const orderParam = params.get("order");
  const order: "asc" | "desc" =
    orderParam === "asc" ? "asc" : orderParam === "desc" ? "desc" : "desc";

  const formatParam = params.get("format");

  const trimmed = (value: string | null) => value?.trim() || null;

  return {
    from,
    to,
    compare: params.get("compare") === "true" || params.get("compare") === "1",
    groupBy,
    productId: trimmed(params.get("productId")),
    customerType: trimmed(params.get("customerType")),
    status: trimmed(params.get("status")),
    channel: trimmed(params.get("channel")),
    q: trimmed(params.get("q")),
    page: parsePositiveInt(params.get("page"), 1, 100000),
    pageSize: parsePositiveInt(params.get("pageSize"), 25, maxPageSize),
    sort: trimmed(params.get("sort")),
    order,
    format: formatParam === "csv" ? "csv" : "json",
  };
}

/** The range of the requested period. */
export function paramsRange(params: AnalyticsParams): DateRange {
  return { from: params.from, to: params.to };
}

/** The range of the comparison period, or null when comparison is off. */
export function compareRange(params: AnalyticsParams): DateRange | null {
  return params.compare ? previousRange(paramsRange(params)) : null;
}

/**
 * The SQL expression that buckets a timestamp column for the requested
 * grouping. Weeks start on Monday, matching Postgres' `date_trunc`.
 */
export const groupBySql = (groupBy: GroupBy) => {
  switch (groupBy) {
    case "week":
      return `date_trunc('week', "createdAt" AT TIME ZONE 'UTC')::date`;
    case "month":
      return `date_trunc('month', "createdAt" AT TIME ZONE 'UTC')::date`;
    default:
      return `"createdAt"::date`;
  }
};
