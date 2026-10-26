import type { Prisma } from "@prisma/client";
import db from "../db.server";
import {
  loadInventoryVariants,
  loadOutOfStockVariants,
} from "./out-of-stock.server";
import {
  metricsDateBounds,
  metricsDateRange,
  shopperValue,
} from "../lib/analytics-metrics";
import { filterReport, reportTab, type ReportTable } from "../lib/reports";
import { readRequestFilters } from "../lib/back-in-stock-requests";
import {
  listBackInStockRequests,
  listRequestedProductOptions,
} from "./stock-alert.server";
import { loadAnalyticsMetrics } from "./analytics-metrics.server";
import {
  wishlistDrivenOrderCount,
  wishlistProductCount,
  wishlistStats,
} from "./wishlist.server";
import {
  getProductsByIds,
  getVariantsByIds,
  getCustomerNamesByIds,
  type GraphqlClient,
  type ProductSummary,
} from "../lib/shopify-data.server";

export async function loadReportsOverview(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
) {
  const range = metricsDateRange(params);
  const { gte: start, lt: end } = metricsDateBounds(range);
  const alertDate = { gte: start, lt: end };
  const [
    subscribedAlerts,
    subscriberGroups,
    requestedProducts,
    pendingAlerts,
    sentAlerts,
    clickThroughs,
    sentProducts,
    wishlistOrders,
    stockAlertPurchases,
  ] = await Promise.all([
    db.stockAlert.count({ where: { shopId, createdAt: alertDate } }),
    db.stockAlert.groupBy({
      by: ["contactKey"],
      where: { shopId, createdAt: alertDate },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.stockAlert.groupBy({
      by: ["productId"],
      where: { shopId, createdAt: alertDate },
      _count: { _all: true },
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
  const popularRequestedProducts = [...requestedProducts]
    .sort(
      (a, b) =>
        b._count._all - a._count._all || a.productId.localeCompare(b.productId),
    )
    .slice(0, 20);
  const productIds = popularRequestedProducts.map(
    (product) => product.productId,
  );
  const [productTitles, productDetails] = await Promise.all([
    productIds.length
      ? db.stockAlert.findMany({
          where: {
            shopId,
            createdAt: alertDate,
            productId: { in: productIds },
          },
          select: { productId: true, productTitle: true },
          distinct: ["productId"],
        })
      : Promise.resolve([]),
    getProductsByIds(admin, productIds, 1),
  ]);
  const cachedTitles = new Map(
    productTitles.map((product) => [product.productId, product.productTitle]),
  );
  // Shopper-facing list: who asked for an alert, and how many times.
  const alertCustomers = [...subscriberGroups]
    .sort(
      (a, b) =>
        b._count._all - a._count._all ||
        (b._max.createdAt?.getTime() || 0) - (a._max.createdAt?.getTime() || 0),
    )
    .slice(0, 20)
    .map((group) => ({
      contact: group.contactKey.replace(/^(email|sms):/, ""),
      channel: group.contactKey.startsWith("sms:") ? "sms" : "email",
      requests: group._count._all,
      lastRequestedAt: group._max.createdAt
        ? group._max.createdAt.toISOString()
        : null,
    }));
  return {
    ...range,
    subscribedAlerts,
    alertSubscribers: subscriberGroups.length,
    alertCustomers,
    requestedProducts: requestedProducts.length,
    pendingAlerts,
    sentAlerts,
    clickThroughs,
    sentProducts: sentProducts.length,
    wishlistOrders: wishlistOrders.length,
    stockAlertPurchases,
    popularRequestedProducts: popularRequestedProducts.map((product) => {
      const details = productDetails.get(product.productId);
      return {
        productId: product.productId,
        title:
          details?.title ||
          cachedTitles.get(product.productId) ||
          `Unavailable product (${product.productId})`,
        imageUrl: details?.imageUrl || null,
        alerts: product._count._all,
      };
    }),
  };
}

/**
 * Back-in-Stock Requests shown inside the Stock List report: one row per customer with
 * the specific products they asked to be notified about. The request filters use their own
 * query-string keys so they never clash with the report toolbar; the date range is shared
 * with the rest of the page.
 */
export async function loadBackInStockRequests(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
  range: { from: string; to: string },
  options: { page?: number; pageSize?: number } = {},
) {
  const filters = readRequestFilters(params);
  const fetchPage = (page: number) =>
    listBackInStockRequests(shopId, {
      status: filters.status,
      channel: filters.channel,
      query: filters.query,
      productId: filters.productId,
      outcome: filters.outcome,
      from: range.from,
      to: range.to,
      sort: filters.sort,
      page,
      pageSize: options.pageSize ?? 10,
    });

  const [productOptions, requests] = await Promise.all([
    listRequestedProductOptions(shopId),
    fetchPage(options.page ?? filters.page),
  ]);

  // A stale page number (e.g. the filters narrowed the result set) would render an empty
  // table with no way back — fall back to the last page that still has rows.
  const finalRequests =
    !requests.rows.length && requests.page > requests.pageCount
      ? await fetchPage(requests.pageCount)
      : requests;

  const requestProductIds = [
    ...new Set(
      finalRequests.rows.flatMap((row) =>
        row.products.map((product) => product.productId),
      ),
    ),
  ];
  const [customerNames, requestProducts] = await Promise.all([
    getCustomerNamesByIds(
      admin,
      finalRequests.rows
        .map((row) => row.customerId)
        .filter((id): id is string => Boolean(id)),
    ),
    // Product images are a nice-to-have — a failed lookup must not break the report.
    getProductsByIds(admin, requestProductIds, 50).catch(
      () => new Map<string, ProductSummary>(),
    ),
  ]);

  return {
    ...finalRequests,
    rows: finalRequests.rows.map((row) => ({
      ...row,
      products: row.products.map((product) => {
        const details = requestProducts.get(product.productId);
        const variant = details?.variants.find(
          (item) => item.variantId === product.variantId,
        );
        return {
          ...product,
          imageUrl: variant?.imageUrl || details?.imageUrl || null,
        };
      }),
    })),
    productOptions,
    customerNames: Object.fromEntries(customerNames),
    filters: {
      status: filters.status,
      channel: filters.channel,
      productId: filters.productId,
      outcome: filters.outcome,
      query: filters.query,
      sort: filters.sort,
    },
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
  // All-time summary counts shown on Overview and Wishlist reports.
  const wishlistSummary = [
    "overview",
    "products",
    "activity",
    "shared",
    "wishlist-orders",
    "shoppers",
  ].includes(tab)
    ? await (async () => {
        const [stats, productCount, orders] = await Promise.all([
          wishlistStats(shopId),
          wishlistProductCount(shopId),
          wishlistDrivenOrderCount(shopId),
        ]);
        return {
          totalSaves: stats.total,
          productCount,
          orders,
        };
      })()
    : undefined;
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
    overview = await loadReportsOverview(shopId, admin, params);
    table = {
      title: "Overview",
      description: "Alert and conversion metrics for the selected dates",
      label: "",
      columns: [],
      rows: [],
      note: "",
    };
  } else if (tab === "stock") {
    const variants = await loadInventoryVariants(admin);
    const stock = variants.map((variant) => variant.inventory);
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
        ? { title: "In Stock Variants", match: (q: number) => q > 10 }
        : kind === "low-stock"
          ? {
              title: "Low Stock Variants",
              match: (q: number) => q > 0 && q <= 10,
            }
          : kind === "out-of-stock"
            ? {
                title: "Out of Stock Variants",
                match: (q: number) => q <= 0,
              }
            : { title: "Stock List", match: () => true };
    table = {
      title: statusFilter.title,
      description:
        "Current inventory for active, inventory-tracked product variants",
      label: "Variants",
      imageColumn: true,
      columns: ["Product Title", "Variant", "Inventory", "Stock Status"],
      rows: variants
        .filter((variant) => statusFilter.match(variant.inventory))
        .map((variant) => ({
          id: variant.variantId,
          image: variant.imageUrl,
          cells: [
            variant.productTitle,
            variant.variantTitle,
            variant.inventory,
            variant.inventory <= 0
              ? "Out of stock"
              : variant.inventory <= 10
                ? "Low stock"
                : "In stock",
          ],
        })),
      note:
        "Current inventory across all locations, one row per product variant — a product with one sold out variant is listed separately from its in-stock variants." +
        (kind ? " Filtered by stock status." : ""),
    };
  } else if (tab === "products" && params.get("kind") === "running-low") {
    const variants = await loadOutOfStockVariants(admin);
    table = {
      title: "Running out soon",
      description: "Variants that are currently out of stock in your store",
      label: "Variants",
      imageColumn: true,
      columns: ["Product Title", "Variant", "Inventory", "Status"],
      rows: variants.map((variant) => ({
        id: variant.variantId,
        image: variant.imageUrl,
        cells: [
          variant.productTitle,
          variant.variantTitle,
          variant.inventory,
          "Out of stock",
        ],
      })),
      note: "Current inventory across all locations for active, inventory-tracked products, listed variant by variant — a product with one sold out variant shows up here even when its other variants are still in stock. Independent of wishlist saves and selected dates.",
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
  } else if (
    tab === "wishlist-orders" ||
    (tab === "purchases" && params.get("kind") === "wishlist-orders")
  ) {
    const allTimeOrders = params.get("kind") === "all-time-orders";
    const orders = await db.wishlistOrder.findMany({
      where: allTimeOrders ? { shopId } : { shopId, createdAt: dates },
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
      title: allTimeOrders
        ? "All-time Wishlist-attributed Orders"
        : "Wishlist-attributed Orders",
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
      note: allTimeOrders
        ? "One row per distinct order containing at least one product saved in a wishlist, across all dates."
        : "One row per distinct order containing at least one product saved in a wishlist, using the earliest recorded order-product date (UTC).",
    };
  } else if (tab === "purchases") {
    const stockAlertOnly = params.get("kind") === "stock-alert";
    const [orders, conversions] = await Promise.all([
      stockAlertOnly
        ? Promise.resolve([])
        : db.wishlistOrder.findMany({
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
      title: stockAlertOnly ? "Back-in-stock Purchases" : "Purchases Report",
      description: stockAlertOnly
        ? "Purchases attributed to a clicked back-in-stock alert"
        : "View recorded purchases from wishlists and alerts",
      label: stockAlertOnly ? "Stock Alert Purchases" : "Purchases",
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
      note: stockAlertOnly
        ? "Counted when a paid order includes the signed alert token from the back-in-stock email. Wishlist-attributed orders are not included. Revenue uses the attributed line-item total after its line discount."
        : "Stock-alert purchases are matched from the signed alert property on a paid order. Revenue is the attributed line-item total after its line discount; wishlist-attributed revenue is not tracked.",
    };
  } else {
    const allTimeProducts =
      tab === "products" &&
      (params.get("kind") === "all-time-products" || !params.get("kind"));
    const allTimeSaves =
      tab === "products" && params.get("kind") === "all-time-saves";
    const items = await db.wishlistItem.findMany({
      where:
        allTimeSaves || allTimeProducts
          ? { shopId }
          : { shopId, createdAt: dates },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    // Removal history so the all-time products report can list products that
    // were wishlisted in the past even after the saved row was deleted.
    const removals = allTimeProducts
      ? await db.wishlistEvent.findMany({
          where: { shopId, type: "remove" },
          select: { productId: true, customerId: true, guestToken: true },
        })
      : [];
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
    const [products, variantChunks, nameChunks] = await Promise.all([
      getProductsByIds(
        admin,
        [
          ...new Set([
            ...items.map((item) => item.productId),
            ...removals.map((row) => row.productId),
          ]),
        ],
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
    } else if (allTimeProducts) {
      type ProductGroup = {
        saves: number;
        active: number;
        shoppers: Set<string>;
      };
      const productGroups = new Map<string, ProductGroup>();
      const groupFor = (productId: string) => {
        const group = productGroups.get(productId) || {
          saves: 0,
          active: 0,
          shoppers: new Set<string>(),
        };
        productGroups.set(productId, group);
        return group;
      };
      const identityOf = (row: {
        customerId: string | null;
        guestToken: string | null;
      }) =>
        row.customerId
          ? `customer:${row.customerId}`
          : row.guestToken
            ? `guest:${row.guestToken}`
            : null;
      for (const item of items) {
        const group = groupFor(item.productId);
        group.saves++;
        group.active++;
        const identity = identityOf(item);
        if (identity) group.shoppers.add(identity);
      }
      // Products removed from a wishlist stay visible with their history.
      for (const removal of removals) {
        const group = groupFor(removal.productId);
        group.saves++;
        const identity = identityOf(removal);
        if (identity) group.shoppers.add(identity);
      }
      table = {
        title: "Wishlisted Products",
        description: "One row per product ever wishlisted, across all dates",
        label: "Products",
        imageColumn: true,
        columns: ["Product Title", "Wishlist Saves", "Shoppers", "Status"],
        rows: [...productGroups]
          .sort(
            ([productIdA, a], [productIdB, b]) =>
              b.saves - a.saves || productIdA.localeCompare(productIdB),
          )
          .map(([productId, group]) => ({
            id: productId,
            image: products.get(productId)?.imageUrl,
            cells: [
              products.get(productId)?.title || productId,
              group.saves,
              group.shoppers.size,
              group.active > 0 ? "Active" : "Removed",
            ],
          })),
        note: "One row per distinct product ever saved to a wishlist. Saves include items that were later removed; status shows whether the product still sits in a shopper's wishlist. Removal history starts from the launch of this report.",
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
      table = {
        title: low
          ? "Running out soon"
          : allTimeSaves
            ? "All-time Wishlist Saves"
            : "Products",
        description: "View and analyze wishlist engagement for your products",
        label: "Product Variants",
        imageColumn: true,
        columns: [
          "Product Title",
          "SKU",
          "Inventory",
          "Wishlist Saves",
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
                row.saves,
                "Not tracked",
              ],
            };
          }),
        note: allTimeSaves
          ? "Wishlist saves show currently retained items across all dates; removed items are not retained. Inventory is current across all locations. Revenue and inventory-change timestamps are not tracked."
          : "Saves are currently retained items added during the selected dates. Inventory is current across all locations. Revenue and inventory-change timestamps are not tracked." +
            (low
              ? " Low-stock filter: at least 2 distinct shoppers and product stock of 10 or fewer."
              : ""),
      };
    }
  }
  const rows = filterReport(table.rows, params);
  return {
    ...range,
    tab,
    table: { ...table, rows },
    inventory,
    overview,
    wishlistSummary,
  };
}
