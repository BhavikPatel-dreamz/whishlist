import type { Shop } from "@prisma/client";

/**
 * Queue path is on when the global env flag is set, or the shop opted in.
 * Env `RESTOCK_QUEUE_ENABLED=true` enables enqueue for every shop.
 */
export function isRestockQueueEnabled(
  shop: Pick<Shop, "restockQueueEnabled">,
): boolean {
  if (process.env.RESTOCK_QUEUE_ENABLED === "true") return true;
  if (process.env.RESTOCK_QUEUE_ENABLED === "false") {
    return Boolean(shop.restockQueueEnabled);
  }
  return Boolean(shop.restockQueueEnabled);
}
