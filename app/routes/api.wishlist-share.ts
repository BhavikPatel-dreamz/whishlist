import type { ActionFunctionArgs } from "@remix-run/node";
import { errorResponse, json, ProxyError, readBody } from "../lib/proxy.server";
import { withProxy } from "../lib/proxy-route.server";
import { createShareToken } from "../lib/wishlist-share.server";
import db from "../db.server";
import { identityWhere, requireIdentity } from "../models/wishlist.server";
import { listName, wishlistFeatures } from "../models/wishlist-lists.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return errorResponse(
      new ProxyError(405, "Method not allowed", "method_not_allowed"),
    );

  return withProxy(
    request,
    { limit: { name: "wishlist-share", limit: 20, windowSeconds: 60 } },
    async (ctx) => {
      const features = await wishlistFeatures(ctx.shop.id);
      if (features.allowShare === false)
        throw new ProxyError(
          403,
          "Wishlist sharing is disabled.",
          "sharing_disabled",
        );
      const body = request.headers.get("Content-Type")
        ? await readBody(request)
        : {};
      const identity = requireIdentity({
        customerId: ctx.loggedInCustomerId,
        guestToken: body.guestToken || null,
      });
      if (ctx.shop.wishlistRequiresLogin && !identity.customerId)
        throw new ProxyError(
          401,
          "Log in to share your wishlist.",
          "login_required",
        );
      const selectedList =
        features.wishlistMode === "multi" && body.listName
          ? listName(body.listName)
          : null;
      if (body.mode) {
        if (!["copylink", "facebook", "x", "email"].includes(String(body.mode)))
          throw new ProxyError(400, "Invalid sharing mode", "invalid_mode");
        const items = await db.wishlistItem.findMany({
          where: {
            ...identityWhere(ctx.shop.id, identity),
            ...(selectedList ? { listName: selectedList } : {}),
          },
          select: { productId: true, handle: true },
        });
        await db.wishlistShare.create({
          data: {
            shopId: ctx.shop.id,
            customerId: identity.customerId || `guest:${identity.guestToken}`,
            mode: String(body.mode),
            listName: selectedList,
            products: items,
          },
        });
        return json({ ok: true });
      }
      return json({
        ok: true,
        token: createShareToken(
          ctx.shop.id,
          identity.customerId,
          identity.guestToken,
          selectedList,
        ),
      });
    },
  );
}
