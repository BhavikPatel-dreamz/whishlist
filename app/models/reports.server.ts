import db from "../db.server";
import { metricsDateRange, shopperValue } from "../lib/analytics-metrics";
import { filterReport, reportTab, type ReportTable } from "../lib/reports";
import { loadAnalyticsMetrics } from "./analytics-metrics.server";
import {
  getProductsByIds,
  getVariantsByIds,
  getCustomerNamesByIds,
  type GraphqlClient,
} from "../lib/shopify-data.server";

export async function loadReport(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
) {
  const range = metricsDateRange(params);
  const dates = {
    gte: new Date(`${range.from}T00:00:00Z`),
    lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + 86400000),
  };
  const tab = reportTab(params);
  const date = (value: Date | null) =>
    value
      ? value.toISOString().replace("T", " ").slice(0, 19) + " UTC"
      : "Not recorded";
  let table: ReportTable;
  if (tab === "shared") {
    table = {
      title: "Shared Wishlists Report",
      description: "View details of wishlists shared by your customers",
      label: "Shared Wishlist Details",
      columns: [
        "User Email",
        "List Name",
        "Sharing Mode",
        "Shared Email",
        "Created Date",
      ],
      rows: [],
      note: "Wishlist sharing and share-event tracking are not implemented in this app. No historical sharing data is available.",
    };
  } else if (tab === "shoppers") {
    const data = await loadAnalyticsMetrics(
      shopId,
      admin,
      new URLSearchParams({ from: range.from, to: range.to }),
    );
    table = {
      title: "Shoppers Report",
      description: "View shoppers who saved the most products",
      label: "Shoppers",
      columns: ["Shopper", "Products", "Saved Variants", "Estimated Value"],
      rows: data.shoppers.map((row) => ({
        id: row.id,
        cells: [row.name, row.products, row.saves, shopperValue(row)],
      })),
      note: "Currently saved items added during the selected dates. Values estimate one unit per product at its current minimum price.",
    };
  } else if (tab === "alerts") {
    const alerts = await db.stockAlert.findMany({
      where: { shopId, notifiedAt: dates },
      orderBy: [{ notifiedAt: "desc" }, { id: "asc" }],
    });
    table = {
      title: "Sent Alert Details Report",
      description: "View details of sent customer alerts",
      label: "Sent Alerts",
      columns: [
        "Product Title",
        "Variant",
        "User Email",
        "Status",
        "Sent Date",
      ],
      rows: alerts.map((row) => ({
        id: row.id,
        cells: [
          row.productTitle || row.productId,
          row.variantTitle || row.variantId,
          row.email,
          row.status,
          date(row.notifiedAt),
        ],
      })),
      note: "Filtered by the recorded notification date (UTC). A sent notification does not confirm delivery or opening.",
    };
  } else if (tab === "purchases") {
    const [orders, conversions] = await Promise.all([
      db.wishlistOrder.findMany({
        where: { shopId, createdAt: dates },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      db.stockAlert.findMany({
        where: { shopId, convertedAt: dates },
        orderBy: [{ convertedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    const products = await getProductsByIds(
      admin,
      [...new Set(orders.map((row) => row.productId))],
      1,
    );
    table = {
      title: "Purchases Report",
      description: "View recorded purchases from wishlists and alerts",
      label: "Purchases",
      columns: [
        "Product Title",
        "Source",
        "Order ID",
        "User Email",
        "Recorded Date",
        "Revenue",
      ],
      rows: [
        ...orders.map((row) => ({
          id: `order-${row.id}`,
          cells: [
            products.get(row.productId)?.title || row.productId,
            "Wishlist",
            row.orderId,
            "Not recorded",
            date(row.createdAt),
            "Not tracked",
          ],
        })),
        ...conversions.map((row) => ({
          id: `alert-${row.id}`,
          cells: [
            row.productTitle || row.productId,
            "Stock alert",
            "Not recorded",
            row.email,
            date(row.convertedAt),
            "Not tracked",
          ],
        })),
      ].sort((a, b) => String(b.cells[4]).localeCompare(String(a.cells[4]))),
      note: "Wishlist rows use the first recorded order-product date, which may differ from checkout. Alert conversions are separate attribution records and may overlap with wishlist purchases. Revenue is not stored.",
    };
  } else {
    const items = await db.wishlistItem.findMany({
      where: { shopId, createdAt: dates },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const variantIds = [
      ...new Set(
        items.flatMap((item) => (item.variantId ? [item.variantId] : [])),
      ),
    ];
    const customerIds = [
      ...new Set(
        items.flatMap((item) => (item.customerId ? [item.customerId] : [])),
      ),
    ];
    const [products, variantChunks, nameChunks, alerts] = await Promise.all([
      getProductsByIds(
        admin,
        [...new Set(items.map((item) => item.productId))],
        1,
      ),
      Promise.all(
        Array.from({ length: Math.ceil(variantIds.length / 100) }, (_, i) =>
          getVariantsByIds(admin, variantIds.slice(i * 100, (i + 1) * 100)),
        ),
      ),
      tab === "activity"
        ? Promise.all(
            Array.from(
              { length: Math.ceil(customerIds.length / 250) },
              (_, i) =>
                getCustomerNamesByIds(
                  admin,
                  customerIds.slice(i * 250, (i + 1) * 250),
                ),
            ),
          )
        : Promise.resolve([]),
      tab === "products"
        ? db.stockAlert.groupBy({
            by: ["productId", "variantId"],
            where: { shopId, notifiedAt: dates },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const variants = new Map(
      variantChunks.flat().map((row) => [row.variantId, row]),
    );
    const names = new Map(nameChunks.flatMap((map) => [...map]));
    if (tab === "activity") {
      table = {
        title: "Wishlist Activity Details",
        description: "View saved products and shopper activity",
        label: "All Shopper Actions",
        imageColumn: true,
        columns: [
          "Product Title",
          "List Name",
          "SKU",
          "Shopper",
          "Created Date",
        ],
        rows: items.map((row) => ({
          id: row.id,
          image:
            variants.get(row.variantId || "")?.imageUrl ||
            products.get(row.productId)?.imageUrl,
          cells: [
            products.get(row.productId)?.title || row.productId,
            "My Wishlist",
            variants.get(row.variantId || "")?.sku || "—",
            row.customerId
              ? names.get(row.customerId) || `Customer ${row.customerId}`
              : "(Anonymous)",
            date(row.createdAt),
          ],
        })),
        note: "Shows currently saved items, not a complete action history. Removed items are not retained. Customer names appear when Shopify access permits; emails are not stored with wishlist saves.",
      };
    } else {
      const groups = new Map<
        string,
        {
          productId: string;
          variantId: string | null;
          saves: number;
          shoppers: Set<string>;
        }
      >();
      const demand = new Map<string, Set<string>>();
      for (const row of items) {
        const key = `${row.productId}:${row.variantId || ""}`;
        const group = groups.get(key) || {
          productId: row.productId,
          variantId: row.variantId,
          saves: 0,
          shoppers: new Set<string>(),
        };
        group.saves++;
        const identity = row.customerId
          ? `customer:${row.customerId}`
          : row.guestToken
            ? `guest:${row.guestToken}`
            : null;
        if (identity) {
          group.shoppers.add(identity);
          const set = demand.get(row.productId) || new Set<string>();
          set.add(identity);
          demand.set(row.productId, set);
        }
        groups.set(key, group);
      }
      const low = params.get("kind") === "running-low";
      const sent = new Map(
        alerts.map((row) => [
          `${row.productId}:${row.variantId}`,
          row._count._all,
        ]),
      );
      table = {
        title: low ? "Running out soon" : "Products",
        description: "View and analyze wishlist engagement for your products",
        label: "Product Variants",
        imageColumn: true,
        columns: [
          "Product Title",
          "SKU",
          "Inventory",
          "Inventory Last Updated",
          "Wishlist Saves",
          "Alerts Sent",
          "Revenue",
        ],
        rows: [...groups]
          .filter(
            ([, row]) =>
              !low ||
              (products.has(row.productId) &&
                products.get(row.productId)!.totalInventory <= 10 &&
                (demand.get(row.productId)?.size || 0) >= 2),
          )
          .sort(
            (a, b) =>
              (demand.get(b[1].productId)?.size || 0) -
                (demand.get(a[1].productId)?.size || 0) ||
              b[1].saves - a[1].saves ||
              a[0].localeCompare(b[0]),
          )
          .map(([id, row]) => {
            const variant = variants.get(row.variantId || "");
            const product = products.get(row.productId);
            return {
              id,
              image: variant?.imageUrl || product?.imageUrl,
              cells: [
                `${product?.title || row.productId}${variant && variant.variantTitle !== "Default Title" ? ` — ${variant.variantTitle}` : ""}`,
                variant?.sku || "—",
                variant?.inventoryQuantity ??
                  (row.variantId
                    ? "Unavailable"
                    : (product?.totalInventory ?? "Unavailable")),
                "Not tracked",
                row.saves,
                sent.get(id) || 0,
                "Not tracked",
              ],
            };
          }),
        note:
          "Saves are currently retained items added during the selected dates; alerts use notification dates. Inventory is current across all locations. Revenue and inventory-change timestamps are not tracked." +
          (low
            ? " Low-stock filter: at least 2 distinct shoppers and product stock of 10 or fewer."
            : ""),
      };
    }
  }
  const rows = filterReport(table.rows, params);
  return { ...range, tab, table: { ...table, rows } };
}
