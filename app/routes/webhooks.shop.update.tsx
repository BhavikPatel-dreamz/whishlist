import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);

  // Shop details are fetched through getShopContext when needed, so there is
  // no local shop metadata to synchronize for this subscription.
  return new Response(null, { status: 200 });
};
