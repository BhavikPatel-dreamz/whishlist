import { createDeleteWebhookAction } from "../lib/webhooks/resync-webhook.server";

export const action = createDeleteWebhookAction(
  "markets/delete",
  "storeMarket",
  "shopifyMarketId",
  "Market",
);