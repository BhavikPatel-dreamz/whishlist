/**
 * Shared definitions for the "Back-in-Stock Requests" list that lives inside the
 * Analytics → Stock List report.
 *
 * The request filters use their own query-string keys (`rq`, `rstatus`, …) so they never
 * collide with the report toolbar (`q`, `sort`, `page`) that drives the inventory table
 * on the same page. The date range (`from`/`to`) is shared on purpose — one range drives
 * every report on the page.
 */

export const REQUEST_STATUS_OPTIONS = [
  { label: "All statuses", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Sending", value: "SENDING" },
  { label: "Sent", value: "SENT" },
  { label: "Failed", value: "FAILED" },
  { label: "Unsubscribed", value: "CANCELLED" },
];

export const REQUEST_CHANNEL_OPTIONS = [
  { label: "All channels", value: "ALL" },
  { label: "Email", value: "email" },
  { label: "SMS", value: "sms" },
];

export const REQUEST_OUTCOME_OPTIONS = [
  { label: "All request outcomes", value: "ALL" },
  { label: "Notified", value: "notified" },
  { label: "Clicked through", value: "clicked" },
  { label: "Purchased", value: "purchased" },
];

export const REQUEST_SORT_OPTIONS = [
  { label: "Newest request first", value: "newest" },
  { label: "Oldest request first", value: "oldest" },
  { label: "Most requests", value: "requests" },
  { label: "Most products", value: "products" },
  { label: "Customer A–Z", value: "contact" },
];

export const REQUEST_PARAMS = {
  query: "rq",
  status: "rstatus",
  channel: "rchannel",
  product: "rproduct",
  sort: "rsort",
  page: "rpage",
  outcome: "routcome",
} as const;

export type RequestListFilters = {
  status: string;
  channel: string;
  productId: string;
  query: string;
  sort: string;
  page: number;
  outcome: string;
};

export function readRequestFilters(
  params: URLSearchParams,
): RequestListFilters {
  const page = Number.parseInt(params.get(REQUEST_PARAMS.page) || "1", 10);
  return {
    status: params.get(REQUEST_PARAMS.status) || "ALL",
    channel: params.get(REQUEST_PARAMS.channel) || "ALL",
    productId: params.get(REQUEST_PARAMS.product) || "ALL",
    query: params.get(REQUEST_PARAMS.query) || "",
    sort: params.get(REQUEST_PARAMS.sort) || "newest",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    outcome: params.get(REQUEST_PARAMS.outcome) || "ALL",
  };
}

/** Copies the request filters onto a new query string — used by pagination links and export. */
export function withRequestParams(
  params: URLSearchParams,
  overrides: Record<string, string | null> = {},
) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(overrides)) {
    if (!value || value === "ALL") next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/**
 * The request filters that are currently active, as `[name, value]` pairs.
 *
 * The Analytics page has two filter sets on it: the report toolbar (`q`, `sort`, `kind`)
 * and the back-in-stock request filters (`rq`, `rstatus`, …). Every form and link on the
 * page has to carry the other set over, otherwise changing one filter silently resets
 * the other one.
 */
export function requestParamEntries(
  params: URLSearchParams,
): [string, string][] {
  return Object.values(REQUEST_PARAMS)
    .map((key) => [key, params.get(key) ?? ""] as [string, string])
    .filter(([, value]) => value !== "");
}
