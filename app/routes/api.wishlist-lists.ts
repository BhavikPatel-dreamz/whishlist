import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, readBody, errorResponse, ProxyError, numericId } from "../lib/proxy.server";
import { withProxy, type ProxyRouteOptions } from "../lib/proxy-route.server";
import type { ProxyContext } from "../lib/proxy-auth.server";
import { syncWishlistToMetafield } from "../lib/wishlist-sync.server";
import { listWishlist, mergeGuestWishlist, requireIdentity, type Identity } from "../models/wishlist.server";
import { changeList, getLists, listName, wishlistFeatures } from "../models/wishlist-lists.server";

const limits: ProxyRouteOptions = { limit: { name: "wishlist-lists", limit: 60, windowSeconds: 60 } };

async function identityFor(ctx: ProxyContext, guestToken: string | null): Promise<Identity> {
  const identity = requireIdentity({ customerId: ctx.loggedInCustomerId, guestToken });
  if (ctx.shop.wishlistRequiresLogin && !identity.customerId) throw new ProxyError(401, "Sign in to manage wishlists.", "login_required");
  if (identity.customerId && identity.guestToken) await mergeGuestWishlist(ctx.shop.id, identity.guestToken, identity.customerId);
  return identity;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const guestToken = new URL(request.url).searchParams.get("guest_token");
  return withProxy(request, limits, async (ctx) =>
    json({ ok: true, lists: await getLists(ctx.shop.id, await identityFor(ctx, guestToken)) }),
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return errorResponse(new ProxyError(405, "Method not allowed", "method_not_allowed"));
  return withProxy(request, limits, async (ctx) => {
    const body = await readBody(request);
    const identity = await identityFor(ctx, body.guestToken || null);
    if ((await wishlistFeatures(ctx.shop.id)).wishlistMode !== "multi") throw new ProxyError(403, "Multiple wishlists are disabled.", "multi_disabled");
    await changeList(ctx.shop.id, identity, body.operation, listName(body.name), listName(body.newName), numericId(body.productId) || undefined);
    if (identity.customerId) await syncWishlistToMetafield(await ctx.admin(), identity.customerId, await listWishlist(ctx.shop.id, identity));
    return json({ ok: true, lists: await getLists(ctx.shop.id, identity) });
  });
}
