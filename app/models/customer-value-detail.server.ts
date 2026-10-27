import db from "../db.server";
import { rangeBounds, type DateRange } from "../lib/analytics-params";
import type {
  CustomerValueDetail,
  CustomerValueDetailRow,
  CustomerValueSegment,
} from "../lib/customer-value-detail";
import { gqlRequest } from "../lib/graphql.server";
import {
  getCustomerNamesByIds,
  getProductsByIds,
  type GraphqlClient,
  type ProductSummary,
} from "../lib/shopify-data.server";

type OrderDetails = {
  customerId: string | null;
  email: string | null;
  name: string;
  createdAt: string;
};

async function loadOrderDetails(
  admin: GraphqlClient,
  orderIds: string[],
): Promise<Map<string, OrderDetails>> {
  const result = new Map<string, OrderDetails>();
  for (let index = 0; index < orderIds.length; index += 50) {
    const ids = orderIds
      .slice(index, index + 50)
      .map((id) =>
        id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`,
      );
    const response = await gqlRequest<{
      nodes: Array<{
        id: string;
        name: string;
        email: string | null;
        customer: { id: string } | null;
        createdAt: string;
      } | null>;
    }>(
      admin,
      `query CustomerValueOrderDetails($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            email
            customer { id }
            createdAt
          }
        }
      }`,
      { variables: { ids } },
    ).catch(() => ({ nodes: [] }));
    for (const order of response.nodes) {
      if (!order) continue;
      result.set(order.id.split("/").pop()!, {
        customerId: order.customer?.id.split("/").pop() ?? null,
        email: order.email?.trim().toLowerCase() ?? null,
        name: order.name,
        createdAt: order.createdAt,
      });
    }
  }
  return result;
}

export async function loadCustomerValueDetail(
  shopId: string,
  admin: GraphqlClient,
  range: DateRange,
  segment: CustomerValueSegment,
): Promise<CustomerValueDetail> {
  const bounds = rangeBounds(range);
  const [attributions, wishlistOrders, alertPurchases] = await Promise.all([
    db.attribution.findMany({
      where: { shopId, model: "last_click", orderedAt: bounds },
      select: {
        orderId: true,
        orderNumber: true,
        customerId: true,
        productId: true,
        variantId: true,
        source: true,
        revenue: true,
        orderedAt: true,
      },
    }),
    db.wishlistOrder.findMany({
      where: { shopId, createdAt: bounds },
      select: { orderId: true, productId: true, createdAt: true },
    }),
    db.stockAlert.findMany({
      where: {
        shopId,
        purchasedAt: bounds,
        purchaseOrderId: { not: null },
      },
      select: {
        purchaseOrderId: true,
        customerId: true,
        email: true,
        productId: true,
        variantId: true,
        purchaseRevenue: true,
        purchasedAt: true,
      },
    }),
  ]);
  const orderIds = [
    ...new Set([
      ...attributions.map((row) => row.orderId),
      ...wishlistOrders.map((row) => row.orderId),
      ...alertPurchases.flatMap((row) =>
        row.purchaseOrderId ? [row.purchaseOrderId] : [],
      ),
    ]),
  ];
  const orderDetails = await loadOrderDetails(admin, orderIds);
  const customerIdByOrder = new Map<string, string>();
  const emailByOrder = new Map<string, string>();
  for (const row of attributions) {
    if (row.customerId && !customerIdByOrder.has(row.orderId)) {
      customerIdByOrder.set(row.orderId, row.customerId);
    }
  }
  for (const row of alertPurchases) {
    if (!row.purchaseOrderId) continue;
    if (row.customerId && !customerIdByOrder.has(row.purchaseOrderId)) {
      customerIdByOrder.set(row.purchaseOrderId, row.customerId);
    }
    if (row.email && !emailByOrder.has(row.purchaseOrderId)) {
      emailByOrder.set(row.purchaseOrderId, row.email.trim().toLowerCase());
    }
  }

  const identityByOrder = new Map<string, { key: string; label: string }>();
  for (const orderId of orderIds) {
    const details = orderDetails.get(orderId);
    const customerId =
      details?.customerId ?? customerIdByOrder.get(orderId) ?? null;
    const email = details?.email ?? emailByOrder.get(orderId) ?? null;
    if (segment === "logged-in" ? !customerId : Boolean(customerId)) continue;
    identityByOrder.set(
      orderId,
      customerId
        ? { key: `customer:${customerId}`, label: `Customer ${customerId}` }
        : email
          ? { key: `guest:${email}`, label: email }
          : { key: `guest-order:${orderId}`, label: "Guest / not recorded" },
    );
  }

  const customerIds = [
    ...new Set(
      [...identityByOrder.values()]
        .map((identity) =>
          identity.key.startsWith("customer:") ? identity.key.slice(9) : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [customerNames, products] = await Promise.all([
    getCustomerNamesByIds(admin, customerIds).catch(
      () => new Map<string, string>(),
    ),
    getProductsByIds(admin, [
      ...new Set([
        ...attributions.map((row) => row.productId),
        ...wishlistOrders.map((row) => row.productId),
        ...alertPurchases.map((row) => row.productId),
      ]),
    ]).catch(() => new Map<string, ProductSummary>()),
  ]);
  for (const identity of identityByOrder.values()) {
    if (identity.key.startsWith("customer:")) {
      const id = identity.key.slice(9);
      identity.label = customerNames.get(id) ?? `Customer ${id}`;
    }
  }

  type ProductOrder = {
    orderId: string;
    productId: string;
    variantId: string | null;
    revenue: number;
    sources: Set<string>;
  };
  const productOrders = new Map<string, ProductOrder>();
  const addProductOrder = (
    orderId: string,
    productId: string,
    variantId: string | null,
    source: string,
    revenue = 0,
  ) => {
    if (!identityByOrder.has(orderId)) return;
    const key = `${orderId}:${productId}:${variantId ?? ""}`;
    const row = productOrders.get(key) ?? {
      orderId,
      productId,
      variantId,
      revenue: 0,
      sources: new Set<string>(),
    };
    row.sources.add(source);
    row.revenue = Math.max(row.revenue, revenue);
    productOrders.set(key, row);
  };
  for (const row of attributions) {
    addProductOrder(
      row.orderId,
      row.productId,
      row.variantId,
      row.source === "WISHLIST" ? "Wishlist" : "Back in stock",
      Number(row.revenue),
    );
  }
  const attributedOrderProducts = new Set(
    attributions.map((row) => `${row.orderId}:${row.productId}`),
  );
  for (const row of wishlistOrders) {
    if (attributedOrderProducts.has(`${row.orderId}:${row.productId}`))
      continue;
    addProductOrder(row.orderId, row.productId, null, "Wishlist");
  }
  for (const row of alertPurchases) {
    if (row.purchaseOrderId) {
      addProductOrder(
        row.purchaseOrderId,
        row.productId,
        row.variantId,
        "Back in stock",
        Number(row.purchaseRevenue ?? 0),
      );
    }
  }

  const rows: CustomerValueDetailRow[] = [...productOrders.values()]
    .map((row) => {
      const details = orderDetails.get(row.orderId);
      const identity = identityByOrder.get(row.orderId)!;
      const product = products.get(row.productId);
      const variant = row.variantId
        ? product?.variants.find((item) => item.variantId === row.variantId)
        : null;
      const fallbackOrder = attributions.find(
        (item) => item.orderId === row.orderId,
      );
      return {
        customer: identity.label,
        order: details?.name ?? fallbackOrder?.orderNumber ?? row.orderId,
        orderedAt:
          details?.createdAt ?? fallbackOrder?.orderedAt.toISOString() ?? null,
        product: product?.title ?? `Product ${row.productId}`,
        variant: variant?.title ?? row.variantId ?? "—",
        source: [...row.sources].join(", "),
        revenue: row.revenue,
      };
    })
    .sort(
      (left, right) =>
        left.customer.localeCompare(right.customer) ||
        left.order.localeCompare(right.order),
    );
  const orderCount = identityByOrder.size;
  const productCount = new Set(
    [...productOrders.values()].map((row) => row.productId),
  ).size;
  return {
    segment,
    title: segment === "guest" ? "Guest customers" : "Logged-in customers",
    customers: new Set(
      [...identityByOrder.values()].map((identity) => identity.key),
    ).size,
    orders: orderCount,
    products: productCount,
    rows,
  };
}
