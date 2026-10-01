import type { GraphqlClient } from "./shopify-data.server";
import { recordWishlistDrivenOrder } from "../models/wishlist.server";

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type Line = { product: { id: string } | null; customAttributes: { key: string; value: string }[] };
type Lines = { nodes: Line[]; pageInfo: PageInfo };
type Order = { id: string; lineItems: Lines };
const lastSynced = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const lineFields = `nodes { product { id } customAttributes { key value } }
  pageInfo { hasNextPage endCursor }`;

async function request<T>(admin: GraphqlClient, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const result = await response.json();
  if (!response.ok || result.errors?.length || !result.data) {
    throw new Error("Could not sync wishlist orders from Shopify");
  }
  return result.data as T;
}

/** Recover missed webhooks using explicit cart markers, never merely a current wishlist match. */
export async function syncWishlistOrders(shopId: string, admin: GraphqlClient): Promise<void> {
  const pending = inFlight.get(shopId);
  if (pending) return pending;
  const started = Date.now();
  const previous = lastSynced.get(shopId);
  if (previous && started - previous < 60_000) return;

  const sync = async () => {
    // Ordinary read_orders access includes the last 60 days. Keep an overlap for
    // delayed indexing; a failed scan never advances the checkpoint.
    const since = new Date(Math.max(started - 60 * 86400_000, (previous ?? 0) - 86400_000)).toISOString();
    let cursor: string | null = null;
    do {
      const data: { orders: { nodes: Order[]; pageInfo: PageInfo } } = await request(admin, `
        query WishlistOrderRecovery($query: String!, $cursor: String) {
          orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT) {
            nodes { id lineItems(first: 100) { ${lineFields} } }
            pageInfo { hasNextPage endCursor }
          }
        }`, { query: `updated_at:>='${since}'`, cursor });
      for (const order of data.orders.nodes) {
        let lines = order.lineItems;
        const products = new Set<string>();
        while (true) {
          for (const line of lines.nodes) {
            if (line.product && line.customAttributes.some(a => a.key === "_wishlist_stock" && a.value === "true")) {
              products.add(line.product.id.split("/").pop()!);
            }
          }
          if (!lines.pageInfo.hasNextPage) break;
          if (!lines.pageInfo.endCursor) throw new Error("Missing order line cursor");
          const next: { order: { lineItems: Lines } | null } = await request(admin, `
            query WishlistOrderLines($id: ID!, $cursor: String!) {
              order(id: $id) { lineItems(first: 100, after: $cursor) { ${lineFields} } }
            }`, { id: order.id, cursor: lines.pageInfo.endCursor });
          if (!next.order) throw new Error("Order unavailable during wishlist sync");
          lines = next.order.lineItems;
        }
        for (const productId of products) {
          await recordWishlistDrivenOrder(shopId, order.id.split("/").pop()!, productId);
        }
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      if (!data.orders.pageInfo.endCursor) throw new Error("Missing orders cursor");
      cursor = data.orders.pageInfo.endCursor;
    } while (cursor);
    lastSynced.set(shopId, started);
  };
  const task = sync();
  inFlight.set(shopId, task);
  try { await task; } finally { inFlight.delete(shopId); }
}
