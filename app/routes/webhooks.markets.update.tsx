import { createResyncWebhookAction } from "../lib/webhooks/resync-webhook.server";
import { resyncStoreMarkets } from "../models/store.server";

export const action = createResyncWebhookAction("markets/update", resyncStoreMarkets);