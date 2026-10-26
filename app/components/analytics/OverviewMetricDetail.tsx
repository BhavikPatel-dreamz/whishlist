import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import type {
  OverviewDetail,
  OverviewDetailColumn,
  OverviewDetailMetric,
  OverviewDetailRow,
} from "../../lib/overview-detail";
import type { ReportSlug } from "../../lib/report-contract";

type FetcherData = OverviewDetail | { error: string };

function isDetail(value: FetcherData | undefined): value is OverviewDetail {
  return Boolean(value && "metric" in value && "columns" in value);
}

function fmtN(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function fmtP(value: number) {
  return (value * 100).toFixed(1) + "%";
}

/**
 * The overview already server-loads the top products for the first paint, so
 * the default Saves view renders instantly instead of waiting for a request.
 */
function savesDetail(
  products: Array<Record<string, unknown>>,
): OverviewDetail {
  return {
    metric: "saves",
    title: "Top 5 products by saves",
    description: "Products saved most often in the selected period.",
    columns: [
      { label: "Product" },
      { label: "Saves", align: "right" },
      { label: "Conversion", align: "right" },
    ],
    rows: products.slice(0, 5).map((row) => ({
      productId: row.productId ? String(row.productId) : null,
      values: [
        String(row.title ?? row.productId ?? "Product"),
        fmtN(Number(row.saves ?? 0)),
        fmtP(Number(row.conversionRate ?? row.conv ?? 0)),
      ],
    })),
    emptyMessage: "No product activity in this date range.",
    reportSlug: "wishlisted-products",
  };
}

function DetailRow({
  row,
  columns,
  onOpenProduct,
}: {
  row: OverviewDetailRow;
  columns: OverviewDetailColumn[];
  onOpenProduct: (productId: string) => void;
}) {
  const clickable = Boolean(row.productId);
  return (
    <tr
      className={clickable ? "ca-clickable" : undefined}
      title={clickable ? "Open product details" : undefined}
      onClick={() => {
        if (row.productId) onOpenProduct(row.productId);
      }}
    >
      {row.values.map((value, index) => {
        const align = columns[index]?.align === "right" ? "ca-n" : undefined;
        if (index === 0 && clickable) {
          return (
            <td key={index} className={align}>
              <button
                type="button"
                className="ca-link"
                onClick={(event) => {
                  event.stopPropagation();
                  if (row.productId) onOpenProduct(row.productId);
                }}
              >
                {value}
              </button>
            </td>
          );
        }
        return (
          <td key={index} className={align}>
            {value}
          </td>
        );
      })}
    </tr>
  );
}

export function OverviewMetricDetail({
  metric,
  from,
  to,
  topProducts,
  onOpenProduct,
  onOpenReport,
}: {
  metric: OverviewDetailMetric;
  from: string;
  to: string;
  topProducts: Array<Record<string, unknown>>;
  onOpenProduct: (productId: string) => void;
  onOpenReport: (slug: ReportSlug) => void;
}) {
  const fetcher = useFetcher<FetcherData>();
  const loadedKey = useRef<string | null>(null);
  const url = `/app/api/analytics/overview-detail?metric=${encodeURIComponent(
    metric,
  )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  useEffect(() => {
    if (metric === "saves") return;
    const key = `${metric}|${from}|${to}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    fetcher.load(url);
  }, [metric, from, to, url, fetcher]);

  const local = metric === "saves" ? savesDetail(topProducts) : null;
  const fetched =
    !local && isDetail(fetcher.data) && fetcher.data.metric === metric
      ? fetcher.data
      : null;
  const detail = local ?? fetched;
  const responseError =
    !local && fetcher.data && "error" in fetcher.data
      ? fetcher.data.error
      : null;
  const requestKey = `${metric}|${from}|${to}`;
  const requested = loadedKey.current === requestKey;
  const loading =
    !local &&
    !detail &&
    !responseError &&
    (fetcher.state !== "idle" || !requested);
  const error =
    responseError ??
    (!local && requested && fetcher.state === "idle" && !detail
      ? "Unable to load this breakdown."
      : null);

  return (
    <div className="ca-card ca-overview-detail">
      <div className="ca-row">
        <div>
          <h3 className="ca-h3">
            {detail?.title ?? "Overview breakdown"}
          </h3>
          <p className="ca-mu">
            {detail?.description ?? "Loading the breakdown for this card…"}
          </p>
        </div>
        {detail && (
          <button
            type="button"
            className="ca-btn"
            onClick={() => onOpenReport(detail.reportSlug)}
          >
            View full report
          </button>
        )}
      </div>

      {loading ? (
        <div className="ca-empty">Loading…</div>
      ) : error ? (
        <div className="ca-empty">
          {error}{" "}
          <button
            type="button"
            className="ca-link"
            onClick={() => fetcher.load(url)}
          >
            Try again
          </button>
        </div>
      ) : detail && detail.rows.length === 0 ? (
        <div className="ca-empty">{detail.emptyMessage}</div>
      ) : detail ? (
        <div className="ca-tw">
          <table className="ca-table">
            <thead>
              <tr>
                {detail.columns.map((column, index) => (
                  <th
                    key={`${column.label}-${index}`}
                    className={column.align === "right" ? "ca-n" : undefined}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row, index) => (
                <DetailRow
                  key={`${row.productId ?? "row"}-${index}`}
                  row={row}
                  columns={detail.columns}
                  onOpenProduct={onOpenProduct}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
