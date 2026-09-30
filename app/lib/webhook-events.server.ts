import { Prisma } from "@prisma/client";
import db from "../db.server";

/** Claims a delivery before processing. Handlers release the claim on failure. */
export async function claimWebhook(
  shopId: string,
  webhookId: string | null,
  topic: string,
): Promise<boolean> {
  if (!webhookId) return true;
  try {
    await db.webhookEvent.create({ data: { shopId, webhookId, topic } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    // Database failures must propagate so the delivery can be retried.
    throw error;
  }
}

/** Drops webhook receipts older than 7 days. */
export async function pruneWebhookEvents(): Promise<void> {
  await db.webhookEvent.deleteMany({
    where: { processedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
}
