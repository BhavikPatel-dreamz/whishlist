import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { loadReport } from "../models/reports.server";
import { reportTabs } from "../lib/reports";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const params = new URL(request.url).searchParams;
  const data = await loadReport(shop.id, admin, params);
  const count = data.table.rows.length;
  const pages = Math.max(1, Math.ceil(count / 10));
  const requested = Number(params.get("page") || 1);
  const page = Number.isInteger(requested)
    ? Math.max(1, Math.min(pages, requested))
    : 1;
  return {
    ...data,
    table: {
      ...data.table,
      rows: data.table.rows.slice((page - 1) * 10, page * 10),
    },
    count,
    page,
    pages,
  };
}

export default function Reports() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const submit = useSubmit();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const [search, setSearch] = useState(params.get("q") || "");
  useEffect(() => {
    setSearch(params.get("q") || "");
  }, [params]);
  const datesRef = useRef<HTMLDetailsElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  useEffect(() => {
    setFrom(data.from);
    setTo(data.to);
    if (!data.error && datesRef.current) datesRef.current.open = false;
  }, [data]);
  useEffect(() => () => clearTimeout(searchTimer.current), [data.tab]);
  const revalidator = useRevalidator();
  const busy = navigation.state !== "idle" || revalidator.state !== "idle";
  const query = new URLSearchParams({
    from: data.from,
    to: data.to,
    tab: data.tab,
  });
  if (params.get("kind") === "running-low") query.set("kind", "running-low");
  if (params.get("q")) query.set("q", params.get("q")!);
  if (params.get("sort")) query.set("sort", params.get("sort")!);
  const pageUrl = (page: number) => {
    const next = new URLSearchParams(query);
    next.set("page", String(page));
    return `/app/reports?${next}`;
  };
  async function exportReport() {
    setExporting(true);
    setExportError("");
    try {
      // Fetch within the embedded app so App Bridge can authenticate the request.
      const response = await fetch(`/app/reports/export?${query}`, {
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
      link.download = `${data.tab}-${data.from}-${data.to}.csv`;
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
  return (
    <main className="ws-reports">
      <TitleBar title="Reports" />
      <nav className="ws-reports-tabs" aria-label="Report categories">
        {reportTabs.map(([key, label]) => (
          <Link
            key={key}
            to={`/app/reports?${new URLSearchParams({ tab: key, from: data.from, to: data.to })}`}
            aria-current={data.tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
        {data.tab === "shoppers" && <span aria-current="page">Shoppers</span>}
      </nav>
      <header className="ws-reports-heading">
        <div>
          <h1>{data.table.title}</h1>
          <p>{data.table.description}</p>
        </div>
        <div className="ws-reports-actions">
          <button
            type="button"
            className="ws-reports-button"
            disabled={
              !data.count ||
              busy ||
              exporting ||
              search !== (params.get("q") || "")
            }
            onClick={exportReport}
          >
            {exporting ? "Exporting…" : "↥ Export"}
          </button>
          <details className="ws-reports-dates" ref={datesRef}>
            <summary>
              ▣ {data.from} – {data.to}
            </summary>
            <Form
              method="get"
              action="/app/reports"
              onSubmit={() => clearTimeout(searchTimer.current)}
            >
              <input type="hidden" name="tab" value={data.tab} />
              {params.get("kind") === "running-low" && (
                <input type="hidden" name="kind" value="running-low" />
              )}
              <input type="hidden" name="q" value={params.get("q") || ""} />
              <input
                type="hidden"
                name="sort"
                value={params.get("sort") || "default"}
              />
              <label>
                From (UTC)
                <input
                  type="date"
                  name="from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  max={to}
                  required
                />
              </label>
              <label>
                To (UTC)
                <input
                  type="date"
                  name="to"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  min={from}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
              </label>
              <button className="ws-reports-button" disabled={busy}>
                Apply dates
              </button>
            </Form>
          </details>
        </div>
      </header>
      {exportError && <p role="alert">{exportError}</p>}
      {data.error && <p role="alert">{data.error} Showing the last 7 days.</p>}
      <section
        className="ws-reports-card"
        aria-label={data.table.title}
        aria-busy={busy}
      >
        <div className="ws-reports-toolbar">
          <span>{data.table.label}</span>
          <Form
            method="get"
            action="/app/reports"
            className="ws-reports-search"
            key={data.tab}
            onSubmit={() => clearTimeout(searchTimer.current)}
          >
            <input type="hidden" name="tab" value={data.tab} />
            <input type="hidden" name="from" value={data.from} />
            <input type="hidden" name="to" value={data.to} />
            {params.get("kind") === "running-low" && (
              <input type="hidden" name="kind" value="running-low" />
            )}
            <input
              name="q"
              type="search"
              aria-label="Search report"
              placeholder="Search report…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                const form = event.currentTarget.form!;
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(
                  () => submit(form, { replace: true }),
                  350,
                );
              }}
            />
            <select
              name="sort"
              aria-label="Sort report"
              value={params.get("sort") || "default"}
              onChange={(event) => {
                clearTimeout(searchTimer.current);
                submit(event.currentTarget.form!, { replace: true });
              }}
            >
              <option value="default">Default order</option>
              <option value="title-asc">{data.table.columns[0]} A–Z</option>
              <option value="title-desc">{data.table.columns[0]} Z–A</option>
            </select>
            <button className="ws-reports-button" disabled={busy}>
              Apply
            </button>
          </Form>
        </div>
        {data.count ? (
          <div className="ws-reports-table-scroll">
            <table>
              <thead>
                <tr>
                  {data.table.imageColumn && <th scope="col">Product Image</th>}
                  {data.table.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.table.rows.map((row) => (
                  <tr key={row.id}>
                    {data.table.imageColumn && (
                      <td>
                        {row.image ? (
                          <img
                            src={row.image}
                            alt=""
                            width={36}
                            height={36}
                            loading="lazy"
                          />
                        ) : (
                          <span
                            className="ws-reports-no-image"
                            aria-label="No product image"
                          >
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {row.cells.map((cell, i) => (
                      <td key={i}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ws-reports-empty">
            <svg
              width="136"
              height="144"
              viewBox="0 0 136 144"
              aria-hidden="true"
            >
              <circle cx="68" cy="72" r="62" fill="#f1f2f3" />
              <path
                d="M26 20h78v108H26z"
                fill="white"
                stroke="#ddd"
                strokeWidth="2"
              />
              <path d="M38 33h27v27H38z" fill="#e3ad49" />
              {[73, 82, 91, 100, 109].map((y) => (
                <path
                  key={y}
                  d={`M38 ${y}h53`}
                  stroke="#e6e6e6"
                  strokeWidth="3"
                />
              ))}
            </svg>
            <h2>No data available</h2>
            <p>
              {data.tab === "shared"
                ? "Shared wishlist tracking is not available yet."
                : "There are no items to display for the selected criteria."}
            </p>
            <button
              className="ws-reports-button ws-reports-primary"
              onClick={() => revalidator.revalidate()}
              disabled={busy}
            >
              {busy ? "Refreshing…" : "↻ Refresh Data"}
            </button>
          </div>
        )}
      </section>
      {data.count > 0 && (
        <nav className="ws-reports-pagination" aria-label="Report pages">
          {data.page > 1 ? (
            <Link to={pageUrl(data.page - 1)} aria-label="Previous page">
              ‹
            </Link>
          ) : (
            <span aria-disabled="true">‹</span>
          )}
          <span>
            {(data.page - 1) * 10 + 1}–{Math.min(data.page * 10, data.count)} of{" "}
            {data.count} items
          </span>
          {data.page < data.pages ? (
            <Link to={pageUrl(data.page + 1)} aria-label="Next page">
              ›
            </Link>
          ) : (
            <span aria-disabled="true">›</span>
          )}
        </nav>
      )}
      <p className="ws-reports-note">{data.table.note}</p>
    </main>
  );
}

// Previous report implementation retained as comments.
// import type { LoaderFunctionArgs } from "@remix-run/node";
// import { Link, useLoaderData } from "@remix-run/react";
// import { TitleBar } from "@shopify/app-bridge-react";
// import {
//   Page,
//   Card,
//   BlockStack,
//   Text,
//   DataTable,
//   InlineStack,
//   Button,
// } from "@shopify/polaris";
// import { authenticate } from "../shopify.server";
// import { requireShop } from "../lib/shop.server";
// import { loadAnalyticsMetrics } from "../models/analytics-metrics.server";
// import { shopperValue } from "../lib/analytics-metrics";
// import { MetricsDateFilter } from "../components/AnalyticsMetrics";
//
// export async function loader({ request }: LoaderFunctionArgs) {
//   const { session, admin } = await authenticate.admin(request);
//   const shop = await requireShop(session.shop);
//   const params = new URL(request.url).searchParams;
//   const kind = ["shoppers", "popular", "running-low"].includes(
//     params.get("kind") || "",
//   )
//     ? params.get("kind")!
//     : "popular";
//   const metrics = await loadAnalyticsMetrics(shop.id, admin, params);
//   const count = (
//     kind === "shoppers"
//       ? metrics.shoppers
//       : kind === "popular"
//         ? metrics.popular
//         : metrics.runningLow
//   ).length;
//   const pages = Math.max(1, Math.ceil(count / 50));
//   const requestedPage = Number(params.get("page") || 1);
//   const page = Number.isInteger(requestedPage)
//     ? Math.max(1, Math.min(pages, requestedPage))
//     : 1;
//   return {
//     metrics: {
//       ...metrics,
//       shoppers: metrics.shoppers.slice((page - 1) * 50, page * 50),
//       popular: metrics.popular.slice((page - 1) * 50, page * 50),
//       runningLow: metrics.runningLow.slice((page - 1) * 50, page * 50),
//     },
//     kind,
//     count,
//     page,
//     pages,
//   };
// }
//
// export default function Reports() {
//   const { metrics, kind, count, page, pages } = useLoaderData<typeof loader>();
//   const title =
//     kind === "shoppers"
//       ? "Shoppers"
//       : kind === "popular"
//         ? "Popular Products"
//         : "Running out soon";
//   const reportUrl = (nextKind: string, nextPage = 1) =>
//     `/app/reports?${new URLSearchParams({ kind: nextKind, from: metrics.from, to: metrics.to, page: String(nextPage) })}`;
//   const products = kind === "popular" ? metrics.popular : metrics.runningLow;
//   return (
//     <Page
//       fullWidth
//       title={`${title} report`}
//       backAction={{
//         content: "Analytics",
//         url: `/app/analytics?${new URLSearchParams({ from: metrics.from, to: metrics.to })}`,
//       }}
//     >
//       <TitleBar title="Reports" />
//       <BlockStack gap="400">
//         <InlineStack gap="400">
//           {[
//             ["shoppers", "Shoppers"],
//             ["popular", "Popular Products"],
//             ["running-low", "Running out soon"],
//           ].map(([key, label]) => (
//             <Link
//               key={key}
//               to={reportUrl(key)}
//               aria-current={kind === key ? "page" : undefined}
//             >
//               {label}
//             </Link>
//           ))}
//         </InlineStack>
//         <MetricsDateFilter data={metrics} action="/app/reports" kind={kind} />
//         {metrics.error && (
//           <p role="alert">{metrics.error} Showing the last 7 days.</p>
//         )}
//         <Text as="p" tone="subdued">
//           Currently saved items added in the selected date range (UTC).
//           Popularity counts distinct shoppers. Running out soon means at least 2
//           shoppers and 10 or fewer units across all locations. Stock is current;
//           estimated value uses one unit per product at its current minimum
//           price.
//         </Text>
//         <Card>
//           <BlockStack gap="400">
//             <Text as="h2" variant="headingMd">
//               {title} · {count} results
//             </Text>
//             {count ? (
//               kind === "shoppers" ? (
//                 <DataTable
//                   columnContentTypes={["text", "numeric", "numeric", "text"]}
//                   headings={[
//                     "Shopper",
//                     "Products",
//                     "Saved variants",
//                     "Estimated value",
//                   ]}
//                   rows={metrics.shoppers.map((row) => [
//                     row.name,
//                     row.products,
//                     row.saves,
//                     shopperValue(row),
//                   ])}
//                 />
//               ) : (
//                 <DataTable
//                   columnContentTypes={["text", "numeric", "numeric", "numeric"]}
//                   headings={[
//                     "Product",
//                     "Shoppers",
//                     "Saved variants",
//                     "Current stock",
//                   ]}
//                   rows={products.map((row) => [
//                     row.title,
//                     row.shoppers,
//                     row.saves,
//                     row.stock ?? "Unavailable",
//                   ])}
//                 />
//               )
//             ) : (
//               <Text as="p" tone="subdued">
//                 No results for this date range.
//               </Text>
//             )}
//             <InlineStack align="space-between">
//               <Button url={reportUrl(kind, page - 1)} disabled={page <= 1}>
//                 Previous
//               </Button>
//               <Text as="p">
//                 Page {page} of {pages}
//               </Text>
//               <Button url={reportUrl(kind, page + 1)} disabled={page >= pages}>
//                 Next
//               </Button>
//             </InlineStack>
//           </BlockStack>
//         </Card>
//       </BlockStack>
//     </Page>
//   );
// }
