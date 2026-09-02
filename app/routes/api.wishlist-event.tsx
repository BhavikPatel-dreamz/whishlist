import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { errorResponse, json, numericId, readBody } from "../lib/proxy.server";
import { incrementAddToCart } from "../models/wishlist.server";

/** Proxy endpoint to record wishlist-related events from the storefront. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const ctx = await authenticateProxyRequest(request);
    const body = await readBody(request);
    const event = body.event;
    if (!event) return errorResponse({ status: 400, message: "missing event" });

    if (event === "move_to_cart") {
      const productId = numericId(body.productId);
      if (!productId) return errorResponse({ status: 422, message: "productId required" });
      await incrementAddToCart(ctx.shop.id, productId, 1);
      return json({ ok: true });
    }

    return errorResponse({ status: 400, message: "unsupported event" });
  } catch (error) {
    return errorResponse(error);
  }
};
