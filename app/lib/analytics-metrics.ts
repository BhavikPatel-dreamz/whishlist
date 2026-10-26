export function metricsDateRange(params: URLSearchParams, now = new Date()) {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      6 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  const from = params.get("from") || start;
  const to = params.get("to") || end;
  const error =
    !valid(from) || !valid(to) || from > to || to > end
      ? "Choose valid dates in order, ending today or earlier."
      : null;
  return { from: error ? start : from, to: error ? end : to, error };
}

export type MetricSave = {
  productId: string;
  customerId: string | null;
  guestToken: string | null;
};
export type MetricProduct = {
  title: string;
  imageUrl: string | null;
  totalInventory: number;
  minPrice: string | null;
  currencyCode: string | null;
};

/** A product that has at least one out-of-stock variant, plus those variant titles. */
export type OutOfStockVariantInfo = {
  title: string;
  imageUrl: string | null;
  /** Titles of the variants that are out of stock, e.g. `["Honey", "Tan"]`. */
  variants: string[];
  /** Stock of the whole product, all variants together. */
  stock?: number | null;
};

export function summarizeMetrics(
  items: MetricSave[],
  products: Map<string, MetricProduct>,
  names = new Map<string, string>(),
  outOfStockVariants?: Map<string, OutOfStockVariantInfo>,
) {
  const demand = new Map<string, { saves: number; shoppers: Set<string> }>();
  const shoppers = new Map<
    string,
    { customerId: string | null; products: Set<string>; saves: number }
  >();
  for (const item of items) {
    const identity = item.customerId
      ? `customer:${item.customerId}`
      : item.guestToken
        ? `guest:${item.guestToken}`
        : null;
    if (!identity) continue;
    const product = demand.get(item.productId) || {
      saves: 0,
      shoppers: new Set<string>(),
    };
    product.saves++;
    product.shoppers.add(identity);
    demand.set(item.productId, product);
    const shopper = shoppers.get(identity) || {
      customerId: item.customerId,
      products: new Set<string>(),
      saves: 0,
    };
    shopper.products.add(item.productId);
    shopper.saves++;
    shoppers.set(identity, shopper);
  }
  const popular = [...demand]
    .map(([productId, demand]) => {
      const product = products.get(productId);
      return {
        productId,
        title: product?.title || `Unavailable product (${productId})`,
        imageUrl: product?.imageUrl || null,
        stock: product?.totalInventory ?? null,
        shoppers: demand.shoppers.size,
        saves: demand.saves,
      };
    })
    .sort(
      (a, b) =>
        b.saves - a.saves ||
        b.shoppers - a.shoppers ||
        a.productId.localeCompare(b.productId),
    );
  // "Running out soon" is variant level: a product shows up as soon as one of its
  // variants runs out, even when the other variants are still in stock.
  const runningLow = outOfStockVariants
    ? [...outOfStockVariants]
        .map(([productId, info]) => ({
          productId,
          title: info.title,
          imageUrl: info.imageUrl,
          stock: info.stock ?? products.get(productId)?.totalInventory ?? null,
          shoppers: demand.get(productId)?.shoppers.size || 0,
          saves: demand.get(productId)?.saves || 0,
          variants: info.variants,
        }))
        .sort(
          (a, b) =>
            a.title.localeCompare(b.title) ||
            a.productId.localeCompare(b.productId),
        )
    : [...products]
        .filter(([, product]) => product.totalInventory <= 0)
        .map(([productId, product]) => ({
          productId,
          title: product.title,
          imageUrl: product.imageUrl,
          stock: product.totalInventory,
          shoppers: demand.get(productId)?.shoppers.size || 0,
          saves: demand.get(productId)?.saves || 0,
          variants: [] as string[],
        }))
        .sort(
          (a, b) =>
            a.title.localeCompare(b.title) ||
            a.productId.localeCompare(b.productId),
        );
  const shopperRows = [...shoppers]
    .map(([, shopper], index) => {
      const value = new Map<string, number>();
      let unpriced = 0;
      for (const id of shopper.products) {
        const product = products.get(id);
        if (
          !product ||
          product.minPrice === null ||
          !product.currencyCode ||
          !Number.isFinite(Number(product.minPrice))
        ) {
          unpriced++;
          continue;
        }
        value.set(
          product.currencyCode,
          (value.get(product.currencyCode) || 0) + Number(product.minPrice),
        );
      }
      return {
        id: String(index),
        name: shopper.customerId
          ? names.get(shopper.customerId) || `Customer ${shopper.customerId}`
          : `Guest shopper ${index + 1}`,
        products: shopper.products.size,
        saves: shopper.saves,
        value: [...value].map(([currency, amount]) => ({ currency, amount })),
        unpriced,
      };
    })
    .sort(
      (a, b) =>
        b.products - a.products ||
        b.saves - a.saves ||
        a.name.localeCompare(b.name),
    );
  return { popular, runningLow, shoppers: shopperRows };
}

export type MetricsData = ReturnType<typeof summarizeMetrics> &
  ReturnType<typeof metricsDateRange>;
export function shopperValue(row: MetricsData["shoppers"][number]) {
  const values = row.value.map((value) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: value.currency,
    }).format(value.amount),
  );
  return values.length
    ? `${values.join(" + ")}${row.unpriced ? " (partial)" : ""}`
    : "Unavailable";
}

/** Inclusive day bounds for a `from`/`to` range: from 00:00Z through end of `to`. */
export function metricsDateBounds(range: { from: string; to: string }) {
  return {
    gte: new Date(`${range.from}T00:00:00Z`),
    lt: new Date(Date.parse(`${range.to}T00:00:00Z`) + 86400000),
  };
}
