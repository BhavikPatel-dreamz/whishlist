import { createDeleteWebhookAction } from "../lib/webhooks/resync-webhook.server";

export const action = createDeleteWebhookAction(
  "locations/delete",
  "storeLocation",
  "shopifyLocationId",
  "Location",
);