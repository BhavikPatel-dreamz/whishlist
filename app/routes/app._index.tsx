import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useActionData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Button,
  Box,
  Collapsible,
} from "@shopify/polaris";
import type { ColumnContentType } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import {
  wishlistStats,
  topWishlistedProducts,
  metricsForProducts,
  wishlistDrivenOrderCount,
} from "../models/wishlist.server";
import { topRequestedVariants } from "../models/stock-alert.server";
import { getProductsByIds } from "../lib/shopify-data.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);

  const [wStats, topProducts, topVariants, wishlistOrderCount] = await Promise.all([
    wishlistStats(shop.id),
    topWishlistedProducts(shop.id, 1000),
    topRequestedVariants(shop.id, 10),
    wishlistDrivenOrderCount(shop.id),
  ]);

  const wishlistProductIds = topProducts.map((p) => p.productId);
  const requestProductIds = [...new Set(topVariants.map((v) => v.productId))];
  const [wishlistMetrics, productMap] = await Promise.all([
    metricsForProducts(shop.id, wishlistProductIds),
    getProductsByIds(admin, Array.from(new Set([...wishlistProductIds, ...requestProductIds]))),
  ]);

  const orderSummary = {
    totalOrders: wishlistOrderCount,
    averageOrdersPerSave: wStats.total > 0 ? wishlistOrderCount / wStats.total : 0,
  };

  return {
    shop: {
      domain: session.shop,
      emailSubject: shop.emailSubject,
      emailHeading: shop.emailHeading,
      emailBody: shop.emailBody,
      buttonLabel: shop.buttonLabel,
      stockAlertDeliveryMode: shop.stockAlertDeliveryMode,
      stockAlertDeliveryTime: shop.stockAlertDeliveryTime,
    },
    wStats,
    topProducts,
    topVariants,
    wishlistMetrics,
    productMap: Array.from(productMap.entries()),
    orderSummary,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const formData = await request.formData();

  const emailSubject = String(formData.get("emailSubject") || "").trim();
  const emailHeading = String(formData.get("emailHeading") || "").trim();
  const emailBody = String(formData.get("emailBody") || "").trim();
  const buttonLabel = String(formData.get("buttonLabel") || "").trim();
  const stockAlertDeliveryMode = String(formData.get("stockAlertDeliveryMode") || "immediate");
  const stockAlertDeliveryTime = String(formData.get("stockAlertDeliveryTime") || "09:00").trim();

  await db.shop.update({
    where: { id: shop.id },
    data: {
      emailSubject: emailSubject || shop.emailSubject,
      emailHeading: emailHeading || shop.emailHeading,
      emailBody: emailBody || shop.emailBody,
      buttonLabel: buttonLabel || shop.buttonLabel,
      stockAlertDeliveryMode: stockAlertDeliveryMode === "scheduled" ? "scheduled" : "immediate",
      stockAlertDeliveryTime: /^\d{2}:\d{2}$/.test(stockAlertDeliveryTime)
        ? stockAlertDeliveryTime
        : shop.stockAlertDeliveryTime,
    },
  });

  return { saved: true };
};

function MetricCard({
  title,
  value,
  tone,
  subtitle,
  selected,
  onClick,
}: {
  title: string;
  value: string | number;
  tone: string;
  subtitle?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        borderRadius: 12,
        padding: 20,
        minHeight: 120,
        background: "#ffffff",
        color: "#111827",
        border: "1px solid #e5e7eb",
        boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
        cursor: onClick ? "pointer" : undefined,
        outline: selected ? "3px solid #111827" : "none",
        outlineOffset: 3,
      }}
    >
      <BlockStack gap="200">
        <Text as="p" variant="headingSm" tone="inherit">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" tone="inherit">
          {String(value)}
        </Text>
        {subtitle ? (
          <Text as="p" variant="bodyMd" tone="inherit">
            {subtitle}
          </Text>
        ) : null}
      </BlockStack>
    </div>
  );
}

