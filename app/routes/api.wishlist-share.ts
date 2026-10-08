import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { errorResponse, json, ProxyError, clientIp } from "../lib/proxy.server";
import { createShareToken } from "../lib/wishlist-share.server";
import { rateLimit } from "../lib/rate-limit.server";
export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") throw new ProxyError(405, "Method not allowed", "method_not_allowed");
    const ctx = await authenticateProxyRequest(request);
    if (!ctx.loggedInCustomerId) throw new ProxyError(401, "Log in to share your wishlist.", "login_required");
    await rateLimit({ key: `wishlist-share:${ctx.shop.id}:${clientIp(request)}`, limit: 20, windowSeconds: 60, shopId: ctx.shop.id });
    return json({ ok: true, token: createShareToken(ctx.shop.id, ctx.loggedInCustomerId) });
  } catch (error) { return errorResponse(error); }
}
