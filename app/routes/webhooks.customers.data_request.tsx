import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR webhook. We do not store standalone customer PII profiles —
 * acknowledge the request. Export tooling can be added later if needed.
 * Invalid HMAC must surface as 401 (do not catch authenticate.webhook).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  return new Response();
};
