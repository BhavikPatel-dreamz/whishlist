import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigation, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  IndexTable,
  TextField,
  Select,
  Button,
  Pagination,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { listStockAlerts } from "../models/stock-alert.server";
import { getShopContext } from "../lib/shopify-data.server";
import { retryStuckAlerts } from "../lib/notifications/dispatch.server";
import { useState, useEffect, type ReactNode } from "react";

/**
 * Renders children only after the component has mounted on the client. Used to keep
 * Polaris components that rely on useLayoutEffect (e.g. IndexTable) out of the server
 * render, which silences the React "useLayoutEffect does nothing on the server" warning
 * and avoids hydration mismatches. Falls back to `fallback` during SSR / first paint.
 */
function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : <>{fallback}</>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") || undefined;
  const query = url.searchParams.get("q") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  const data = await listStockAlerts(shop.id, { status, query, page, pageSize: 25 });

  return {
    ...data,
    filters: { status: status || "ALL", query: query || "", page },
  };
};

/**
 * "Retry failed & stuck" button. Re-drives alerts that never got emailed — sends stranded by a
 * crash, alerts left PENDING after a failed attempt, and FAILED rows (a merchant clicking here is
 * a deliberate choice to retry even previously-exhausted addresses). Only variants that are back
 * in stock actually send, so this is safe to click at any time.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const shopContext = await getShopContext(admin);
  const result = await retryStuckAlerts({ shop, admin, shopContext, includeFailed: true });
  return { ok: true as const, result };
};

const STATUS_OPTIONS = [
  { label: "All statuses", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Sending", value: "SENDING" },
  { label: "Sent", value: "SENT" },
  { label: "Failed", value: "FAILED" },
  { label: "Cancelled", value: "CANCELLED" },
];

export default function Alerts() {
  const { rows, total, page, pageCount, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const retryFetcher = useFetcher<typeof action>();
  const [searchValue, setSearchValue] = useState(filters.query);

  const isLoading = navigation.state === "loading";
  const isRetrying = retryFetcher.state !== "idle";
  const retry = retryFetcher.data?.ok ? retryFetcher.data.result : null;

  const badgeTone = (status: string) => {
    const map: Record<string, "info" | "success" | "warning" | "critical" | "attention"> = {
      PENDING: "info", CONFIRMED: "info", SENDING: "warning", SENT: "success",
      FAILED: "critical", CANCELLED: "attention",
    };
    return map[status] || "info";
  };

  function handleFilterChange(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value && value !== "ALL") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== "page") params.delete("page");
    setSearchParams(params);
  }

  function handleSearch() {
    handleFilterChange("q", searchValue);
  }

  const resourceName = { singular: "alert", plural: "alerts" };

  const rowMarkup = rows.map((row, index) => (
    <IndexTable.Row key={row.id} id={row.id} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {row.email}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {row.productTitle || row.productId}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {row.variantTitle || "-"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={badgeTone(row.status)}>{row.status}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span" tone="subdued">
          {new Date(row.createdAt).toLocaleDateString()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {row.attempts}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page fullWidth>
      <TitleBar title="Stock Alerts">
        <button
          variant="primary"
          onClick={() => {
            window.location.href = `/app/alerts/export${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
          }}
        >
          Export CSV
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                {retry && (
                  <Banner tone={retry.failed > 0 ? "warning" : "success"} title="Retry complete">
                    <p>
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
                  </Banner>
                )}
                <InlineStack gap="300" align="space-between">
                  <InlineStack gap="300">
                    <TextField
                      placeholder="Search by email or product..."
                      value={searchValue}
                      onChange={setSearchValue}
                      autoComplete="off"
                      label=""
                    />
                    <Button onClick={handleSearch}>Search</Button>
                  </InlineStack>
                  <InlineStack gap="300" blockAlign="center">
                    <retryFetcher.Form method="post">
                      <Button submit loading={isRetrying}>
                        Retry failed &amp; stuck
                      </Button>
                    </retryFetcher.Form>
                    <Select
                      label=""
                      options={STATUS_OPTIONS}
                      value={filters.status}
                      onChange={(value) => handleFilterChange("status", value)}
                    />
                  </InlineStack>
                </InlineStack>

                <ClientOnly fallback={<Box minHeight="20vh" />}>
                  <IndexTable
                    resourceName={resourceName}
                    itemCount={rows.length}
                    selectedItemsCount={0}
                    headings={[
                      { title: "Email" },
                      { title: "Product" },
                      { title: "Variant" },
                      { title: "Status" },
                      { title: "Created" },
                      { title: "Attempts" },
                    ]}
                    loading={isLoading}
                    emptyState={
                      <Text as="p" variant="bodyMd" alignment="center">
                        No alerts found.
                      </Text>
                    }
                  >
                    {rowMarkup}
                  </IndexTable>
                </ClientOnly>

                {pageCount > 1 && (
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      onPrevious={() => handleFilterChange("page", String(page - 1))}
                      hasNext={page < pageCount}
                      onNext={() => handleFilterChange("page", String(page + 1))}
                    />
                    <Box paddingInlineStart="200">
                      <Text variant="bodyMd" as="span" tone="subdued">
                        Page {page} of {pageCount} ({total} total)
                      </Text>
                    </Box>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
