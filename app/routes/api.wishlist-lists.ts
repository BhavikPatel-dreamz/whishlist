import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { errorResponse, json, readBody, ProxyError, numericId, clientIp } from "../lib/proxy.server";
import { syncWishlistToMetafield } from "../lib/wishlist-sync.server";
import { rateLimit } from "../lib/rate-limit.server";
import { listWishlist, mergeGuestWishlist, requireIdentity } from "../models/wishlist.server";
import { changeList, getLists, listName, wishlistFeatures } from "../models/wishlist-lists.server";

async function context(request: Request, guestToken: string | null) {
  const ctx = await authenticateProxyRequest(request);
  await rateLimit({ key: `wishlist-lists:${ctx.shop.id}:${clientIp(request)}`, limit: 60, windowSeconds: 60, shopId: ctx.shop.id });
  const identity = requireIdentity({ customerId: ctx.loggedInCustomerId, guestToken });
  if (ctx.shop.wishlistRequiresLogin && !identity.customerId) throw new ProxyError(401, "Sign in to manage wishlists.", "login_required");
  if (identity.customerId && identity.guestToken) await mergeGuestWishlist(ctx.shop.id, identity.guestToken, identity.customerId);
  return { ctx, identity };
}
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { ctx, identity } = await context(request, new URL(request.url).searchParams.get("guest_token"));
    return json({ ok: true, lists: await getLists(ctx.shop.id, identity) });
  } catch (error) { return errorResponse(error); }
}
export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") throw new ProxyError(405, "Method not allowed", "method_not_allowed");
    const body = await readBody(request);
    const { ctx, identity } = await context(request, body.guestToken || null);
    if ((await wishlistFeatures(ctx.shop.id)).wishlistMode !== "multi") throw new ProxyError(403, "Multiple wishlists are disabled.", "multi_disabled");
    await changeList(ctx.shop.id, identity, body.operation, listName(body.name), listName(body.newName), numericId(body.productId) || undefined);
    if (identity.customerId) await syncWishlistToMetafield(await ctx.admin(), identity.customerId, await listWishlist(ctx.shop.id, identity));
    return json({ ok: true, lists: await getLists(ctx.shop.id, identity) });
  } catch (error) { return errorResponse(error); }
}
