import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { AnalyticsMetrics } from "../components/AnalyticsMetrics";
import { DashboardHelp } from "../components/DashboardHelp";
import { loadAnalyticsMetrics } from "../models/analytics-metrics.server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const metrics = await loadAnalyticsMetrics(
    shop.id,
    admin,
    new URL(request.url).searchParams,
  );
  return { metrics };
}

export default function Analytics() {
  const { metrics } = useLoaderData<typeof loader>();
  return (
    <Page fullWidth>
      <TitleBar title="Analytics" />
      <div className="ws-analytics-page">
        <AnalyticsMetrics data={metrics} />
        <DashboardHelp />
      </div>
    </Page>
  );
}

// Previous analytics implementation retained below as comments.
// The old setup guide, summary cards, graphs, tables, loader, and action are inactive.
// import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
// import { useLoaderData, Link, useActionData, useFetcher } from "@remix-run/react";
// import { useEffect, useState } from "react";
// import {
//   Page,
//   Text,
//   Card,
//   BlockStack,
//   InlineStack,
//   Badge,
//   DataTable,
//   Button,
//   Box,
//   Collapsible,
//   TextField,
// } from "@shopify/polaris";
// import type { ColumnContentType } from "@shopify/polaris";
// import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
// import { DashboardHelp } from "../components/DashboardHelp";
// import { AnalyticsMetrics } from "../components/AnalyticsMetrics";
// import { loadAnalyticsMetrics } from "../models/analytics-metrics.server";
// import { authenticate } from "../shopify.server";
// import { requireShop } from "../lib/shop.server";
// import {
//   wishlistStats,
//   topWishlistedProducts,
//   metricsForProducts,
//   wishlistDrivenOrderCount,
// } from "../models/wishlist.server";
// import { topRequestedVariants } from "../models/stock-alert.server";
// import { getProductsByIds } from "../lib/shopify-data.server";
// import db from "../db.server";
// import { wishlistDailyAnalytics } from "../models/wishlist-analytics.server";
// import type { WishlistDay } from "../lib/wishlist-chart.shared";
// import { syncWishlistOrders } from "../lib/wishlist-order-sync.server";
// import { getUIConfigByShopDomain, upsertUIConfigForShopDomain } from "../models/ui-config.server";
//
// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const { session, admin } = await authenticate.admin(request);
//   const shop = await requireShop(session.shop);
//   const uiConfig = await getUIConfigByShopDomain(session.shop);
//   let orderSyncFailed = false;
//   try {
//     await syncWishlistOrders(shop.id, admin);
//   } catch (error) {
//     orderSyncFailed = true;
//     console.error("Wishlist order recovery failed", error);
//   }
//
//   const [wStats, topProducts, topVariants, wishlistOrderCount, dailyAnalytics, metrics] = await Promise.all([
//     wishlistStats(shop.id),
//     topWishlistedProducts(shop.id, 1000),
//     topRequestedVariants(shop.id, 10),
//     wishlistDrivenOrderCount(shop.id),
//     wishlistDailyAnalytics(shop.id),
//     loadAnalyticsMetrics(shop.id, admin, new URL(request.url).searchParams),
//   ]);
//
//   const wishlistProductIds = topProducts.map((p) => p.productId);
//   const requestProductIds = [...new Set(topVariants.map((v) => v.productId))];
//   const [wishlistMetrics, productMap] = await Promise.all([
//     metricsForProducts(shop.id, wishlistProductIds),
//     getProductsByIds(admin, Array.from(new Set([...wishlistProductIds, ...requestProductIds]))),
//   ]);
//
//   const orderSummary = {
//     totalOrders: wishlistOrderCount,
//     averageOrdersPerSave: wStats.total > 0 ? wishlistOrderCount / wStats.total : 0,
//   };
//
//   return {
//     metrics,
//     orderSyncFailed,
//     dailyAnalytics,
//     wishlistPageUrl: uiConfig?.themeSettings.wishlistPageUrl || "",
//     shop: {
//       domain: session.shop,
//       emailSubject: shop.emailSubject,
//       emailHeading: shop.emailHeading,
//       emailBody: shop.emailBody,
//       buttonLabel: shop.buttonLabel,
//       stockAlertDeliveryMode: shop.stockAlertDeliveryMode,
//       stockAlertDeliveryTime: shop.stockAlertDeliveryTime,
//     },
//     wStats,
//     topProducts,
//     topVariants,
//     wishlistMetrics,
//     productMap: Array.from(productMap.entries()),
//     orderSummary,
//   };
// };
//
// export const action = async ({ request }: ActionFunctionArgs) => {
//   const { session } = await authenticate.admin(request);
//   const shop = await requireShop(session.shop);
//   const formData = await request.formData();
//
//   if (formData.get("intent") === "save-wishlist-page-url") {
//     const wishlistPageUrl = String(formData.get("wishlistPageUrl") || "").trim();
//     if (!/^\/pages\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/?$/.test(wishlistPageUrl)) {
//       return { saved: false, error: "Enter a page path such as /pages/wishlist or /pages/my-favorites." };
//     }
//     await upsertUIConfigForShopDomain(session.shop, {
//       themeSettings: { wishlistPageUrl: wishlistPageUrl.replace(/\/$/, "") },
//     });
//     return { saved: true, error: null };
//   }
//
//   const emailSubject = String(formData.get("emailSubject") || "").trim();
//   const emailHeading = String(formData.get("emailHeading") || "").trim();
//   const emailBody = String(formData.get("emailBody") || "").trim();
//   const buttonLabel = String(formData.get("buttonLabel") || "").trim();
//   const stockAlertDeliveryMode = String(formData.get("stockAlertDeliveryMode") || "immediate");
//   const stockAlertDeliveryTime = String(formData.get("stockAlertDeliveryTime") || "09:00").trim();
//
//   await db.shop.update({
//     where: { id: shop.id },
//     data: {
//       emailSubject: emailSubject || shop.emailSubject,
//       emailHeading: emailHeading || shop.emailHeading,
//       emailBody: emailBody || shop.emailBody,
//       buttonLabel: buttonLabel || shop.buttonLabel,
//       stockAlertDeliveryMode: stockAlertDeliveryMode === "scheduled" ? "scheduled" : "immediate",
//       stockAlertDeliveryTime: /^\d{2}:\d{2}$/.test(stockAlertDeliveryTime)
//         ? stockAlertDeliveryTime
//         : shop.stockAlertDeliveryTime,
//     },
//   });
//
//   return { saved: true };
// };
//
// function MetricCard({
//   title,
//   value,
//   tone,
//   subtitle,
//   selected,
//   onClick,
// }: {
//   title: string;
//   value: string | number;
//   tone: string;
//   subtitle?: string;
//   selected?: boolean;
//   onClick?: () => void;
// }) {
//   return (
//     <div
//       role={onClick ? "button" : undefined}
//       tabIndex={onClick ? 0 : undefined}
//       onClick={onClick}
//       onKeyDown={(event) => {
//         if (onClick && (event.key === "Enter" || event.key === " ")) {
//           event.preventDefault();
//           onClick();
//         }
//       }}
//       style={{
//         borderRadius: 12,
//         padding: 20,
//         minHeight: 120,
//         background: "#ffffff",
//         color: "#111827",
//         border: "1px solid #e5e7eb",
//         boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
//         cursor: onClick ? "pointer" : undefined,
//         outline: selected ? "3px solid #111827" : "none",
//         outlineOffset: 3,
//       }}
//     >
//       <BlockStack gap="200">
//         <Text as="p" variant="headingSm" tone="inherit">
//           {title}
//         </Text>
//         <Text as="p" variant="heading2xl" tone="inherit">
//           {String(value)}
//         </Text>
//         {subtitle ? (
//           <Text as="p" variant="bodyMd" tone="inherit">
//             {subtitle}
//           </Text>
//         ) : null}
//       </BlockStack>
//     </div>
//   );
// }
//
// function TrendChart({ values, metric }: { values: WishlistDay[]; metric: "orders" | "wishlist" | "cart" }) {
//   const width = 1000;
//   const height = 340;
//   const left = 48;
//   const top = 24;
//   const chartWidth = width - 72;
//   const chartHeight = height - 72;
//   const max = Math.max(4, Math.ceil(Math.max(0, ...values.map(v => v[metric])) / 4) * 4);
//   const color = metric === "orders" ? "#8b1c7a" : metric === "wishlist" ? "#1d5b99" : "#3f6212";
//   const label = metric === "orders" ? "Wishlist orders" : metric === "wishlist" ? "Added to wishlist" : "Added to cart";
//   const point = (row: WishlistDay, i: number) => ({
//     x: left + i * chartWidth / Math.max(1, values.length - 1),
//     y: top + chartHeight * (1 - row[metric] / max),
//   });
//   return (
//     <div style={{ width: "100%", overflowX: "auto" }}>
//       <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: 600 }} role="img" aria-label={`${label} by date, last 30 days (UTC)`}>
//         {[0, 1, 2, 3, 4].map(tick => {
//           const y = top + chartHeight * tick / 4;
//           return <g key={tick}>
//             <line x1={left} x2={left + chartWidth} y1={y} y2={y} stroke="#e5e7eb" />
//             <text x="12" y={y + 4} fontSize="12" fill="#6b7280">{max - max * tick / 4}</text>
//           </g>;
//         })}
//         <polyline points={values.map((row, i) => { const p = point(row, i); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke={color} strokeWidth="3" />
//         {values.map((row, i) => {
//           const p = point(row, i);
//           const date = new Date(`${row.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
//           return <g key={row.date}>
//             <circle cx={p.x} cy={p.y} r="4" fill={color} tabIndex={0} aria-label={`${row.date}: ${row[metric]} ${label}`}>
//               <title>{`${row.date}: ${row[metric]} ${label}`}</title>
//             </circle>
//             {(i % 5 === 0 || i === values.length - 1) && <text x={p.x} y={height - 12} textAnchor="middle" fontSize="12" fill="#6b7280">{date}</text>}
//           </g>;
//         })}
//       </svg>
//     </div>
//   );
// }
//
// export default function Dashboard() {
//   const data = useLoaderData<typeof loader>();
//   const actionData = useActionData<typeof action>();
//   const shopify = useAppBridge();
//   const wishlistUrlFetcher = useFetcher<typeof action>();
//   const [wishlistPageUrl, setWishlistPageUrl] = useState(data.wishlistPageUrl);
//   useEffect(() => {
//     if (wishlistUrlFetcher.data?.saved) shopify.toast.show("Wishlist page URL saved");
//   }, [wishlistUrlFetcher.data, shopify]);
//   const [graphMetric, setGraphMetric] = useState<"orders" | "wishlist" | "cart">("orders");
//   const [viewMode, setViewMode] = useState<"summary" | "graph">("summary");
//   const [selectedMetric, setSelectedMetric] = useState<
//     "wishlists" | "products" | "value" | "average"
//   >("wishlists");
//   const [open, setOpen] = useState(false);
//   const setupGuideStorageKey = `wishlist-stock:setup-guide-dismissed:${data.shop.domain}`;
//
//   useEffect(() => {
//     try {
//       setOpen(localStorage.getItem(setupGuideStorageKey) !== "true");
//     } catch {
//       setOpen(true);
//     }
//   }, [setupGuideStorageKey]);
//
//   function closeSetupGuide() {
//     setOpen(false);
//     try {
//       localStorage.setItem(setupGuideStorageKey, "true");
//     } catch {
//       // The guide can still be closed when browser storage is unavailable.
//     }
//   }
//
//   const themeEditorUrl = `https://${data.shop.domain}/admin/themes/current/editor?context=apps`;
//   const newPageUrl = `https://${data.shop.domain}/admin/pages/new`;
//
//   useEffect(() => {
//     if (actionData?.saved) shopify.toast.show("Analytics settings saved");
//   }, [actionData, shopify]);
//
//   const productMap = new Map(data.productMap);
//   const orderSummary = data.orderSummary;
//
//   const selectedMetricTitle = {
//     wishlists: "All Wishlist Products",
//     products: "All Wishlisted Products",
//     value: "Wishlist Products and Orders",
//     average: "Average Wishlist Product Details",
//   }[selectedMetric];
//
//   const selectedMetricDescription = {
//     wishlists: "Every product saved to a wishlist, with its save and customer count.",
//     products: "Every unique product currently represented in wishlist activity.",
//     value: "Every product contributing to wishlist-driven cart adds and orders.",
//     average: "Product-level counts used to calculate the average wishlist value.",
//   }[selectedMetric];
//
//   const detailTable = {
//     wishlists: {
//       headings: ["Product", "Wishlist saves", "Added to cart", "Wishlist-driven orders", "Customers"],
//       types: ["text", "numeric", "numeric", "numeric", "numeric"] as ColumnContentType[],
//       rows: data.topProducts.map((row) => {
//         const product = productMap.get(row.productId);
//         const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
//         return [
//           product?.title || row.productId,
//           String(row.saves),
//           String(metric?.addsToCart ?? 0),
//           String(metric?.purchases ?? 0),
//           String(row.distinctShoppers),
//         ];
//       }),
//     },
//     products: {
//       headings: ["Product", "Wishlist saves", "Added to cart", "Wishlist-driven orders"],
//       types: ["text", "numeric", "numeric", "numeric"] as ColumnContentType[],
//       rows: data.topProducts.map((row) => {
//         const product = productMap.get(row.productId);
//         const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
//         return [
//           product?.title || row.productId,
//           String(row.saves),
//           String(metric?.addsToCart ?? 0),
//           String(metric?.purchases ?? 0),
//         ];
//       }),
//     },
//     value: {
//       headings: ["Product", "Wishlist-driven orders", "Added to cart", "Wishlist saves"],
//       types: ["text", "numeric", "numeric", "numeric"] as ColumnContentType[],
//       rows: data.topProducts.map((row) => {
//         const product = productMap.get(row.productId);
//         const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
//         return [
//           product?.title || row.productId,
//           String(metric?.purchases ?? 0),
//           String(metric?.addsToCart ?? 0),
//           String(row.saves),
//         ];
//       }),
//     },
//     average: {
//       headings: ["Product", "Wishlist saves", "Added to cart", "Wishlist-driven orders", "Orders per save"],
//       types: ["text", "numeric", "numeric", "numeric", "numeric"] as ColumnContentType[],
//       rows: data.topProducts.map((row) => {
//         const product = productMap.get(row.productId);
//         const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
//         const purchases = metric?.purchases ?? 0;
//         return [
//           product?.title || row.productId,
//           String(row.saves),
//           String(metric?.addsToCart ?? 0),
//           String(purchases),
//           (purchases / Math.max(1, row.saves)).toFixed(2),
//         ];
//       }),
//     },
//   }[selectedMetric];
//
//   const topBackInStockRows = data.topVariants.map((row) => {
//     const product = productMap.get(row.productId);
//     return [product?.title || row.productId, row.variantTitle || "-", String(row.waiting)];
//   });
//
//   const graphTotals = data.dailyAnalytics.reduce((total, day) => ({
//     orders: total.orders + day.orders,
//     wishlist: total.wishlist + day.wishlist,
//     cart: total.cart + day.cart,
//   }), { orders: 0, wishlist: 0, cart: 0 });
//   const cartProducts = data.topProducts.map(row => ({
//     id: row.productId,
//     title: productMap.get(row.productId)?.title || row.productId,
//     count: data.wishlistMetrics.find(metric => metric.productId === row.productId)?.addsToCart ?? 0,
//   }));
//   const totalCartAdds = cartProducts.reduce((total, product) => total + product.count, 0);
//   const maxCartAdds = Math.max(1, ...cartProducts.map(product => product.count));
//
//   return (
//     <Page fullWidth>
//       <TitleBar title="Analytics" />
//       <BlockStack gap="500">
//         <AnalyticsMetrics data={data.metrics} />
//         <Card>
//           <BlockStack gap="400">
//             <InlineStack align="space-between" blockAlign="center">
//               <Text as="h2" variant="headingMd">
//                 Getting started
//               </Text>
//               <Button
//                 variant="tertiary"
//                 disclosure={open ? "up" : "down"}
//                 onClick={() => open ? closeSetupGuide() : setOpen(true)}
//                 ariaExpanded={open}
//                 ariaControls="ws-setup-guide"
//               >
//                 {open ? "Hide" : "Setup guide"}
//               </Button>
//             </InlineStack>
//
//             <Collapsible
//               open={open}
//               id="ws-setup-guide"
//               transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
//             >
//               <BlockStack gap="500">
//                 <Text as="p" variant="bodyMd" tone="subdued">
//                   Three quick steps to put the wishlist and back-in-stock alerts live on
//                   your storefront.
//                 </Text>
//
//                 <BlockStack gap="200">
//                   <Text as="h3" variant="headingSm">
//                     1. Enable the app embed
//                   </Text>
//                   <Text as="p" variant="bodyMd" tone="subdued">
//                     Open your theme editor, switch on{" "}
//                     <Text as="span" fontWeight="semibold">
//                       Wishlist &amp; Stock Alerts
//                     </Text>{" "}
//                     under App embeds, then Save. This activates the hearts, the wishlist
//                     drawer, and the “Notify me” button.
//                   </Text>
//                   <InlineStack>
//                     <Button variant="primary" url={themeEditorUrl} target="_blank">
//                       Open theme editor
//                     </Button>
//                   </InlineStack>
//                 </BlockStack>
//
//                 <BlockStack gap="200">
//                   <Text as="h3" variant="headingSm">
//                     2. Create the wishlist page
//                   </Text>
//                   <Text as="p" variant="bodyMd" tone="subdued">
//                     Create an Online Store page with your preferred title and URL handle.
//                   </Text>
//                   <InlineStack gap="200">
//                     <Button url={newPageUrl} target="_blank">
//                       Create wishlist page
//                     </Button>
//                   </InlineStack>
//                   <wishlistUrlFetcher.Form method="post">
//                     <input type="hidden" name="intent" value="save-wishlist-page-url" />
//                     <BlockStack gap="200">
//                       <TextField
//                         label="Wishlist page URL"
//                         name="wishlistPageUrl"
//                         value={wishlistPageUrl}
//                         onChange={setWishlistPageUrl}
//                         autoComplete="off"
//                         placeholder="/pages/wishlist"
//                         helpText="Create the page first, then save its path, for example /pages/my-favorites. This overrides the theme embed URL for the header link and wishlist page."
//                         error={wishlistUrlFetcher.data && "error" in wishlistUrlFetcher.data ? wishlistUrlFetcher.data.error || undefined : undefined}
//                       />
//                       <InlineStack>
//                         <Button submit variant="primary" loading={wishlistUrlFetcher.state !== "idle"}>
//                           Save page URL
//                         </Button>
//                       </InlineStack>
//                     </BlockStack>
//                   </wishlistUrlFetcher.Form>
//                 </BlockStack>
//
//                 <BlockStack gap="200">
//                   <Text as="h3" variant="headingSm">
//                     3. Configure email sending
//                   </Text>
//                   <Text as="p" variant="bodyMd" tone="subdued">
//                     Set your email provider and a verified sender address so back-in-stock
//                     alerts actually deliver.
//                   </Text>
//                   <InlineStack>
//                     <Link to="/app/settings">Open settings</Link>
//                   </InlineStack>
//                 </BlockStack>
//                 <InlineStack>
//                   <Button variant="primary" onClick={closeSetupGuide}>
//                     Mark setup complete
//                   </Button>
//                 </InlineStack>
//               </BlockStack>
//             </Collapsible>
//           </BlockStack>
//         </Card>
//
//         <Box paddingBlockStart="200">
//           <InlineStack align="space-between" blockAlign="center">
//             <BlockStack gap="100">
//               <InlineStack gap="200" blockAlign="center">
//                 <Text as="h1" variant="heading2xl">
//                   Wishlist by Square
//                 </Text>
//               </InlineStack>
//               <Text as="p" variant="bodyMd" tone="subdued">
//                 Results for the last 30 days
//               </Text>
//             </BlockStack>
//             <InlineStack gap="200" blockAlign="center">
//               <Button
//                 variant={viewMode === "summary" ? "primary" : "secondary"}
//                 onClick={() => setViewMode("summary")}
//               >
//                 Summary
//               </Button>
//               <Button
//                 variant={viewMode === "graph" ? "primary" : "secondary"}
//                 onClick={() => setViewMode("graph")}
//               >
//                 Graph
//               </Button>
//               <Link to="/app/settings">
//                 <Button>Settings</Button>
//               </Link>
//             </InlineStack>
//           </InlineStack>
//         </Box>
//
//         {viewMode === "summary" ? (
//           <BlockStack gap="500">
//             <Box>
//               <InlineStack gap="400" wrap={false}>
//                 <div style={{ flex: "1 1 0" }}>
//                   <MetricCard
//                     title="Wishlists"
//                     value={data.wStats.total}
//                     tone="#8b1c7a"
//                     subtitle="Total wishlist saves"
//                     selected={selectedMetric === "wishlists"}
//                     onClick={() => setSelectedMetric("wishlists")}
//                   />
//                 </div>
//                 <div style={{ flex: "1 1 0" }}>
//                   <MetricCard
//                     title="Products"
//                     value={data.topProducts.length}
//                     tone="#1d5b99"
//                     subtitle="Most wishlisted products"
//                     selected={selectedMetric === "products"}
//                     onClick={() => setSelectedMetric("products")}
//                   />
//                 </div>
//                 <div style={{ flex: "1 1 0" }}>
//                   <MetricCard
//                     title="Wishlist orders"
//                     value={orderSummary.totalOrders}
//                     tone="#3f6212"
//                     subtitle="Wishlist-driven orders"
//                     selected={selectedMetric === "value"}
//                     onClick={() => setSelectedMetric("value")}
//                   />
//                 </div>
//                 <div style={{ flex: "1 1 0" }}>
//                   <MetricCard
//                     title="Average Wishlist"
//                     value={Number(orderSummary.averageOrdersPerSave ?? 0).toFixed(2)}
//                     tone="#374151"
//                     subtitle="Average per wishlist save"
//                     selected={selectedMetric === "average"}
//                     onClick={() => setSelectedMetric("average")}
//                   />
//                 </div>
//               </InlineStack>
//             </Box>
//
//             <Card>
//               <BlockStack gap="400">
//                 <InlineStack align="space-between" blockAlign="center">
//                   <Text as="h2" variant="headingMd">
//                     {selectedMetricTitle}
//                   </Text>
//                   <InlineStack gap="200" blockAlign="center">
//                     <Badge>{`${data.topProducts.length} items`}</Badge>
//                     <Button size="micro" onClick={() => setViewMode("graph")}>
//                       Open graph
//                     </Button>
//                   </InlineStack>
//                 </InlineStack>
//                 <Text as="p" tone="subdued">
//                   {selectedMetricDescription}
//                 </Text>
//                 {detailTable.rows.length ? (
//                   <DataTable
//                     columnContentTypes={detailTable.types}
//                     headings={detailTable.headings}
//                     rows={detailTable.rows}
//                   />
//                 ) : (
//                   <Text as="p" tone="subdued">
//                     No wishlist activity yet.
//                   </Text>
//                 )}
//               </BlockStack>
//             </Card>
//
//             <Card>
//               <BlockStack gap="400">
//                 <InlineStack align="space-between" blockAlign="center">
//                   <Text as="h2" variant="headingMd">
//                     Top Product Added for Back in Stock Notification
//                   </Text>
//                   <Badge>{`${data.topVariants.length} variants`}</Badge>
//                 </InlineStack>
//                 {topBackInStockRows.length ? (
//                   <DataTable
//                     columnContentTypes={["text", "text", "numeric"]}
//                     headings={["Product", "Variant", "Requests"]}
//                     rows={topBackInStockRows}
//                   />
//                 ) : (
//                   <Text as="p" tone="subdued">
//                     No stock alert requests yet.
//                   </Text>
//                 )}
//               </BlockStack>
//             </Card>
//           </BlockStack>
//         ) : (
//           <Card>
//             <BlockStack gap="400">
//               <InlineStack align="space-between" blockAlign="center">
//                 <BlockStack gap="100">
//                   <Text as="h2" variant="headingMd">
//                     Wishlist activity graph
//                   </Text>
//                   <Text as="p" tone="subdued">
//                     Select a card to see its daily counts for the last 30 days (UTC).
//                   </Text>
//                 </BlockStack>
//                 <Badge tone="success">{`${graphTotals.wishlist} saves in 30 days`}</Badge>
//               </InlineStack>
//
//               <InlineStack gap="300">
//                 {([
//                   { key: "orders", label: "Wishlist orders", color: "#8b1c7a" },
//                   { key: "wishlist", label: "Added to wishlist", color: "#1d5b99" },
//                   { key: "cart", label: "Added to cart", color: "#3f6212" },
//                 ] as const).map(card => (
//                   <button key={card.key} type="button" aria-pressed={graphMetric === card.key}
//                     onClick={() => setGraphMetric(card.key)}
//                     style={{ flex: 1, minWidth: 200, textAlign: "left", cursor: "pointer", background: card.color,
//                       color: "white", padding: 20, borderRadius: 8, border: "none", font: "inherit",
//                       outline: graphMetric === card.key ? "3px solid #111827" : undefined, outlineOffset: 3 }}>
//                     <span style={{ display: "block", fontWeight: 600 }}>{card.label}</span>
//                     <span style={{ display: "block", fontSize: 30, fontWeight: 700 }}>{card.key === "cart" ? totalCartAdds : card.key === "orders" ? orderSummary.totalOrders : graphTotals[card.key]}</span>
//                     <span>{card.key === "cart" ? "Total for products in the summary table" : card.key === "orders" ? "Total wishlist-driven orders" : "Last 30 days"}</span>
//                   </button>
//                 ))}
//               </InlineStack>
//               {graphMetric === "cart" && (
//                 <BlockStack gap="300">
//                   <Text as="h3" variant="headingMd">Added to cart by product — all time</Text>
//                   {cartProducts.map(product => (
//                     <div key={product.id}>
//                       <InlineStack align="space-between" gap="200">
//                         <Text as="p">{product.title}</Text>
//                         <Text as="p" fontWeight="semibold">{product.count}</Text>
//                       </InlineStack>
//                       <div role="img" aria-label={`${product.title}: ${product.count} cart adds`}
//                         style={{ marginTop: 6, height: 14, background: "#f1f5f9", borderRadius: 4 }}>
//                         <div style={{ width: `${product.count / maxCartAdds * 100}%`, height: "100%", background: "#3f6212", borderRadius: 4 }} />
//                       </div>
//                     </div>
//                   ))}
//                   {cartProducts.length === 0 && <Text as="p" tone="subdued">No wishlist products yet.</Text>}
//                   <Text as="p" tone="subdued">{`${totalCartAdds} total cart adds for these products. ${graphTotals.cart} dated cart adds across the store in the last 30 days.`}</Text>
//                 </BlockStack>
//               )}
//               <Text as="h3" variant="headingMd">
//                 {graphMetric === "orders" ? "Wishlist orders by recorded date" : graphMetric === "wishlist" ? "Added to wishlist by date saved" : "Added to cart by date"}
//               </Text>
//               <TrendChart values={data.dailyAnalytics} metric={graphMetric} />
//               {graphTotals[graphMetric] === 0 && <Text as="p" tone="subdued">No recorded activity for this metric in the last 30 days.</Text>}
//               <Text as="p" tone="subdued">
//                 {graphMetric === "orders"
//                   ? "The card shows total wishlist-driven orders. The chart shows distinct orders by their first recorded date in the last 30 days (UTC); recovered orders may be recorded later than checkout."
//                   : graphMetric === "wishlist"
//                   ? "Shows currently saved wishlist items by the date they were added."
//                   : "The product bars include earlier cart totals from the summary table. The daily chart only includes cart adds with recorded dates; earlier totals cannot be assigned to a date."}
//               </Text>
//             </BlockStack>
//           </Card>
//         )}
//         <DashboardHelp />
//       </BlockStack>
//     </Page>
//   );
// }
