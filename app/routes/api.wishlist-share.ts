import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { errorResponse, json, ProxyError, clientIp, readBody } from "../lib/proxy.server";
import { createShareToken } from "../lib/wishlist-share.server";
import db from "../db.server";
import { rateLimit } from "../lib/rate-limit.server";
export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") throw new ProxyError(405, "Method not allowed", "method_not_allowed");
    const ctx = await authenticateProxyRequest(request);
    if (!ctx.loggedInCustomerId) throw new ProxyError(401, "Log in to share your wishlist.", "login_required");
    await rateLimit({ key: `wishlist-share:${ctx.shop.id}:${clientIp(request)}`, limit: 20, windowSeconds: 60, shopId: ctx.shop.id });
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const body = await readBody(request);
      if (!["copylink", "facebook", "x"].includes(String(body.mode))) throw new ProxyError(400, "Invalid sharing mode", "invalid_mode");
      const items = await db.wishlistItem.findMany({ where: { shopId: ctx.shop.id, customerId: ctx.loggedInCustomerId }, select: { productId: true, handle: true } });
      await db.wishlistShare.create({ data: { shopId: ctx.shop.id, customerId: ctx.loggedInCustomerId, mode: String(body.mode), products: items } });
      return json({ ok: true });
    }
    return json({ ok: true, token: createShareToken(ctx.shop.id, ctx.loggedInCustomerId) });
  } catch (error) { return errorResponse(error); }
}
