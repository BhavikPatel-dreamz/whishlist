import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Box,
  Button,
  Collapsible,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { stockAlertStats, topRequestedVariants, customerEmailsByCustomerIds } from "../models/stock-alert.server";
import { wishlistStats, topWishlistedProducts, metricsForProducts } from "../models/wishlist.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);

  const [wStats, sStats, topProducts, topVariants, wishlistCustomers] = await Promise.all([
    wishlistStats(shop.id),
    stockAlertStats(shop.id),
    topWishlistedProducts(shop.id, 5),
    topRequestedVariants(shop.id, 5),
    (async () => {
      const rows = await db.wishlistItem.findMany({
        where: { shopId: shop.id, customerId: { not: null } },
        select: { customerId: true },
        distinct: ["customerId"],
        take: 20,
      });
      const customerIds = rows.map((row) => row.customerId).filter(Boolean) as string[];
      if (!customerIds.length) return [];
      const emails = await customerEmailsByCustomerIds(shop.id, customerIds);
      return customerIds.map((customerId) => ({
        id: customerId,
        email: emails.get(customerId) ?? null,
      }));
    })(),
  ]);

  // Fetch metrics (addsToCart/purchases) for the top products
  const productIds = topProducts.map((p) => p.productId);
  const metrics = await metricsForProducts(shop.id, productIds);

  return { wStats, sStats, topProducts, topVariants, wishlistCustomers, metrics, shop: session.shop };
};

function SetupGuide({ shop, hasActivity }: { shop: string; hasActivity: boolean }) {
  // Fresh stores (no wishlist items, no alerts) see the guide expanded; once there's
  // activity the store is presumed set up, so it collapses behind a disclosure button.
  const [open, setOpen] = useState(!hasActivity);
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps`;
  const newPageUrl = `https://${shop}/admin/pages/new`;
  

  return (
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
                <Button variant="primary" url={themeEditorUrl} target="_blank" external>
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
                <Button url={newPageUrl} target="_blank" external>
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
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        <Text as="p" variant="heading2xl">
          {String(value)}
        </Text>
        {subtitle && (
          <Text as="p" variant="bodyMd" tone="subdued">
            {subtitle}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Dashboard() {
  const { wStats, sStats, topProducts, topVariants, wishlistCustomers, metrics, shop } =
    useLoaderData<typeof loader>();

  const hasActivity = wStats.total > 0 || sStats.total > 0;

  const productRows = topProducts.map((p) => {
    const m = metrics.find((mm) => mm.productId === p.productId);
    return [p.productId, String(p.saves), String(p.distinctShoppers), String(m?.addsToCart ?? 0), String(m?.purchases ?? 0)];
  });

  const variantRows = topVariants.map((v) => [
    v.productTitle || v.productId,
    v.variantTitle || "-",
    String(v.waiting),
  ]);

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="500">
        <SetupGuide shop={shop} hasActivity={hasActivity} />

        <Layout>
          <Layout.Section>
            <InlineStack gap="400" wrap={false}>
              <Box width="33%">
                <StatCard
                  title="Wishlist Items"
                  value={wStats.total}
                  subtitle={`${wStats.last30} added in last 30 days`}
                />
              </Box>
              <Box width="33%">
                <StatCard
                  title="Stock Alerts"
                  value={sStats.total}
                  subtitle={`${sStats.pending} pending, ${sStats.confirmed} confirmed`}
                />
              </Box>
              <Box width="33%">
                <StatCard
                  title="Conversions"
                  value={`${sStats.conversionRate}%`}
                  subtitle={`${sStats.converted} of ${sStats.sent} sent`}
                />
              </Box>
            </InlineStack>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Most Wishlisted Products
                  </Text>
                  <Badge>{`${String(wStats.shoppers)} unique shoppers`}</Badge>
                </InlineStack>
                {productRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                    headings={["Product ID", "Saves", "Shoppers", "Adds", "Purchases"]}
                    rows={productRows}
                  />
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No wishlist data yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Top Waitlisted Variants
                  </Text>
                  <Badge>{`${String(sStats.pending)} waiting`}</Badge>
                </InlineStack>
                {variantRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Product", "Variant", "Waiting"]}
                    rows={variantRows}
                  />
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No pending alerts.
                  </Text>
                )}
                <Box paddingBlockStart="200">
                  <Link to="/app/alerts">
                    View all stock alerts
                  </Link>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {wishlistCustomers.length > 0 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Wishlist Shoppers (logged-in)
                  </Text>
                  <InlineStack gap="200" wrap>
                    {wishlistCustomers.map((customer) => (
                      <Badge key={customer.id} tone="info">
                        {customer.email ?? `Customer ${customer.id}`}
                      </Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Quick Stats
                </Text>
                <InlineStack gap="600">
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Alerts sent (all time)
                    </Text>
                    <Text as="span" variant="headingMd">
                      {sStats.sent}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Failed
                    </Text>
                    <Text as="span" variant="headingMd">
                      {sStats.failed}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Cancelled
                    </Text>
                    <Text as="span" variant="headingMd">
                      {sStats.cancelled}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" tone="subdued">
                      Last 30 days (alerts)
                    </Text>
                    <Text as="span" variant="headingMd">
                      {sStats.last30}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
