import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import {
  ProxyError,
  clientIp,
  errorResponse,
  json,
  numericId,
  readBody,
} from "../lib/proxy.server";
import db from "../db.server";
import { rateLimit } from "../lib/rate-limit.server";
import { formatMoney, getProductsByIds, type GraphqlClient } from "../lib/shopify-data.server";
import { syncWishlistToMetafield } from "../lib/wishlist-sync.server";
import {
  addToWishlist,
  listWishlist,
  mergeGuestWishlist,
  removeFromWishlist,
  requireIdentity,
  type Identity,
} from "../models/wishlist.server";
import type { WishlistItem } from "@prisma/client";

/** Storefront endpoint: GET /apps/wishlist-stock/api/wishlist */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const ctx = await authenticateProxyRequest(request);
    await rateLimit({
      key: `wishlist-read:${ctx.shopDomain}:${clientIp(request)}`,
      limit: 120,
      windowSeconds: 60,
      shopId: ctx.shop.id,
    });

    const identity = await resolveIdentity(ctx.shop.id, ctx.loggedInCustomerId, ctx.url.searchParams.get("guest_token"));
    const items = await listWishlist(ctx.shop.id, identity);

    // requiresLogin lets the storefront gate the heart before it even flips (the POST
    // guard below is still the authority); loggedIn tells it whether the gate applies.
    const requiresLogin = ctx.shop.wishlistRequiresLogin;
    const loggedIn = Boolean(identity.customerId);

    if (ctx.url.searchParams.get("enrich") === "0" || !items.length) {
      return json({
        ok: true,
        count: items.length,
        items: items.map(serialiseItem),
        requiresLogin,
        loggedIn,
      });
    }

    return json({
      ok: true,
      count: items.length,
      items: await enrich(await ctx.admin(), items),
      requiresLogin,
      loggedIn,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

/** POST adds, DELETE removes. POST also accepts `_method=delete` for beacon-style clients. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const ctx = await authenticateProxyRequest(request);
    await rateLimit({
      key: `wishlist-write:${ctx.shopDomain}:${clientIp(request)}`,
      limit: 60,
      windowSeconds: 60,
      shopId: ctx.shop.id,
    });

    const body = await readBody(request);
    const method = (body._method || request.method).toUpperCase();

    const admin = await ctx.admin();
    const identity = await resolveIdentity(
      ctx.shop.id,
      ctx.loggedInCustomerId,
      body.guestToken || ctx.url.searchParams.get("guest_token"),
      admin,
    );

    if (ctx.shop.wishlistRequiresLogin && !identity.customerId) {
      throw new ProxyError(401, "Sign in to save items to your wishlist", "login_required");
    }

    const productId = numericId(body.productId);
    if (!productId) throw new ProxyError(422, "productId is required", "missing_product");
    const variantId = numericId(body.variantId);

    if (method === "DELETE") {
      const removed = await removeFromWishlist(ctx.shop.id, identity, { productId, variantId });
      const items = await listWishlist(ctx.shop.id, identity);
      
      // Sync to customer metafield if customer is logged in (persists after app uninstall)
      if (identity.customerId) {
        try {
          await syncWishlistToMetafield(admin, identity.customerId, items);
        } catch (e) {
          console.warn("Failed to sync wishlist to metafield on delete:", e);
          // Don't fail the request if metafield sync fails
        }
      }
      
      return json({ ok: true, removed, inWishlist: false, count: items.length });
    }

    if (method !== "POST" && method !== "PUT") {
      throw new ProxyError(405, "Method not allowed", "method_not_allowed");
    }

    const item = await addToWishlist(ctx.shop.id, identity, {
      productId,
      variantId,
      handle: body.handle || null,
    });
    // If the client didn't supply a handle, try to resolve it from the Admin API
    // so the storefront can enrich wishlist items (images/titles) via /products/{handle}.js.
    if (!item.handle) {
      try {
        const products = await getProductsByIds(admin, [item.productId]);
        const product = products.get(item.productId);
        if (product && product.handle) {
          await db.wishlistItem.update({ where: { id: item.id }, data: { handle: product.handle } });
          // reflect the saved handle in the returned item
          item.handle = product.handle;
        }
      } catch (e) {
        // ignore — enrichment is best-effort and shouldn't block the save
      }
    }
    const items = await listWishlist(ctx.shop.id, identity);
    
    // Sync to customer metafield if customer is logged in (persists after app uninstall)
    if (identity.customerId) {
      try {
        await syncWishlistToMetafield(admin, identity.customerId, items);
      } catch (e) {
        console.warn("Failed to sync wishlist to metafield on add:", e);
        // Don't fail the request if metafield sync fails
      }
    }
    
    return json({ ok: true, inWishlist: true, item: serialiseItem(item), count: items.length });
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * Resolves who is asking, and folds a guest wishlist into the customer's on first
 * authenticated request after login. Also syncs to metafield for persistence.
 */
async function resolveIdentity(
  shopId: string,
  loggedInCustomerId: string | null,
  guestToken: string | null,
  admin: GraphqlClient,
): Promise<Identity> {
  const identity = requireIdentity({ customerId: loggedInCustomerId, guestToken });
  
  if (identity.customerId && identity.guestToken) {
    await mergeGuestWishlist(shopId, identity.guestToken, identity.customerId);
    
    // Sync merged wishlist to metafield so it persists after app uninstall
    try {
      const items = await listWishlist(shopId, identity);
      await syncWishlistToMetafield(admin, identity.customerId, items);
    } catch (e) {
      console.warn("Failed to sync merged wishlist to metafield:", e);
      // Don't fail identity resolution if metafield sync fails
    }
  }
  
  return { customerId: identity.customerId, guestToken: identity.guestToken };
}

function serialiseItem(item: WishlistItem) {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    handle: item.handle || null,
    createdAt: item.createdAt.toISOString(),
  };
}

/** Adds title/image/price/availability so the storefront can render without extra calls. */
async function enrich(admin: GraphqlClient, items: WishlistItem[]) {
  const products = await getProductsByIds(
    admin,
    Array.from(new Set(items.map((item) => item.productId))),
  );

  return items
    .map((item) => {
      const product = products.get(item.productId);
      if (!product || product.status !== "ACTIVE") return null;
      const variant =
        product.variants.find((candidate) => candidate.variantId === item.variantId) ||
        product.variants[0];
      return {
        ...serialiseItem(item),
        title: product.title,
        handle: product.handle,
        url: product.onlineStoreUrl
          ? `${product.onlineStoreUrl}${variant ? `?variant=${variant.variantId}` : ""}`
          : `/products/${product.handle}${variant ? `?variant=${variant.variantId}` : ""}`,
        image: variant?.imageUrl || product.imageUrl,
        variantId: variant?.variantId ?? item.variantId,
        variantTitle: variant && variant.title !== "Default Title" ? variant.title : null,
        price: formatMoney(variant?.price ?? product.minPrice, product.currencyCode),
        available: variant ? variant.availableForSale : product.availableForSale,
      };
    })
    .filter(Boolean);
}
