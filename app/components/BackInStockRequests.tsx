import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useSearchParams } from "@remix-run/react";
import {
  REQUEST_CHANNEL_OPTIONS,
  REQUEST_OUTCOME_OPTIONS,
  REQUEST_PARAMS,
  REQUEST_SORT_OPTIONS,
  REQUEST_STATUS_OPTIONS,
} from "../lib/back-in-stock-requests";

export type BackInStockRequestProduct = {
  productId: string;
  productTitle: string | null;
  variantId: string;
  variantTitle: string | null;
  status: string;
  requestedAt: string | Date;
  imageUrl?: string | null;
};

export type BackInStockRequest = {
  contactKey: string;
  email: string | null;
  phone: string | null;
  channel: string;
  customerId: string | null;
  requests: number;
  productCount: number;
  firstRequestAt: string | Date;
  lastRequestAt: string | Date;
  statuses: string[];
  notified: number;
  converted: number;
  products: BackInStockRequestProduct[];
};

export type BackInStockRequestsData = {
  rows: BackInStockRequest[];
  totals: {
    customers: number;
    requests: number;
    products: number;
    notified: number;
    converted: number;
  };
  total: number;
  page: number;
  pageCount: number;
  productOptions: { productId: string; productTitle: string | null; requests: number }[];
  customerNames: Record<string, string>;
  filters: {
    status: string;
    channel: string;
    productId: string;
    outcome: string;
    query: string;
    sort: string;
  };
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "is-pending",
  CONFIRMED: "is-pending",
  SENDING: "is-sending",
  SENT: "is-sent",
  FAILED: "is-failed",
  CANCELLED: "is-cancelled",
  UNSUBSCRIBED: "is-cancelled",
};