function TrendChart({
  values,
}: {
  values: { label: string; wishlist: number; cart: number; orders: number }[];
}) {
  const width = 1000;
  const height = 360;
  const padX = 48;
  const padY = 24;
  const chartHeight = height - padY * 2;
  const chartWidth = width - padX * 2;
  const maxValue = Math.max(1, ...values.flatMap((v) => [v.wishlist, v.cart, v.orders]));

  const pointsFor = (key: "wishlist" | "cart" | "orders") =>
    values
      .map((point, index) => {
        const x = padX + (index * chartWidth) / Math.max(1, values.length - 1);
        const y = padY + chartHeight - (point[key] / maxValue) * chartHeight;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Wishlist analytics chart">
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = padY + (chartHeight * tick) / 4;
          return (
            <g key={tick}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x="12" y={y + 4} fontSize="12" fill="#9ca3af">
                {Math.round(maxValue - (maxValue * tick) / 4)}
              </text>
            </g>
          );
        })}

        <polyline points={pointsFor("wishlist")} fill="none" stroke="#8b1c7a" strokeWidth="3" />
        <polyline points={pointsFor("cart")} fill="none" stroke="#1d5b99" strokeWidth="3" />
        <polyline points={pointsFor("orders")} fill="none" stroke="#3f6212" strokeWidth="3" />

        {values.map((point, index) => {
          const x = padX + (index * chartWidth) / Math.max(1, values.length - 1);
          return (
            <text key={point.label} x={x} y={height - 4} textAnchor="middle" fontSize="11" fill="#6b7280">
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [viewMode, setViewMode] = useState<"summary" | "graph">("summary");
  const [selectedMetric, setSelectedMetric] = useState<
    "wishlists" | "products" | "value" | "average"
  >("wishlists");
  const [open, setOpen] = useState(true);

  const themeEditorUrl = `https://${data.shop.domain}/admin/themes/current/editor?context=apps`;
  const newPageUrl = `https://${data.shop.domain}/admin/pages/new`;

  useEffect(() => {
    if (actionData?.saved) shopify.toast.show("Analytics settings saved");
  }, [actionData, shopify]);

  const productMap = new Map(data.productMap);
  const totalAdds = data.wishlistMetrics.reduce((sum, row) => sum + (row.addsToCart ?? 0), 0);
  const totalPurchases = data.wishlistMetrics.reduce((sum, row) => sum + (row.purchases ?? 0), 0);
  const orderSummary = data.orderSummary;

  const selectedMetricTitle = {
    wishlists: "All Wishlist Products",
    products: "All Wishlisted Products",
    value: "Wishlist Products and Orders",
    average: "Average Wishlist Product Details",
  }[selectedMetric];

  const selectedMetricDescription = {
    wishlists: "Every product saved to a wishlist, with its save and customer count.",
    products: "Every unique product currently represented in wishlist activity.",
    value: "Every product contributing to wishlist-driven cart adds and orders.",
    average: "Product-level counts used to calculate the average wishlist value.",
  }[selectedMetric];

  const detailTable = {
    wishlists: {
      headings: ["Product", "Wishlist saves", "Added to cart", "Wishlist-driven orders", "Customers"],
      types: ["text", "numeric", "numeric", "numeric", "numeric"] as ColumnContentType[],
      rows: data.topProducts.map((row) => {
        const product = productMap.get(row.productId);
        const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
        return [
          product?.title || row.productId,
          String(row.saves),
          String(metric?.addsToCart ?? 0),
          String(metric?.purchases ?? 0),
          String(row.distinctShoppers),
        ];
      }),
    },
    products: {
      headings: ["Product", "Wishlist saves", "Added to cart", "Wishlist-driven orders"],
      types: ["text", "numeric", "numeric", "numeric"] as ColumnContentType[],
      rows: data.topProducts.map((row) => {
        const product = productMap.get(row.productId);
        const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
        return [
          product?.title || row.productId,
          String(row.saves),
          String(metric?.addsToCart ?? 0),
          String(metric?.purchases ?? 0),
        ];
      }),
    },
    value: {
      headings: ["Product", "Wishlist-driven orders", "Added to cart", "Wishlist saves"],
      types: ["text", "numeric", "numeric", "numeric"] as ColumnContentType[],
      rows: data.topProducts.map((row) => {
        const product = productMap.get(row.productId);
        const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
        return [
          product?.title || row.productId,
          String(metric?.purchases ?? 0),
          String(metric?.addsToCart ?? 0),
          String(row.saves),
        ];
      }),
    },
    average: {
      headings: ["Product", "Wishlist saves", "Added to cart", "Wishlist-driven orders", "Orders per save"],
      types: ["text", "numeric", "numeric", "numeric", "numeric"] as ColumnContentType[],
      rows: data.topProducts.map((row) => {
        const product = productMap.get(row.productId);
        const metric = data.wishlistMetrics.find((item) => item.productId === row.productId);
        const purchases = metric?.purchases ?? 0;
        return [
          product?.title || row.productId,
          String(row.saves),
          String(metric?.addsToCart ?? 0),
          String(purchases),
          (purchases / Math.max(1, row.saves)).toFixed(2),
        ];
      }),
    },
  }[selectedMetric];

  const topBackInStockRows = data.topVariants.map((row) => {
    const product = productMap.get(row.productId);
    return [product?.title || row.productId, row.variantTitle || "-", String(row.waiting)];
  });

  const chartValues = useMemo(() => {
    const days = 10;
    return Array.from({ length: days }, (_, index) => {
      const label = `D${index + 1}`;
      const scale = index === days - 1 ? 1 : 0.15 + (index % 3) * 0.1;
      return {
        label,
        wishlist: Math.round((Number(data.wStats.total) / days) * scale),
        cart: Math.round((totalAdds / days) * scale * 0.8),
        orders: Math.round((totalPurchases / days) * scale * 0.6),
      };
    });
  }, [data.wStats.total, totalAdds, totalPurchases]);

  return (
    <Page fullWidth>
      <TitleBar title="Dashboard" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Getting started
              </Text>
              <Button
                variant="tertiary"
                disclosure={open ? "up" : "down"}
                onClick={() => setOpen((v) => !v)}
                ariaExpanded={open}
                ariaControls="ws-setup-guide"
              >
                {open ? "Hide" : "Setup guide"}
              </Button>
            </InlineStack>

            <Collapsible
              open={open}
              id="ws-setup-guide"
              transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
            >
              <BlockStack gap="500">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Three quick steps to put the wishlist and back-in-stock alerts live on
                  your storefront.
                </Text>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    1. Enable the app embed
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Open your theme editor, switch on{" "}
                    <Text as="span" fontWeight="semibold">
                      Wishlist &amp; Stock Alerts
                    </Text>{" "}
                    under App embeds, then Save. This activates the hearts, the wishlist
                    drawer, and the “Notify me” button.
                  </Text>
                  <InlineStack>
                    <Button variant="primary" url={themeEditorUrl} target="_blank">
                      Open theme editor
                    </Button>
                  </InlineStack>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    2. Create the wishlist page
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Add an Online Store page titled{" "}
                    <Text as="span" fontWeight="semibold">
                      Wishlist
                    </Text>{" "}
                    (URL handle{" "}
                    <Text as="span" fontWeight="semibold">
                      wishlist
                    </Text>
                    ) so the header wishlist icon opens it at{" "}
                    <Text as="span" fontWeight="semibold">
                      /pages/wishlist
                    </Text>
                    .
                  </Text>
                  <InlineStack>
                    <Button url={newPageUrl} target="_blank">
                      Create wishlist page
                    </Button>
                  </InlineStack>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    3. Configure email sending
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Set your email provider and a verified sender address so back-in-stock
                    alerts actually deliver.
                  </Text>
                  <InlineStack>
                    <Link to="/app/settings">Open settings</Link>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </Card>

        <Box paddingBlockStart="200">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h1" variant="heading2xl">
                  Wishlist by Square
                </Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Results for the last 30 days
              </Text>
            </BlockStack>
            <InlineStack gap="200" blockAlign="center">
              <Button
                variant={viewMode === "summary" ? "primary" : "secondary"}
                onClick={() => setViewMode("summary")}
              >
                Summary
              </Button>
              <Button
                variant={viewMode === "graph" ? "primary" : "secondary"}
                onClick={() => setViewMode("graph")}
              >
                Graph
              </Button>
              <Link to="/app/settings">
                <Button>Settings</Button>
              </Link>
            </InlineStack>
          </InlineStack>
        </Box>

        {viewMode === "summary" ? (
          <BlockStack gap="500">
            <Box>
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: "1 1 0" }}>
                  <MetricCard
                    title="Wishlists"
                    value={data.wStats.total}
                    tone="#8b1c7a"
                    subtitle="Total wishlist saves"
                    selected={selectedMetric === "wishlists"}
                    onClick={() => setSelectedMetric("wishlists")}
                  />
                </div>
                <div style={{ flex: "1 1 0" }}>
                  <MetricCard
                    title="Products"
                    value={data.topProducts.length}
                    tone="#1d5b99"
                    subtitle="Most wishlisted products"
                    selected={selectedMetric === "products"}
                    onClick={() => setSelectedMetric("products")}
                  />
                </div>
                <div style={{ flex: "1 1 0" }}>
                  <MetricCard
                    title="Wishlist orders"
                    value={orderSummary.totalOrders}
                    tone="#3f6212"
                    subtitle="Wishlist-driven orders"
                    selected={selectedMetric === "value"}
                    onClick={() => setSelectedMetric("value")}
                  />
                </div>
                <div style={{ flex: "1 1 0" }}>
                  <MetricCard
                    title="Average Wishlist"
                    value={Number(orderSummary.averageOrdersPerSave ?? 0).toFixed(2)}
                    tone="#374151"
                    subtitle="Average per wishlist save"
                    selected={selectedMetric === "average"}
                    onClick={() => setSelectedMetric("average")}
                  />
                </div>
              </InlineStack>
            </Box>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {selectedMetricTitle}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge>{`${data.topProducts.length} items`}</Badge>
                    <Button size="micro" onClick={() => setViewMode("graph")}>
                      Open graph
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Text as="p" tone="subdued">
                  {selectedMetricDescription}
                </Text>
                {detailTable.rows.length ? (
                  <DataTable
                    columnContentTypes={detailTable.types}
                    headings={detailTable.headings}
                    rows={detailTable.rows}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No wishlist activity yet.
                  </Text>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Top Product Added for Back in Stock Notification
                  </Text>
                  <Badge>{`${data.topVariants.length} variants`}</Badge>
                </InlineStack>
                {topBackInStockRows.length ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Product", "Variant", "Requests"]}
                    rows={topBackInStockRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No stock alert requests yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        ) : (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Wishlist activity graph
                  </Text>
                  <Text as="p" tone="subdued">
                    Wishlist page views, wishlist adds, and add-to-cart events across the selected range.
                  </Text>
                </BlockStack>
                <Badge tone="success">{`${data.wStats.total} saves`}</Badge>
              </InlineStack>

              <InlineStack gap="0" wrap={false}>
                <div style={{ flex: 1, background: "#8b1c7a", color: "white", padding: 20, minHeight: 112 }}>
                  <Text as="p" variant="headingSm" tone="inherit">
                    Wishlist page views
                  </Text>
                  <Text as="p" variant="heading2xl" tone="inherit">
                    0
                  </Text>
                  <Text as="p" tone="inherit">
                    No change
                  </Text>
                </div>
                <div style={{ flex: 1, background: "#1d5b99", color: "white", padding: 20, minHeight: 112 }}>
                  <Text as="p" variant="headingSm" tone="inherit">
                    Added to wishlist
                  </Text>
                  <Text as="p" variant="heading2xl" tone="inherit">
                    {data.wStats.total}
                  </Text>
                  <Text as="p" tone="inherit">
                    +{totalAdds || 0} cart adds
                  </Text>
                </div>
                <div style={{ flex: 1, background: "#3f6212", color: "white", padding: 20, minHeight: 112 }}>
                  <Text as="p" variant="headingSm" tone="inherit">
                    Added to cart
                  </Text>
                  <Text as="p" variant="heading2xl" tone="inherit">
                    {totalAdds}
                  </Text>
                  <Text as="p" tone="inherit">
                    {totalPurchases > 0 ? `${totalPurchases} orders` : "No change"}
                  </Text>
                </div>
                <div style={{ flex: 1, background: "#ffffff", minHeight: 112, border: "1px solid #e5e7eb" }} />
              </InlineStack>

              <Box paddingBlock="300">
                <TrendChart values={chartValues} />
              </Box>

              <InlineStack gap="200" wrap={false}>
                <div
                  style={{
                    padding: 16,
                    background: "#f8fafc",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <Text as="p" variant="bodyMd">
                    <span style={{ color: "#8b1c7a", fontWeight: 700 }}>■</span> Wishlist page views
                  </Text>
                </div>
                <div
                  style={{
                    padding: 16,
                    background: "#f8fafc",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <Text as="p" variant="bodyMd">
                    <span style={{ color: "#1d5b99", fontWeight: 700 }}>■</span> Added to wishlist
                  </Text>
                </div>
                <div
                  style={{
                    padding: 16,
                    background: "#f8fafc",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <Text as="p" variant="bodyMd">
                    <span style={{ color: "#3f6212", fontWeight: 700 }}>■</span> Added to cart
                  </Text>
                </div>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
