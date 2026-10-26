/**
 * ClassicAnalytics — replicates the exact UI and functionality of the
 * "Analytics – Wishlist & Back in Stock" HTML demo, powered by authenticated
 * server-loaded reports.
 *
 * Features mirrored from the HTML:
 *  - Date range presets (7 / 14 / 30 / 90 days) + compare-to-previous-period
 *  - 5 report groups with chip sub-navigation
 *  - KPI cards with previous-period delta badges (▲ / ▼ %)
 *  - SVG trend charts (current + dashed previous period)
 *  - Sortable, searchable, filterable, paginated data tables
 *  - Revenue-type badges (Direct = blue, Estimated = amber)
 *  - Status badges colour-coded exactly like the HTML
 *  - CSV export via the API (`format=csv`)
 *  - Toast notifications
 *  - Light / dark theme (system default honoured)
 */
import { useEffect, useState } from "react";
import { useNavigation, useSearchParams } from "@remix-run/react";
import { downloadCsv } from "../../lib/download.client";
import { REPORT_CSV_ROW_KEYS, type ReportSlug } from "../../lib/report-contract";

const DAY_MS = 86400000;

/* ------------------------------------------------------------------ */
/*  Report catalogue — mirrors the HTML's GN groups + REP report list */
/* ------------------------------------------------------------------ */

const GROUPS = [
  { label: "Overview", slug: "overview", reports: [
    "overview", "activity-trends", "conversion-funnel",
    "revenue-attribution", "attribution-models", "customer-value",
  ]},
  { label: "Wishlist", slug: "wishlist", reports: [
    "wishlisted-products", "shared-wishlists", "wishlist-orders",
    "wishlist-conversion", "removed-abandoned", "wishlist-to-cart",
    "variant-demand", "save-sources", "reminder-performance",
    "guest-to-customer",
  ]},
  { label: "Back in Stock", slug: "back-in-stock", reports: [
    "stock-list", "alert-subscriptions", "pending-alerts",
    "alert-purchases", "restock-conversion", "low-stock-demand",
  ]},
  { label: "Customers", slug: "customers", reports: [
    "recurring-customers", "top-intent-customers", "segments",
  ]},
  { label: "Operations", slug: "operations", reports: [
    "notification-log", "usage",
  ]},
] as const;

const REPORT_TITLES: Record<string, string> = {
  overview: "Overview dashboard",
  "activity-trends": "Activity trends",
  "conversion-funnel": "Conversion funnel",
  "revenue-attribution": "Revenue and sales attribution",
  "attribution-models": "Attribution model comparison",
  "customer-value": "Customer-value impact",
  "wishlisted-products": "Wishlisted products",
  "shared-wishlists": "Shared wishlists",
  "wishlist-orders": "Wishlist orders",
  "wishlist-conversion": "Wishlist conversion",
  "removed-abandoned": "Removed and abandoned",
  "wishlist-to-cart": "Wishlist to cart",
  "variant-demand": "Variant-level demand",
  "save-sources": "Save sources",
  "reminder-performance": "Reminder and price-drop performance",
  "guest-to-customer": "Guest-to-customer conversion",
  "stock-list": "Stock list and inventory",
  "alert-subscriptions": "Alert subscriptions",
  "pending-alerts": "Pending alerts",
  "alert-purchases": "Alert purchases",
  "restock-conversion": "Restock conversion",
  "low-stock-demand": "Low-stock demand",
  "notification-delivery": "Notification delivery",
  "time-to-notify": "Time to notify and to purchase",
  "lost-sales": "Lost sales",
  "sell-through": "Sell-through after restock",
  "subscription-sources": "Subscription sources",
  "recurring-customers": "Recurring customers",
  "top-intent-customers": "Top customers by intent",
  segments: "Customer segments",
  "notification-log": "Notification log",
  usage: "Usage against plan",
};

const GROUP_OF: Record<string, number> = {};
GROUPS.forEach((g, gi) => g.reports.forEach((s) => { GROUP_OF[s] = gi; }));

