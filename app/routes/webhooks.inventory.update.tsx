import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../lib/shop.server";

type InventoryPayload = Record<string, any>;

/**
 * `inventory_levels/update` webhook. Keeps `InventoryCache` fresh so the stock
 * list and low-stock demand reports never have to walk every product.
 * Idempotent: the upsert key is (shopId, variantId).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let stage = "authentication";
  try {
    const { shop, topic, payload } = await authenticate.webhook(request);
    stage = "inventory-processing";

    const shopRecord = await getOrCreateShop(shop);
    const inventory = payload as InventoryPayload;
    const variantId = inventory?.inventory_item_id
      ? String(inventory.inventory_item_id)
      : null;
    const productId = inventory?.product_id ? String(inventory.product_id) : null;
    const quantity = Number(inventory?.available ?? 0);
    if (!variantId || !productId) return new Response();

    const status =
      quantity <= 0
        ? "out_of_stock"
        : quantity <= 5
          ? "low_stock"
          : "in_stock";

    await dbInventoryCacheUpsert(shopRecord.id, variantId, productId, quantity, status);

    return new Response();
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("inventory_levels/update handler error", {
      stage,
      webhookId: request.headers.get("X-Shopify-Webhook-Id"),
      error: err,
    });
    return new Response(null, { status: 500 });
  }
};

async function dbInventoryCacheUpsert(
  shopId: string,
  variantId: string,
  productId: string,
  quantity: number,
  status: string,
) {
  // Dynamic import to avoid a direct import cycle with db.server in this route.
  const { default: db } = await import("../db.server");
  const now = new Date();
  const updateData: Record<string, unknown> = {
    quantity,
    status,
    updatedAt: now,
  };
  if (status === "out_of_stock") {
    updateData["lastOutOfStockAt"] = now;
  }
  if (status === "in_stock") {
    updateData["lastRestockedAt"] = now;
  }

  await db.inventoryCache.upsert({
    where: { shopId_variantId: { shopId, variantId } },
    update: updateData,
    create: {
      shopId,
      variantId,
      productId,
      quantity,
      status,
      lastOutOfStockAt: status === "out_of_stock" ? now : null,
      lastRestockedAt: status === "in_stock" ? now : null,
    },
  });
}

export default function InventoryUpdateWebhook() {
  return null;
}
