import { createResyncWebhookAction } from "../lib/webhooks/resync-webhook.server";
import { resyncStoreLocations } from "../models/store.server";

export const action = createResyncWebhookAction("locations/create", resyncStoreLocations);