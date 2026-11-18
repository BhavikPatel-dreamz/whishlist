import db from "../../db.server";

/** Releases a claimed webhook receipt and returns a 500 response. */
export async function releaseWebhookAndFail(
  shopId: string,
  webhookId: string | null,
): Promise<Response> {
  if (webhookId) {
    await db.webhookEvent
      .deleteMany({ where: { shopId, webhookId } })
      .catch(() => {});
  }
  return new Response("Processing failed", { status: 500 });
}