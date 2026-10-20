import type { Prisma } from "@prisma/client";
import db from "../db.server";
import {
  loadOutOfStockProducts,
  loadStockProducts,
} from "./out-of-stock.server";
import { metricsDateBounds, metricsDateRange, shopperValue } from "../lib/analytics-metrics";
import { filterReport, reportTab, type ReportTable } from "../lib/reports";
import { loadAnalyticsMetrics } from "./analytics-metrics.server";
import {
  getProductsByIds,
  getVariantsByIds,
  getCustomerNamesByIds,
  type GraphqlClient,
} from "../lib/shopify-data.server";

export async function loadReportsOverview(
  shopId: string,
  params: URLSearchParams,
) {
  const range = metricsDateRange(params);
  const { gte: start, lt: end } = metricsDateBounds(range);
  const alertDate = { gte: start, lt: end };
  const [
    subscribedAlerts,
    alertSubscribers,
    requestedProducts,
    pendingAlerts,
    sentAlerts,
    clickThroughs,
    sentProducts,
    wishlistOrders,
    stockAlertPurchases,
  ] = await Promise.all([
    db.stockAlert.count({ where: { shopId, createdAt: alertDate } }),
    db.stockAlert.findMany({
      where: { shopId, createdAt: alertDate },
      select: { contactKey: true },
      distinct: ["contactKey"],
    }),
    db.stockAlert.groupBy({
      by: ["productId"],
      where: { shopId, createdAt: alertDate },
    }),
    db.stockAlert.count({
      where: { shopId, status: "PENDING", createdAt: alertDate },
    }),
    db.stockAlert.count({ where: { shopId, notifiedAt: alertDate } }),
    db.stockAlert.count({ where: { shopId, convertedAt: alertDate } }),
    db.stockAlert.groupBy({
      by: ["productId"],
      where: { shopId, notifiedAt: alertDate },
    }),
    db.wishlistOrder.findMany({
      where: { shopId, createdAt: alertDate },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
    db.stockAlert.count({ where: { shopId, purchasedAt: alertDate } }),
  ]);
  return {
    ...range,
    subscribedAlerts,
    alertSubscribers: alertSubscribers.length,
    requestedProducts: requestedProducts.length,
    pendingAlerts,
    sentAlerts,
    clickThroughs,
    sentProducts: sentProducts.length,
    wishlistOrders: wishlistOrders.length,
    stockAlertPurchases,
  };
}

export async function loadReport(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
) {
  const range = metricsDateRange(params);
  const dates = metricsDateBounds(range);
  const tab = reportTab(params);
  const date = (value: Date | null) =>
    value
      ? value.toISOString().replace("T", " ").slice(0, 19) + " UTC"
      : "Not recorded";
  let table: ReportTable;
  let overview: Awaited<ReturnType<typeof loadReportsOverview>> | undefined;
  let inventory:
    | { tracked: number; inStock: number; lowStock: number; outOfStock: number }
    | undefined;
  if (tab === "overview") {
    overview = await loadReportsOverview(shopId, params);
    table = {
      title: "Overview",
      description: "Alert and conversion metrics for the selected dates",
      label: "",
      columns: [],
      rows: [],
      note: "",
    };
  } else if (tab === "stock") {
    const products = await loadStockProducts(admin);
    const stock = [...products.values()].map(
      (product) => product.totalInventory,
    );
    inventory = {
      tracked: stock.length,
      inStock: stock.filter((quantity) => quantity > 10).length,
      lowStock: stock.filter((quantity) => quantity > 0 && quantity <= 10)
        .length,
      outOfStock: stock.filter((quantity) => quantity <= 0).length,
    };
    const kind = params.get("kind");
    const statusFilter =
      kind === "in-stock"
        ? { title: "In Stock Products", match: (q: number) => q > 10 }
        : kind === "low-stock"
          ? {
              title: "Low Stock Products",
              match: (q: number) => q > 0 && q <= 10,
            }
          : kind === "out-of-stock"
            ? {
                title: "Out of Stock Products",
                match: (q: number) => q <= 0,
              }
            : { title: "Stock List", match: () => true };
    table = {
      title: statusFilter.title,
      description: "Current inventory for active, inventory-tracked products",
      label: "Products",
      imageColumn: true,
      columns: ["Product Title", "Inventory", "Stock Status"],
      rows: [...products]
        .filter(([, product]) => statusFilter.match(product.totalInventory))
        .map(([id, product]) => ({
          id,
          image: product.imageUrl,
          cells: [
            product.title,
            product.totalInventory,
            product.totalInventory <= 0
              ? "Out of stock"
              : product.totalInventory <= 10
                ? "Low stock"
                : "In stock",
          ],
        })),
      note:
        "Current inventory across all locations. This list is independent of wishlist saves and the selected date range." +
        (kind ? " Filtered by stock status." : ""),
    };
  } else if (tab === "products" && params.get("kind") === "running-low") {
    const products = await loadOutOfStockProducts(admin);
    table = {
      title: "Running out soon",
      description: "Currently out-of-stock products in your store",
      label: "Products",
      imageColumn: true,
      columns: ["Product Title", "Inventory", "Status"],
      rows: [...products].map(([id, product]) => ({
        id,
        image: product.imageUrl,
        cells: [product.title, product.totalInventory, "Out of stock"],
      })),
      note: "Current inventory across all locations for active, inventory-tracked products with zero or fewer units. Independent of wishlist saves and selected dates.",
    };
  } else if (tab === "shared") {
    const shares = await db.wishlistShare.findMany({
      where: { shopId, createdAt: dates },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const snapshots = shares.map((share) =>
      Array.isArray(share.products)
        ? (share.products as { productId: string; handle: string | null }[])
        : [],
    );
    const ids = [
      ...new Set(
        snapshots.flatMap((items) => items.map((item) => item.productId)),
      ),
    ];
    const customerIds = [...new Set(shares.map((share) => share.customerId))];
    const [products, customerNameChunks] = await Promise.all([
      ids.length ? getProductsByIds(admin, ids, 1) : Promise.resolve(new Map()),
      Promise.all(
        Array.from(
          { length: Math.ceil(customerIds.length / 250) },
          (_, index) =>
            getCustomerNamesByIds(
              admin,
              customerIds.slice(index * 250, (index + 1) * 250),
            ),
        ),
      ),
    ]);
    const customerNames = new Map(
      customerNameChunks.flatMap((chunk) => [...chunk]),
    );
    table = {
      title: "Shared Wishlists Report",
      description: "View products in wishlists shared by your customers",
      label: "Shared Wishlist Details",
      columns: ["Customer", "List Name", "Products", "Created Date"],
      rows: shares.map((share, index) => ({
        id: share.id,
        cells: [
          customerNames.get(share.customerId) || `Customer ${share.customerId}`,
          "My Wishlist",
          snapshots[index]
            .map(
              (item) =>
                products.get(item.productId)?.title ||
                item.handle ||
                `Product ${item.productId}`,
            )
            .join(", ") || "Empty wishlist",
          date(share.createdAt),
        ],
      })),
      note: "Products are captured when a link is copied or a social sharing window is opened. Opening a social window does not confirm a published post. Tracking starts with this feature; earlier shares are not available.",
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
    const kind = params.get("kind") || "sent";
    if (kind === "subscribers") {
      const groups = await db.stockAlert.groupBy({
        by: ["contactKey"],
        where: { shopId, createdAt: dates },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      });
      groups.sort(
        (a, b) =>
          (b._max.createdAt?.getTime() || 0) -
          (a._max.createdAt?.getTime() || 0),
      );
      table = {
        title: "Alert Subscribers",
        description:
          "View shoppers who requested stock alerts in the selected dates",
        label: "Subscribers",
        columns: [
          "Subscriber",
          "Alerts Requested",
          "First Request",
          "Last Request",
        ],
        rows: groups.map((row, index) => ({
          id: `subscriber-${index}-${row.contactKey}`,
          cells: [
            row.contactKey.replace(/^(email|sms):/, ""),
            row._count._all,
            date(row._min.createdAt),
            date(row._max.createdAt),
          ],
        })),
        note: "One row per distinct email address or phone number with at least one alert requested in the selected dates (UTC).",
      };
    } else if (kind === "requested-products" || kind === "sent-products") {
      const isSent = kind === "sent-products";
      const where: Prisma.StockAlertWhereInput = isSent
        ? { shopId, notifiedAt: dates }
        : { shopId, createdAt: dates };
      const [groups, titles] = await Promise.all([
        db.stockAlert.groupBy({
          by: ["productId"],
          where,
          _count: { _all: true },
          _min: { createdAt: true, notifiedAt: true },
          _max: { createdAt: true, notifiedAt: true },
        }),
        db.stockAlert.findMany({
          where,
          select: { productId: true, productTitle: true },
          distinct: ["productId"],
        }),
      ]);
      const titleMap = new Map(
        titles.map((row) => [row.productId, row.productTitle]),
      );
      groups.sort(
        (a, b) =>
          ((isSent ? b._max.notifiedAt : b._max.createdAt)?.getTime() || 0) -
          ((isSent ? a._max.notifiedAt : a._max.createdAt)?.getTime() || 0),
      );
      table = {
        title: isSent
          ? "Products for which alerts were sent"
          : "Alert Requested Products",
        description: isSent
          ? "View products for which stock alerts were sent in the selected dates"
          : "View products for which stock alerts were requested in the selected dates",
        label: isSent ? "Alerted Products" : "Requested Products",
        columns: [
          "Product Title",
          isSent ? "Alerts Sent" : "Alerts Requested",
          isSent ? "First Sent" : "First Request",
          isSent ? "Last Sent" : "Last Request",
        ],
        rows: groups.map((row) => ({
          id: row.productId,
          cells: [
            titleMap.get(row.productId) || row.productId,
            row._count._all,
            date(isSent ? row._min.notifiedAt : row._min.createdAt),
            date(isSent ? row._max.notifiedAt : row._max.createdAt),
          ],
        })),
        note: isSent
          ? "One row per distinct product with at least one alert notified during the selected dates (UTC)."
          : "One row per distinct product with at least one alert requested during the selected dates (UTC).",
      };
    } else {
      const sent = kind === "sent";
      const converted = kind === "clickthroughs";
      const pending = kind === "pending";
      const all = kind === "all";
      const where: Prisma.StockAlertWhereInput = pending
        ? { shopId, status: "PENDING", createdAt: dates }
        : all
          ? { shopId, createdAt: dates }
          : converted
            ? { shopId, convertedAt: dates }
            : { shopId, notifiedAt: dates };
      const alerts = await db.stockAlert.findMany({
        where,
        orderBy: converted
          ? [{ convertedAt: "desc" }, { id: "asc" }]
          : sent
            ? [{ notifiedAt: "desc" }, { id: "asc" }]
            : [{ createdAt: "desc" }, { id: "asc" }],
      });
      table = {
        title: pending
          ? "Pending Alerts"
          : all
            ? "Subscribed Alerts"
            : converted
              ? "Alert Click-throughs"
              : "Sent Alert Details Report",
        description: pending
          ? "View stock alerts that are still awaiting notification"
          : all
            ? "View stock alert subscriptions requested by shoppers"
            : converted
              ? "View alerts whose recipients clicked back to the store"
              : "View details of sent customer alerts",
        label: pending
          ? "Pending Alerts"
          : all
            ? "Subscribed Alerts"
            : converted
              ? "Click-throughs"
              : "Sent Alerts",
        columns: [
          "Product Title",
          "Variant",
          "Contact",
          "Status",
          converted
            ? "Click-through Date"
            : sent
              ? "Sent Date"
              : "Requested Date",
        ],
        rows: alerts.map((row) => ({
          id: row.id,
          cells: [
            row.productTitle || row.productId,
            row.variantTitle || row.variantId,
            row.email || row.phone || "Unknown contact",
            row.status,
            date(
              converted
                ? row.convertedAt
                : sent
                  ? row.notifiedAt
                  : row.createdAt,
            ),
          ],
        })),
        note: pending
          ? "Alerts requested during the selected dates that have not been notified yet (UTC)."
          : all
            ? "Alerts requested during the selected dates (UTC), regardless of whether they have been sent."
            : converted
              ? "Filtered by the recorded click-through date (UTC). A click-through is an alert recipient recorded as returning to the product or cart."
              : "Filtered by the recorded notification date (UTC). A sent notification does not confirm delivery or opening.",
      };
    }
  } else if (tab === "purchases" && params.get("kind") === "wishlist-orders") {
    const orders = await db.wishlistOrder.findMany({
      where: { shopId, createdAt: dates },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const products = await getProductsByIds(
      admin,
      [...new Set(orders.map((row) => row.productId))],
      1,
    );
    const byOrder = new Map<
      string,
      { productIds: string[]; createdAt: Date }
    >();
    for (const row of orders) {
      const group = byOrder.get(row.orderId);
      if (group) {
        group.productIds.push(row.productId);
        if (row.createdAt < group.createdAt) group.createdAt = row.createdAt;
      } else {
        byOrder.set(row.orderId, {
          productIds: [row.productId],
          createdAt: row.createdAt,
        });
      }
    }
    table = {
      title: "Wishlist-attributed Orders",
      description: "View orders attributed to products saved in wishlists",
      label: "Orders",
      columns: ["Order ID", "Products", "Recorded Date"],
      rows: [...byOrder].map(([orderId, group]) => ({
        id: `order-${orderId}`,
        cells: [
          orderId,
          group.productIds
            .map((productId) => products.get(productId)?.title || productId)
            .join(", "),
          date(group.createdAt),
        ],
      })),
      note: "One row per distinct order containing at least one product saved in a wishlist, using the earliest recorded order-product date (UTC).",
    };
  } else if (tab === "purchases") {
    const [orders, conversions] = await Promise.all([
      db.wishlistOrder.findMany({
        where: { shopId, createdAt: dates },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      db.stockAlert.findMany({
        where: { shopId, purchasedAt: dates },
        orderBy: [{ purchasedAt: "desc" }, { id: "asc" }],
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
        "Contact",
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
            row.purchaseOrderId || "Not recorded",
            row.email || row.phone || "Unknown contact",
            date(row.purchasedAt),
            row.purchaseRevenue != null
              ? `${row.purchaseCurrency || ""} ${row.purchaseRevenue.toFixed(2)}`.trim()
              : "Not tracked",
          ],
        })),
      ].sort((a, b) => String(b.cells[4]).localeCompare(String(a.cells[4]))),
      note: "Stock-alert purchases are matched from the signed alert property on a paid order. Revenue is the attributed line-item total after its line discount; wishlist-attributed revenue is not tracked.",
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
  return { ...range, tab, table: { ...table, rows }, inventory, overview };
}
