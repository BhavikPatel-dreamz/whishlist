import db from "../db.server";
import { loadOutOfStockProducts } from "./out-of-stock.server";
import { metricsDateRange, summarizeMetrics } from "../lib/analytics-metrics";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
} from "../lib/shopify-data.server";

export async function loadAnalyticsMetrics(
  shopId: string,
  admin: GraphqlClient,
  params: URLSearchParams,
) {
  const range = metricsDateRange(params);
  const items = await db.wishlistItem.findMany({
    where: {
      shopId,
      createdAt: {
        gte: new Date(`${range.from}T00:00:00Z`),
        lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + 86400000),
      },
    },
    select: { productId: true, customerId: true, guestToken: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const customerIds = [
    ...new Set(
      items.flatMap((item) => (item.customerId ? [item.customerId] : [])),
    ),
  ];
  const [products, nameMaps, outOfStockProducts] = await Promise.all([
    getProductsByIds(
      admin,
      [...new Set(items.map((item) => item.productId))],
      1,
    ),
    Promise.all(
      Array.from({ length: Math.ceil(customerIds.length / 250) }, (_, i) =>
        getCustomerNamesByIds(admin, customerIds.slice(i * 250, (i + 1) * 250)),
      ),
    ),
    loadOutOfStockProducts(admin),
  ]);
  return {
    ...range,
    ...summarizeMetrics(
      items,
      products,
      new Map(nameMaps.flatMap((map) => [...map])),
      outOfStockProducts,
    ),
  };
}