type AnalyticsRow = Record<string, unknown>;
type AnalyticsReport = {
  report: ReportSlug;
  range: { from: string; to: string };
  compareRange: { from: string; to: string } | null;
  rows: AnalyticsRow[];
  summary: Record<string, number>;
  delta: Record<string, number>;
  series: Array<Record<string, string | number>>;
  columns: string[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  revenueLabel?: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(day: string, amount: number): string {
  return toIsoDay(new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY_MS));
}
function today(): string {
  return toIsoDay(new Date());
}

function rangeForDays(days: number): { from: string; to: string } {
  const to = today();
  const from = addDays(to, -(days - 1));
  return { from, to };
}

/** Safe division, mirrors the HTML's `sr` and `app/lib/metrics.ts`. */
function safeRate(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/** Format a number with grouping separators. */
function fmtN(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}
/** Format a percent, e.g. 12.3%. */
function fmtP(v: number): string {
  return (v * 100).toFixed(1) + "%";
}
/** Format currency, e.g. $1,234. */
function fmt$(v: number): string {
  return "$" + Math.round(v).toLocaleString("en-US");
}
/** Format days, e.g. 3.5 d. */
function fmtX(v: number): string {
  return v.toFixed(1) + " d";
}
/** Format minutes, e.g. 45 min. */
function fmtM(v: number): string {
  return Math.round(v) + " min";
}
/** Format hours, e.g. 4.0 h. */
function fmtH(v: number): string {
  return v.toFixed(1) + " h";
}

/**
 * Infer the cell format from a row key, mirroring the HTML column formats
 * (n / p / $ / b / d / t / x / m / h).
 */
const BADGE_KEYS = new Set([
  "status", "type", "flag", "state", "rep", "reason", "via", "perf",
  "channel", "kind", "revenueLabel", "freq", "model", "win", "customerType",
]);
const TEXT_KEYS = new Set([
  "source", "title", "label", "shopper", "cust", "customer", "prod",
  "product", "ord", "order", "variant", "name", "email", "phone",
  "contact", "error", "freq", "to", "segment", "tab", "window", "week",
]);
function inferFormat(key: string): "n" | "p" | "$" | "b" | "d" | "t" | "x" | "m" | "h" {
  const k = key.toLowerCase();
  if (BADGE_KEYS.has(k)) return "b";
  if (TEXT_KEYS.has(k)) return "t";
  if (k.includes("rate") || k.endsWith("pct") || k === "share" || k === "okrate" || k === "v2o" || k === "s2c" || k === "mergerate" || k === "confirmationrate" || k === "visittoorderrate") return "p";
  if (k.includes("revenue") || k.includes("value") || k.includes("spend") || k.includes("price") || k.includes("missed") || k === "aov" || k === "rpo" || k === "brev") return "$";
  if (k === "days") return "x";
  if (k === "hrs") return "h";
  if (k === "nt" || k === "ntm" || k === "tp" || k === "tpm" || k.includes("min")) return "m";
  if (k.includes("date") || k.endsWith("at") || k === "last" || k === "next" || k.includes("sync") || k === "lastactivity" || k === "signedup") return "d";
  return "n";
}

function badgeClass(value: unknown): "g" | "a" | "b" | "r" {
  const v = String(value ?? "");
  if (/Out|Weak|Bounced|Failed|Demand|Near/i.test(v)) return "r";
  if (/Low|Pending|Queued|Unconf|Average|Estimated|Paused|Occasional/i.test(v)) return "a";
  if (/Direct/i.test(v)) return "b";
  return "g";
}

function formatCell(value: unknown, format: string): string | JSX.Element {
  const v = value ?? "";
  if (format === "b") {
    const cls = badgeClass(v);
    return <span className={`ca-badge ca-${cls}`}>{String(v)}</span>;
  }
  if (format === "d" || format === "t") return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (format) {
    case "p": return fmtP(n);
    case "$": return fmt$(n);
    case "x": return fmtX(n);
    case "m": return fmtM(n);
    case "h": return fmtH(n);
    default: return fmtN(n);
  }
}

/** Delta badge shown next to a KPI when comparing periods. */
function deltaHtml(current: number, previous: number | null | undefined): JSX.Element | null {
  if (previous === null || previous === undefined) return null;
  const delta = safeRate(current - previous, previous);
  const sign = delta >= 0 ? "up" : "dn";
  const arrow = delta >= 0 ? "▲" : "▼";
  return (
    <span className={`ca-dl ca-${sign}`}>
      {arrow} {Math.abs(delta * 100).toFixed(1)}%
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG trend chart — mirrors the HTML's `ch()`                       */
/* ------------------------------------------------------------------ */

function trendChart(
  series: Array<Record<string, string | number>> | null | undefined,
  compare: boolean,
  selectedMetric: string,
  periodValue: number,
): JSX.Element | null {
  if (!series || series.length === 0) return null;

  const W = 640, H = 210, m = 34;
  const labels = series.map((r) => String(r.date ?? ""));
  const n = labels.length;

  // Collect numeric series (skip the date column).
  const metricKeys = Object.keys(series[0]).filter(
    (key) => key === selectedMetric,
  );
  const chartValues = (
    rows: Array<Record<string, string | number>>,
    key: string,
    previous: boolean,
    reconcileToPeriodTotal = false,
  ) => {
    const field = previous
      ? `previous${key[0].toUpperCase()}${key.slice(1)}`
      : key;
    if (key === "wishlistConversionRate") {
      let orders = 0;
      let saves = 0;
      const values = rows.map((row) => {
        orders += Number(row[previous ? "previousWishlistOrders" : "wishlistOrders"] ?? 0);
        saves += Number(row[previous ? "previousSaves" : "saves"] ?? 0);
        return safeRate(orders, saves);
      });
      if (reconcileToPeriodTotal && values.length > 0) {
        values[values.length - 1] = periodValue;
      }
      return values;
    }

    const values = rows.map((row) => {
      const value = Number(row[field]);
      return Number.isFinite(value) ? value : 0;
    });
    if (["saves", "subscriptions", "notificationsSent", "notificationClicks", "wishlistOrders", "attributedRevenue"].includes(key)) {
      let runningTotal = 0;
      for (let index = 0; index < values.length; index++) {
        runningTotal += values[index];
        values[index] = runningTotal;
      }
      if (reconcileToPeriodTotal && values.length > 0) {
        values[values.length - 1] = periodValue;
      }
    }
    return values;
  };
  const numericSeries = metricKeys.map((key) => ({
    key,
    values: chartValues(series, key, false, true),
  }));
  if (numericSeries.length === 0) return null;

  const previousSeries = compare
    ? numericSeries.flatMap((item) => {
        const key = `previous${item.key[0].toUpperCase()}${item.key.slice(1)}`;
        return series.some((row) => row[key] !== undefined)
            ? [{ key, values: chartValues(series, item.key, true) }]
          : [];
      })
    : [];
  const allValues = [...numericSeries, ...previousSeries].flatMap((item) => item.values);
  const mx = Math.max(1, ...allValues);

  const x = (i: number) =>
    m + (W - m - 8) * (n > 1 ? i / (n - 1) : 0);
  const y = (v: number) => H - 24 - (H - 44) * (v / mx);

  const path = (values: number[]) =>
    values
      .map((v, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1))
      .join("");

  const colours = ["var(--ca-ac)", "var(--ca-bl)", "var(--ca-am)", "var(--ca-rd)"];

  let svg = "";
  // Grid lines + axis labels.
  const tickCount = mx <= 4 ? Math.max(1, Math.ceil(mx)) : 4;
  for (let i = 0; i <= tickCount; i++) {
    const v = (mx * i) / tickCount;
    const tickLabel = selectedMetric === "attributedRevenue"
      ? fmt$(v)
      : selectedMetric === "wishlistConversionRate"
        ? fmtP(v)
        : fmtN(v);
    svg +=
      `<line x1="${m}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="var(--ca-bd)"/>` +
      `<text x="${m - 4}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ca-mu)">${tickLabel}</text>`;
  }
  // Series lines.
  numericSeries.forEach((item, index) => {
    const previous = previousSeries.find(
      (candidate) => candidate.key === `previous${item.key[0].toUpperCase()}${item.key.slice(1)}`,
    );
    if (previous) {
      svg += `<path d="${path(previous.values)}" fill="none" stroke="${colours[index % colours.length]}" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.55"/>`;
    }
    svg += `<path d="${path(item.values)}" fill="none" stroke="${colours[index % colours.length]}" stroke-width="2.4" stroke-linejoin="round"/>`;
  });
  svg +=
    `<text x="${m}" y="${H - 6}" font-size="10" fill="var(--ca-mu)">${labels[0]}</text>` +
    `<text x="${W - 8}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--ca-mu)">${labels[n - 1]}</text>`;

  const metricLabel: Record<string, string> = {
    saves: "Saves",
    uniqueSavers: "Unique savers",
    subscriptions: "Subscriptions",
    pendingAlerts: "Pending alerts",
    notificationsSent: "Notifications sent",
    notificationClicks: "Clicks",
    wishlistOrders: "Attributed orders",
    attributedRevenue: "Attributed revenue",
    wishlistConversionRate: "Overall conversion",
  };
  const legend = numericSeries.map(
    (s, si) =>
      `<span><i style="background:${colours[si % colours.length]}"></i>${metricLabel[s.key] ?? s.key}</span>`,
  ).join("");

  return (
    <div className="ca-card" style={{ marginTop: 12 }}>
      <h3 className="ca-h3">{metricLabel[selectedMetric] ?? "Trend"}</h3>
      <p className="ca-mu">
        {selectedMetric === "pendingAlerts"
          ? `Current snapshot: ${fmtN(periodValue)}. Historical backlog snapshots are not available.`
          : selectedMetric === "wishlistConversionRate"
            ? `Selected-period conversion: ${fmtP(periodValue)}`
            : selectedMetric === "attributedRevenue"
              ? `Selected-period total: ${fmt$(periodValue)}`
              : `Selected-period total: ${fmtN(periodValue)}. Chart points show each date bucket.`}
      </p>
      <div
        dangerouslySetInnerHTML={{
          __html:
            `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Trend chart">${svg}</svg>` +
            `<div className="ca-lg">${legend}</div>`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export type ClassicAnalyticsProps = {
  report: AnalyticsReport;
  topProducts: AnalyticsRow[];
  productBreakdown: AnalyticsRow[];
  collectionOptions: Array<{ id: string; title: string }>;
};

export function ClassicAnalytics({ report, topProducts, productBreakdown, collectionOptions }: ClassicAnalyticsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTrendMetric, setSelectedTrendMetric] = useState("saves");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const navigation = useNavigation();
  const slug = report.report;
  const group = GROUP_OF[slug] ?? 0;
  const { from, to } = report.range;
  const prev = report.compareRange;
  const compare = prev !== null;
  const groupBy = searchParams.get("groupBy") ?? "day";
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const so = searchParams.get("sort");
  const dir = searchParams.get("order") === "asc" ? 1 : -1;
  const pg = report.pagination.page;
  const filterKey = ["notification-delivery", "notification-log", "reminder-performance"].includes(slug)
    ? "channel"
    : "status";
  const filterValue = searchParams.get(filterKey) ?? "";
  const collectionFilter = searchParams.get("collectionId") ?? "";
  const attributionModelFilter = searchParams.get("model") ?? "";
  const attributionWindowFilter = searchParams.get("windowDays") ?? "";
  const filterOptions = ["notification-delivery", "reminder-performance"].includes(slug)
    ? ["EMAIL", "SMS", "WHATSAPP", "PUSH"]
    : slug === "pending-alerts"
      ? ["PENDING", "SENDING", "FAILED", "CANCELLED"]
      : [];
  const data = report;
  const rows = report.rows;
  const summary = report.summary;
  const delta = report.delta;
  const series = report.series;
  const pagination = report.pagination;
  const columns = report.columns;
  const loading = navigation.state !== "idle";

  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
  }, [searchParams]);

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    if (!next.has("pageSize")) next.set("pageSize", "8");
    setSearchParams(next);
  };
  const selectReport = (nextSlug: string, extra: Record<string, string | undefined> = {}) => updateParams({
    report: nextSlug === "overview" ? undefined : nextSlug,
    q: undefined,
    status: undefined,
    channel: undefined,
    productId: undefined,
    collectionId: undefined,
    model: undefined,
    windowDays: undefined,
    sort: undefined,
    order: "desc",
    page: "1",
    ...extra,
  });

  const currentGroup = GROUPS[group];

  const handleDateChange = (nextDays: number) => {
    updateParams(rangeForDays(nextDays));
  };

  const handleExport = async () => {
    const url = new URL(
      `/app/api/reports/${slug}`,
      window.location.origin,
    );
    new URLSearchParams(searchParams).forEach((value, key) => {
      if (key !== "report" && key !== "format") {
        url.searchParams.set(key, value);
      }
    });
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("format", "csv");
    url.searchParams.set("includeLists", "1");
    setExporting(true);
    setExportError("");
    try {
      await downloadCsv(
        url.toString(),
        `wishlist-back-in-stock-${from}_${to}.csv`,
      );
    } catch {
      setExportError("CSV export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const reportSlugs = currentGroup.reports;
  const reportTitle = REPORT_TITLES[slug] ?? slug;

  /* ---- Build column definitions from the API response ---- */
  const reportRows: AnalyticsRow[] = rows;
  const firstRow = reportRows.length > 0 ? reportRows[0] : null;
  const rowKeys = REPORT_CSV_ROW_KEYS[slug];
  const colDefs = columns.map((label: string, i: number) => {
    const key = rowKeys[i] ?? (firstRow ? Object.keys(firstRow)[i] : `col${i}`);
    return { key, label: String(label), format: inferFormat(key) };
  });

  const totalRow = colDefs
    .filter((c) => c.format === "n" || c.format === "$" || c.format === "p")
    .slice(0, 4);

  /* ---- Renderers ---- */

  const renderKpis = () => {
    if (slug === "overview") {
      const K = [
        ["Saves", "saves", "n"],
        ["Unique savers", "uniqueSavers", "n"],
        ["Subscriptions", "alertSubscriptions", "n"],
        ["Pending alerts", "pendingAlerts", "n"],
        ["Notifications sent", "notificationsSent", "n"],
        ["Clicks", "notificationClicks", "n"],
        ["Attributed orders", "wishlistOrders", "n"],
        ["Attributed revenue", "attributedRevenue", "$"],
        ["Overall conversion", "wishlistConversionRate", "p"],
      ];
      return (
        <div className="ca-kpis">
          {K.map(([label, key, format]) => {
            const val = summary[key] ?? 0;
            const prev = delta[key] !== undefined ? summary[key] / (1 + delta[key]) : null;
            const content = (
              <>
                <span className="ca-mu">{label}</span>
                <b>
                  {format === "p" ? fmtP(val) : format === "$" ? fmt$(val) : fmtN(val)}
                  {deltaHtml(val, prev)}
                </b>
              </>
            );
            return (
              <button
                type="button"
                className={`ca-k ca-k-button${selectedTrendMetric === key ? " ca-k-active" : ""}`}
                key={key}
                aria-pressed={selectedTrendMetric === key}
                onClick={() => setSelectedTrendMetric(key)}
              >
                {content}
              </button>
            );
          })}
        </div>
      );
    }

    if (slug === "alert-subscriptions") {
      const metrics: Array<[string, string]> = [
        ["Total variants", "variants"],
        ["Total subscriptions", "subscriptions"],
        ["New in period", "newSubscriptions"],
        ["Notified", "notified"],
      ];
      return (
        <div className="ca-kpis" style={{ margin: 0 }}>
          {metrics.map(([label, key]) => (
            <div className="ca-k" key={key}>
              <span className="ca-mu">{label}</span>
              <b>{fmtN(summary[key] ?? 0)}</b>
            </div>
          ))}
        </div>
      );
    }

    if (slug === "shared-wishlists") {
      const metrics: Array<[string, string, boolean?]> = [
        ["Total shares", "shares"],
        ["Total visits", "visits"],
        ["Total orders after visit", "ordersAfterVisit"],
        ["Total visit-to-order rate", "visitToOrderRate", true],
      ];
      return (
        <div className="ca-kpis" style={{ margin: 0 }}>
          {metrics.map(([label, key, isPercent]) => (
            <div className="ca-k" key={key}>
              <span className="ca-mu">{label}</span>
              <b>
                {isPercent ? fmtP(summary[key] ?? 0) : fmtN(summary[key] ?? 0)}
              </b>
            </div>
          ))}
        </div>
      );
    }

    if (slug === "revenue-attribution") {
      const metrics: Array<[string, string, "$" | "n"]> = [
        ["Total orders", "orders", "n"],
        ["Total revenue", "revenue", "$"],
        ["Total avg order", "averageOrderValue", "$"],
      ];
      return (
        <div className="ca-kpis" style={{ margin: 0 }}>
          {metrics.map(([label, key, format]) => (
            <div className="ca-k" key={key}>
              <span className="ca-mu">{label}</span>
              <b>
                {format === "$" ? fmt$(summary[key] ?? 0) : fmtN(summary[key] ?? 0)}
              </b>
            </div>
          ))}
        </div>
      );
    }

    if (slug === "customer-value") {
      const metrics: Array<[string, string, "n" | "$" | "p"]> = [
        ["Total customers", "customers", "n"],
        ["Total orders", "orders", "n"],
        ["Total revenue", "spend", "$"],
        ["Repeat purchase rate", "repeatPurchaseRate", "p"],
      ];
      return (
        <div className="ca-kpis" style={{ margin: 0 }}>
          {metrics.map(([label, key, format]) => (
            <div className="ca-k" key={key}>
              <span className="ca-mu">{label}</span>
              <b>
                {format === "$"
                  ? fmt$(summary[key] ?? 0)
                  : format === "p"
                    ? fmtP(summary[key] ?? 0)
                    : fmtN(summary[key] ?? 0)}
              </b>
            </div>
          ))}
        </div>
      );
    }

    if (slug === "wishlist-orders") {
      const metrics: Array<[string, string, "n" | "$"]> = [
        ["Total order number", "orders", "n"],
        ["Total wishlisted products", "wishlistedProducts", "n"],
        ["Total value", "value", "$"],
      ];
      return (
        <div className="ca-kpis" style={{ margin: 0 }}>
          {metrics.map(([label, key, format]) => (
            <div className="ca-k" key={key}>
              <span className="ca-mu">{label}</span>
              <b>
                {format === "$" ? fmt$(summary[key] ?? 0) : fmtN(summary[key] ?? 0)}
              </b>
            </div>
          ))}
        </div>
      );
    }

    // Table reports: show totals for the first few numeric summary metrics.
    const kpis = totalRow.map((c) => {
      const val = summary[c.key] ?? 0;
      return (
        <div className="ca-k" key={c.key}>
          <span className="ca-mu">Total {c.label.toLowerCase()}</span>
          <b>{formatCell(val, c.format)}</b>
        </div>
      );
    });
    if (kpis.length === 0) return null;
    return <div className="ca-kpis" style={{ margin: 0 }}>{kpis}</div>;
  };

  const renderTable = () => {
    if (rows.length === 0) {
      return (
        <div className="ca-empty">
          <b>No results</b><br />
          Try a wider date range or clear the filters.
        </div>
      );
    }

    const hasPrevious = pagination.page > 1;
    const hasNext = pagination.page < pagination.pageCount;

    return (
      <>
        <div className="ca-ctl" style={{ marginBottom: 8, flexWrap: "wrap" }}>
          <form onSubmit={(event) => { event.preventDefault(); updateParams({ q, page: "1" }); }}>
            <input
              className="ca-input-search"
              type="search"
              placeholder="Search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              aria-label="Search"
            />
          </form>
          {filterOptions.length > 0 && (
            <select
              className="ca-select"
              value={filterValue}
              onChange={(event) => updateParams({ [filterKey]: event.target.value || undefined, page: "1" })}
              aria-label={filterKey === "channel" ? "Filter by channel" : "Filter by status"}
            >
              <option value="">All</option>
              {filterOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          )}
          {slug === "wishlisted-products" && (
            <select
              className="ca-select"
              value={collectionFilter}
              onChange={(event) => updateParams({ collectionId: event.target.value || undefined, page: "1" })}
              aria-label="Filter by collection"
            >
              <option value="">All collections</option>
              {collectionOptions.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.title}</option>
              ))}
            </select>
          )}
          {slug === "attribution-models" && (
            <>
              <select
                className="ca-select"
                value={attributionModelFilter}
                onChange={(event) => updateParams({ model: event.target.value || undefined, page: "1" })}
                aria-label="Filter by attribution model"
              >
                <option value="">All models</option>
                <option value="last_click">Last-click</option>
                <option value="any_touch">Any-touch</option>
              </select>
              <select
                className="ca-select"
                value={attributionWindowFilter}
                onChange={(event) => updateParams({ windowDays: event.target.value || undefined, page: "1" })}
                aria-label="Filter by attribution window"
              >
                <option value="">All windows</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </>
          )}
          <span className="ca-mu">{rows.length} rows</span>
        </div>
        <div className="ca-tw">
          <table className="ca-table">
            <thead>
              <tr>
                {colDefs.map((c) => {
                  const active = so === c.key;
                  return (
                    <th
                      key={c.key}
                      className={`ca-n ${c.format === "n" || c.format === "$" || c.format === "p" ? "ca-n" : ""}`}
                      onClick={() => {
                        updateParams({
                          sort: c.key,
                          order: so === c.key && dir > 0 ? "desc" : "asc",
                          page: "1",
                        });
                      }}
                    >
                      {c.label}
                      {active ? (dir > 0 ? " ▲" : " ▼") : ""}
                    </th>
                  );
                })}
                {slug === "wishlisted-products" && <th>Variants</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row[colDefs[0]?.key ?? "id"] ?? index)}>
                  {colDefs.map((c) => (
                    <td
                      key={c.key}
                      className={`ca-n ${c.format === "n" || c.format === "$" || c.format === "p" ? "ca-n" : ""}`}
                    >
                      {slug === "attribution-models" && c.key === "model" ? (
                        <button
                          type="button"
                          className="ca-btn"
                          onClick={() => updateParams({
                            model: row.model === "any_touch" ? "any_touch" : "last_click",
                            windowDays: String(row.windowDays),
                            page: "1",
                          })}
                        >
                          {row.model === "any_touch" ? "Any-touch" : "Last-click"}
                        </button>
                      ) : formatCell(row[c.key], c.format)}
                    </td>
                  ))}
                  {slug === "wishlisted-products" && (
                    <td>
                      <button
                        type="button"
                        className="ca-btn"
                        onClick={() => selectReport("variant-demand", { productId: String(row.productId ?? "") })}
                      >
                        View variants
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ca-pg">
          <button
            className="ca-btn"
            disabled={!hasPrevious}
            onClick={() => updateParams({ page: String(pg - 1) })}
          >
            Previous
          </button>
          <span>Page {pagination.page} of {pagination.pageCount}</span>
          <button
            className="ca-btn"
            disabled={!hasNext}
            onClick={() => updateParams({ page: String(pg + 1) })}
          >
            Next
          </button>
        </div>
      </>
    );
  };

  const renderFunnel = () => {
    const totals: Record<string, number> = summary;
    const wishlist: [string, number][] = [
      ["Product views", totals.productViews ?? 0],
      ["Saved", totals.wishlistSaves ?? 0],
      ["Added to cart", totals.wishlistAddToCart ?? 0],
      ["Purchased", totals.wishlistOrders ?? 0],
    ];
    const restock: [string, number][] = [
      ["Subscribed", totals.alertSubscriptions ?? 0],
      ["Notified", totals.notificationsSent ?? 0],
      ["Clicked", totals.notificationClicks ?? 0],
      ["Purchased", totals.restockOrders ?? 0],
    ];

    const buildFunnel = (stages: [string, number][]) => {
      let previous = Infinity;
      const clamped = stages.map(([, count]) => {
        const c = Math.max(0, Math.min(count, previous));
        previous = c;
        return c;
      });
      return stages.map(([label, count], i) => {
        const c = clamped[i];
        const prev = i === 0 ? c : clamped[i - 1];
        const rate = i === 0 ? 1 : safeRate(c, prev);
        const drop = i === 0 ? 0 : Math.max(0, prev - c);
        const width = clamped[0] > 0 ? Math.max(1, (c / clamped[0]) * 100) : 0;
        const pRate = prev === 0 ? 1 : safeRate(clamped[i], clamped[i > 0 ? i - 1 : i]);
        const pDrop = i > 0 ? Math.max(0, clamped[i - 1] - clamped[i]) : 0;
        return (
          <div key={label} className="ca-fn">
            <span>{label}</span>
            <div className="ca-bar" style={{ width: `${width}%` }}>{fmtN(c)}</div>
            {i > 0 ? (
              <div className="ca-drop">
                {fmtP(pRate)} of previous · lost {fmtN(pDrop)} ({fmtP(safeRate(pDrop, prev))})
              </div>
            ) : (
              <div className="ca-drop">Starting stage</div>
            )}
          </div>
        );
      });
    };

    const funnels: Array<{ name: string; stages: [string, number][] }> = [
      { name: "Wishlist", stages: wishlist },
      { name: "Back in stock", stages: restock },
    ];

    return (
      <>
        <div className="ca-two">
          {funnels.map(({ name, stages }) => (
            <div className="ca-card" key={name}>
              <h3 className="ca-h3">{name}</h3>
              <div className="ca-fn">{buildFunnel(stages)}</div>
            </div>
          ))}
        </div>
        <div className="ca-card">
          <div className="ca-row">
            <h3 className="ca-h3">Wishlist product breakdown</h3>
            <button
              className="ca-btn"
              onClick={() => selectReport("wishlisted-products")}
            >
              View all products
            </button>
          </div>
          <p className="ca-mu">Top products by saves in the selected period</p>
          {productBreakdown.length > 0 ? (
            <div className="ca-tw">
              <table className="ca-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="ca-n">Saved</th>
                    <th className="ca-n">Save rate</th>
                    <th className="ca-n">Added to cart</th>
                    <th className="ca-n">Purchased</th>
                    <th className="ca-n">Conversion rate</th>
                  </tr>
                </thead>
                <tbody>
                  {productBreakdown.map((product, index) => (
                    <tr key={String(product.productId ?? index)}>
                      <td>{String(product.title ?? product.productId ?? "Product")}</td>
                      <td className="ca-n">{fmtN(Number(product.saves) || 0)}</td>
                      <td className="ca-n">{fmtP(Number(product.saveRate) || 0)}</td>
                      <td className="ca-n">{fmtN(Number(product.addsToCart) || 0)}</td>
                      <td className="ca-n">{fmtN(Number(product.purchases) || 0)}</td>
                      <td className="ca-n">{fmtP(Number(product.conversionRate) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ca-mu">No wishlist product activity in this period.</p>
          )}
        </div>
      </>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Layout                                                            */
  /* ------------------------------------------------------------------ */

  return (
    <div className="ca-body ca-box-sizing">
      <div className="ca-w">
        <div className="ca-row">
          <div>
            <h1 className="ca-h1">Analytics</h1>
            <p className="ca-mu">Wishlist and Back in Stock performance for your store</p>
          </div>
          <div className="ca-ctl">
            <select
              className="ca-select"
              value={String(days)}
              onChange={(e) => handleDateChange(Number(e.target.value))}
              aria-label="Date range"
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <label className="ca-cb">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => updateParams({ compare: e.target.checked ? "true" : "false", page: "1" })}
              />
              Compare to previous period
            </label>
            <button className="ca-btn p" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
        {exportError && <p className="ca-r" role="alert">{exportError}</p>}
        <p className="ca-mu" id="rl">
          {from} to {to}
          {prev
            ? ` · compared with ${prev.from} to ${prev.to}`
            : ""}
        </p>
        <div className="ca-tabs">
          {GROUPS.map((g, gi) => (
            <button
              key={g.slug}
              className={`ca-tab ${gi === group ? "on" : ""}`}
              onClick={() => {
                const first = g.reports[0];
                selectReport(first);
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="ca-sub">
          {reportSlugs.map((s) => (
            <button
              key={s}
              className={`ca-chip ${s === slug ? "on" : ""}`}
              onClick={() => {
                setQ("");
                selectReport(s);
              }}
            >
              {REPORT_TITLES[s]}
            </button>
          ))}
        </div>
        <main id="main">
          {loading ? (
            <div className="ca-empty">Loading…</div>
          ) : slug === "overview" ? (
            <>
              {renderKpis()}
              <div className="ca-card">
                <h3 className="ca-h3">Activity</h3>
                {trendChart(
                  series,
                  compare,
                  selectedTrendMetric,
                  summary[selectedTrendMetric] ?? 0,
                )}
              </div>
              <div className="ca-two">
                <div className="ca-card">
                  <h3 className="ca-h3">Top 5 products by saves</h3>
                  <div className="ca-tw">
                    <table className="ca-table">
                      <tr>
                        <th>Product</th>
                        <th className="ca-n">Saves</th>
                        <th className="ca-n">Conversion</th>
                      </tr>
                      {topProducts.map((row, index) => (
                        <tr key={String(row.productId ?? index)}>
                          <td>{String(row.title ?? row.productId ?? "")}</td>
                          <td className="ca-n">{fmtN(Number(row.saves ?? 0))}</td>
                          <td className="ca-n">{fmtP(Number(row.conversionRate ?? row.conv ?? 0))}</td>
                        </tr>
                      ))}
                      {topProducts.length === 0 && (
                        <tr><td colSpan={3}>No product activity in this date range.</td></tr>
                      )}
                    </table>
                  </div>
                </div>
                {/* <div className="ca-card">
                  <h3 className="ca-h3">Go to a detail report</h3>
                  <div className="ca-sub" style={{ flexWrap: "wrap" }}>
                    {["wishlist-conversion", "restock-conversion", "revenue-attribution", "low-stock-demand", "notification-delivery"].map((s) => (
                      <button
                        key={s}
                        className="ca-chip"
                        onClick={() => {
                          selectReport(s);
                        }}
                      >
                        {REPORT_TITLES[s]}
                      </button>
                    ))}
                  </div>
                  <p className="ca-mu">
                    Revenue here is{" "}
                    <span className="ca-badge ca-a">Estimated</span>{" "}
                    plus{" "}
                    <span className="ca-badge ca-b">Direct</span>{" "}
                    combined.
                  </p>
                </div> */}
              </div>
            </>
          ) : slug === "activity-trends" ? (
            <>
              <div className="ca-card">
                <div className="ca-row">
                  <h3 className="ca-h3">Activity by {groupBy}</h3>
                  <select
                    className="ca-select"
                    value={groupBy}
                    onChange={(event) => updateParams({ groupBy: event.target.value, page: "1" })}
                    aria-label="Group by"
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
                {trendChart(
                  series,
                  compare,
                  selectedTrendMetric,
                  summary[selectedTrendMetric] ?? 0,
                )}
              </div>
            </>
          ) : slug === "conversion-funnel" ? (
            <>
              {renderFunnel()}
            </>
          ) : (
            <>
              {data?.revenueLabel && (
                <p className="ca-mu">
                  Revenue label:{" "}
                  <span className={`ca-badge ca-${data.revenueLabel === "estimated" ? "a" : data.revenueLabel === "direct" ? "b" : "g"}`}>
                    {data.revenueLabel}
                  </span>
                </p>
              )}
              {renderKpis()}
              <div className="ca-card">
                <div className="ca-tw" id="tbl">
                  {renderTable()}
                </div>
              </div>
            </>
          )}
        </main>
        <p className="ca-ft">
          Revenue is labeled Direct (tracked click or wishlist-page order) or
          Estimated (purchase inside the attribution window). Windows: Back in
          Stock 7 days, Wishlist 14 days. Reports use events recorded for the
          selected date range.
        </p>
      </div>
    </div>
  );
}