// Failed alerts stay retryable from this screen, so present them as pending work
// instead of exposing a terminal-looking status to the merchant.
function displayStatus(status: string) {
  if (status === "FAILED") return "PENDING";
  if (status === "CANCELLED") return "UNSUBSCRIBED";
  return status;
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function contactInitials(row: BackInStockRequest) {
  const contact = row.email || row.phone || "?";
  return contact.slice(0, 1).toUpperCase();
}

/** The specific products a customer asked to be notified about, with a show-all toggle. */
function RequestedProducts({ products }: { products: BackInStockRequestProduct[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!products.length) return <span className="ws-bisr-muted">—</span>;

  // Keep each customer row as compact as the product list. Extra requested
  // products are available on demand instead of making the row very tall.
  const visible = expanded ? products : products.slice(0, 1);
  const hidden = products.length - visible.length;

  return (
    <div className="ws-bisr-products">
      {visible.map((product) => (
        <div
          className="ws-bisr-product"
          key={`${product.productId}-${product.variantId}`}
        >
          {product.imageUrl ? (
            <img
              className="ws-bisr-product-image"
              src={product.imageUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
            />
          ) : (
            <span className="ws-bisr-product-image ws-bisr-product-image--empty" aria-hidden="true">
              ◇
            </span>
          )}
          <span className="ws-bisr-product-copy">
            <span className="ws-bisr-product-title">
              {product.productTitle || product.productId}
            </span>
            <span className="ws-bisr-product-variant">
              {product.variantTitle && product.variantTitle !== "Default Title"
                ? product.variantTitle
                : `Variant ${product.variantId}`}
            </span>
          </span>
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="ws-bisr-link"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more
        </button>
      )}
      {expanded && products.length > 1 && (
        <button
          type="button"
          className="ws-bisr-link"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  );
}

/**
 * Back-in-Stock Requests — one row per customer with the specific products they asked to
 * be notified about. Rendered inside the Analytics → Stock List report.
 */
export function BackInStockRequests({ data }: { data: BackInStockRequestsData }) {
  const [searchParams] = useSearchParams();
  const retryFetcher = useFetcher<{
    ok: boolean;
    result?: {
      sent: number;
      failed: number;
      reactivated: number;
    };
  }>();
  const [query, setQuery] = useState(data.filters.query);
  const [status, setStatus] = useState(data.filters.status);
  const [channel, setChannel] = useState(data.filters.channel);
  const [product, setProduct] = useState(data.filters.productId);
  const [outcome, setOutcome] = useState(data.filters.outcome);
  const [sort, setSort] = useState(data.filters.sort);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    setQuery(data.filters.query);
    setStatus(data.filters.status);
    setChannel(data.filters.channel);
    setProduct(data.filters.productId);
    setOutcome(data.filters.outcome);
    setSort(data.filters.sort);
  }, [
    data.filters.query,
    data.filters.status,
    data.filters.channel,
    data.filters.productId,
    data.filters.outcome,
    data.filters.sort,
  ]);

  const productOptions = useMemo(() => {
    const options = [
      { label: "All products", value: "ALL" },
      ...data.productOptions.map((option) => ({
        label: option.productTitle
          ? `${option.productTitle} (${option.requests})`
          : `${option.productId} (${option.requests})`,
        value: option.productId,
      })),
    ];
    // Keep the active product selectable even when it has no requests in the range.
    if (
      product !== "ALL" &&
      !data.productOptions.some((option) => option.productId === product)
    ) {
      options.push({ label: product, value: product });
    }
    return options;
  }, [data.productOptions, product]);

  const pageUrl = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 1) params.set(REQUEST_PARAMS.page, String(next));
    else params.delete(REQUEST_PARAMS.page);
    return `/app/analytics?${params}`;
  };

  // Every request filter currently applied, shown so an empty table can be explained.
  const activeFilters = (
    [
      { key: REQUEST_PARAMS.query, label: "Search", value: data.filters.query },
      {
        key: REQUEST_PARAMS.status,
        label: "Status",
        value:
          REQUEST_STATUS_OPTIONS.find(
            (option) => option.value === data.filters.status,
          )?.label ?? data.filters.status,
        skip: data.filters.status === "ALL",
      },
      {
        key: REQUEST_PARAMS.channel,
        label: "Channel",
        value:
          REQUEST_CHANNEL_OPTIONS.find(
            (option) => option.value === data.filters.channel,
          )?.label ?? data.filters.channel,
        skip: data.filters.channel === "ALL",
      },
      {
        key: REQUEST_PARAMS.product,
        label: "Product",
        value:
          data.productOptions.find(
            (option) => option.productId === data.filters.productId,
          )?.productTitle ?? data.filters.productId,
        skip: data.filters.productId === "ALL",
      },
      {
        key: REQUEST_PARAMS.outcome,
        label: "Outcome",
        value:
          REQUEST_OUTCOME_OPTIONS.find(
            (option) => option.value === data.filters.outcome,
          )?.label ?? data.filters.outcome,
        skip: data.filters.outcome === "ALL",
      },
    ] as { key: string; label: string; value: string; skip?: boolean }[]
  ).filter((filter) => !filter.skip && Boolean(filter.value));

  const clearUrl = () => {
    const params = new URLSearchParams(searchParams);
    for (const key of Object.values(REQUEST_PARAMS)) params.delete(key);
    return `/app/analytics?${params}`;
  };

  async function exportCsv() {
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams(searchParams);
      params.set("requests", "1");
      const response = await fetch(`/app/reports/export?${params}`, {
        headers: { Accept: "text/csv" },
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("text/csv")
      ) {
        throw new Error("Export failed. Please try again or reload the app.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "back-in-stock-requests.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Export failed. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  const retry = retryFetcher.data?.ok ? retryFetcher.data.result : null;

  return (
    <section
      className="ws-bisr-card"
      id="back-in-stock-requests"
      aria-label="Back-in-Stock Requests"
    >
      <div className="ws-bisr-heading">
        <h2>Back-in-Stock Requests</h2>
        <p>
          Customers who asked to be notified when a product came back in stock, and
          the specific products they requested.
        </p>
      </div>

      {retry && (
        <p className="ws-bisr-note" role="status">
          {retry.sent > 0
            ? `Re-sent ${retry.sent} notification${retry.sent === 1 ? "" : "s"}`
            : "No back-in-stock notifications were waiting to send"}
          {retry.failed > 0 ? ` · ${retry.failed} failed` : ""}
          {retry.reactivated > 0
            ? ` · reactivated ${retry.reactivated} failed alert${
                retry.reactivated === 1 ? "" : "s"
              }`
            : ""}
          .
        </p>
      )}
      {exportError && (
        <p className="ws-bisr-note is-error" role="alert">
          {exportError}
        </p>
      )}

      <div className="ws-bisr-toolbar">
        <form
          className="ws-bisr-filters"
          method="get"
          action="/app/analytics"
        >
          <input type="hidden" name="tab" value="stock" />
          <input type="hidden" name="from" value={searchParams.get("from") || ""} />
          <input type="hidden" name="to" value={searchParams.get("to") || ""} />
          {searchParams.get("q") && (
            <input type="hidden" name="q" value={searchParams.get("q")!} />
          )}
          {searchParams.get("sort") && (
            <input type="hidden" name="sort" value={searchParams.get("sort")!} />
          )}
          {searchParams.get("kind") && (
            <input type="hidden" name="kind" value={searchParams.get("kind")!} />
          )}
          <input
            type="search"
            name={REQUEST_PARAMS.query}
            aria-label="Search back-in-stock requests"
            placeholder="Search customer or product…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            name={REQUEST_PARAMS.status}
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {REQUEST_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            name={REQUEST_PARAMS.channel}
            aria-label="Filter by channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            {REQUEST_CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            name={REQUEST_PARAMS.product}
            aria-label="Filter by product"
            value={product}
            onChange={(event) => setProduct(event.target.value)}
          >
            {productOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            name={REQUEST_PARAMS.outcome}
            aria-label="Filter by request outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            {REQUEST_OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            name={REQUEST_PARAMS.sort}
            aria-label="Sort requests"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            {REQUEST_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="ws-reports-button" type="submit">
            Apply
          </button>
          {activeFilters.length > 0 && (
            <Link className="ws-bisr-link" to={clearUrl()}>
              Clear filters
            </Link>
          )}
        </form>
        <div className="ws-bisr-actions">
          <retryFetcher.Form method="post">
            <button
              className="ws-reports-button"
              type="submit"
              disabled={retryFetcher.state !== "idle"}
            >
              {retryFetcher.state !== "idle" ? "Retrying…" : "Retry failed & stuck"}
            </button>
          </retryFetcher.Form>
          <button
            className="ws-reports-button"
            type="button"
            onClick={exportCsv}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="ws-bisr-summary" aria-label="Request totals">
        <span><strong>{data.totals.customers}</strong> customers</span>
        <span><strong>{data.totals.requests}</strong> requests</span>
        <span><strong>{data.totals.products}</strong> products requested</span>
      </div>

      {data.rows.length ? (
        <div className="ws-reports-table-scroll">
          <table className="ws-bisr-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Products Requested</th>
                <th scope="col">Alert status</th>
              </tr>
            </thead>            <tbody>
              {data.rows.map((row) => (
                <tr key={row.contactKey}>
                  <td>
                    <div className="ws-bisr-customer ws-bisr-customer--list">
                      <span className="ws-bisr-avatar" aria-hidden="true">
                        {contactInitials(row)}
                      </span>
                      <span>
                        <strong>{row.email || row.phone || "Unknown contact"}</strong>
                        <span className="ws-bisr-muted">
                          {row.customerId
                            ? data.customerNames[row.customerId] ||
                              `Customer ${row.customerId}`
                            : "Guest checkout"}
                          {` · ${row.channel === "sms" ? "SMS" : "Email"} · ${row.requests} ${row.requests === 1 ? "request" : "requests"}`}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <RequestedProducts products={row.products} />
                  </td>
                  <td>
                    <div className="ws-bisr-alert-status">
                      <span className="ws-bisr-status-list">
                        {row.statuses.slice(0, 2).map((value) => (
                          <span
                            className={`ws-bisr-status ${STATUS_TONE[displayStatus(value)] || "is-pending"}`}
                            key={value}
                          >
                            {displayStatus(value)}
                          </span>
                        ))}
                        {row.statuses.length > 2 && (
                          <span className="ws-bisr-status is-pending">
                            +{row.statuses.length - 2}
                          </span>
                        )}
                      </span>
                      <span className="ws-bisr-muted">
                        {row.notified} notified · {row.converted} bought · {formatDate(row.lastRequestAt)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ws-bisr-empty">
          {activeFilters.length ? (
            <>
              No back-in-stock requests match{" "}
              <strong>
                {activeFilters
                  .map((filter) => `${filter.label}: ${filter.value}`)
                  .join(" · ")}
              </strong>{" "}
              in this date range.{" "}
              <Link className="ws-bisr-link" to={clearUrl()}>
                Clear filters
              </Link>
            </>
          ) : (
            "No back-in-stock requests were made for the selected dates."
          )}
        </p>
      )}

      {data.pageCount > 1 && (
        <nav className="ws-reports-pagination" aria-label="Request pages">
          {data.page > 1 ? (
            <Link to={pageUrl(data.page - 1)} aria-label="Previous page">
              ‹
            </Link>
          ) : (
            <span aria-disabled="true">‹</span>
          )}
          <span>
            {(data.page - 1) * 10 + 1}–{Math.min(data.page * 10, data.total)} of{" "}
            {data.total} customers
          </span>
          {data.page < data.pageCount ? (
            <Link to={pageUrl(data.page + 1)} aria-label="Next page">
              ›
            </Link>
          ) : (
            <span aria-disabled="true">›</span>
          )}
        </nav>
      )}
    </section>
  );
}
