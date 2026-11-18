import { customersWebhookAction } from "../lib/webhooks/customers-webhook.server";

/**
 * `customers/create` webhook. Same guest→customer identity link as update,
 * so wishlists and stock alerts attach as soon as the account is created.
 */
export const action = customersWebhookAction;

export default function CustomersCreateWebhook() {
  return null;
}