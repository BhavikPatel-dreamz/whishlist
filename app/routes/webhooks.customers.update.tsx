import { customersWebhookAction } from "../lib/webhooks/customers-webhook.server";

/**
 * `customers/update` webhook. When a guest shopper creates or logs into a
 * customer account, repoint their guest wishlist items, stock alerts, and
 * tracking events to the customer id so reports stay accurate.
 */
export const action = customersWebhookAction;

export default function CustomersUpdateWebhook() {
  return null;
}