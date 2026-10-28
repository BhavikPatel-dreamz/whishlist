import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR webhook. We do not store standalone customer PII profiles —
 * acknowledge the request. Export tooling can be added later if needed.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    return new Response();
  } catch (error) {
    console.error("customers/data_request handler error", error);
    return new Response();
  }
};
