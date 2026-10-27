import type { LoaderFunctionArgs } from "@remix-run/node";
import { ProxyError } from "../lib/proxy.server";
import { escapeHtml } from "../lib/notifications/template.server";
import { withProxy } from "../lib/proxy-route.server";
import { readShareToken } from "../lib/wishlist-share.server";
import db from "../db.server";
import { identityWhere } from "../models/wishlist.server";
import { wishlistFeatures } from "../models/wishlist-lists.server";
import { getProductsByIds, formatMoney } from "../lib/shopify-data.server";
import { getUIConfigByShopDomain } from "../models/ui-config.server";
import { randomUUID } from "node:crypto";

export async function loader({ request, params }: LoaderFunctionArgs) {
  return withProxy(
    request,
    { limit: { name: "wishlist-share-read", limit: 60, windowSeconds: 60 } },
    async (ctx) => {
      const shared = readShareToken(params.token || "", ctx.shop.id);
      const [features, items, uiConfig] = await Promise.all([
        wishlistFeatures(ctx.shop.id),
        db.wishlistItem.findMany({
          where: {
            ...identityWhere(ctx.shop.id, shared),
            ...(shared.listName ? { listName: shared.listName } : {}),
          },
          select: { productId: true, variantId: true },
          take: 250,
          orderBy: { createdAt: "desc" },
        }),
        getUIConfigByShopDomain(ctx.shop.shop),
      ]);
      if (features.allowShare === false)
        throw new ProxyError(
          403,
          "Wishlist sharing is disabled.",
          "sharing_disabled",
        );

      const shopperCookie = request.headers
        .get("cookie")
        ?.split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith("ws_shopper_id="))
        ?.slice("ws_shopper_id=".length);
      const cookieShopperId = shopperCookie
        ? decodeURIComponent(shopperCookie)
        : null;
      const validCookieShopperId =
        cookieShopperId && /^[\w-]{16,64}$/.test(cookieShopperId)
          ? cookieShopperId
          : null;
      const shopperId =
        ctx.loggedInCustomerId ?? validCookieShopperId ?? randomUUID();
      const sharedProductIds = [
        ...new Set(items.map((item) => item.productId)),
      ];
      await db.trackingEvent
        .create({
          data: {
            shopId: ctx.shop.id,
            shopperId,
            customerId: ctx.loggedInCustomerId ?? undefined,
            type: "WISHLIST_SHARE_VISIT",
            channel: "link",
            meta: {
              ...(shared.shareId ? { shareId: shared.shareId } : {}),
              productIds: sharedProductIds,
            },
          },
        })
        .catch((error) => {
          console.error("Failed to track shared wishlist visit", error);
        });

      const products = await getProductsByIds(await ctx.admin(), [
        ...new Set(items.map((item) => item.productId)),
      ]);

      const card = uiConfig?.productCardConfig || {};
      const showTitle = card.displayTitle !== false;
      const showPrice = card.displayPrice !== false;
      const showImage = card.displayImage !== false;
      const showSku = card.displaySKU === true;
      const showVariant = card.displayVariant !== false;

      let count = 0;
      const cards = items
        .map((item) => {
          const product = products.get(item.productId);
          if (!product || product.status !== "ACTIVE") return "";
          count += 1;
          const variant =
            product.variants.find((v) => v.variantId === item.variantId) ||
            product.variants.find((v) => v.availableForSale) ||
            product.variants[0];
          const image = variant?.imageUrl || product.imageUrl;
          const href = `/products/${encodeURIComponent(product.handle)}${variant ? `?variant=${encodeURIComponent(variant.variantId)}` : ""}`;
          const titleLine = showTitle
            ? `<p class="ws-page-card__title"><a href="${escapeHtml(href)}">${escapeHtml(product.title)}</a></p>`
            : "";
          const variantLine =
            showVariant &&
            variant &&
            variant.title &&
            variant.title !== "Default Title"
              ? `<p class="ws-page-card__variant">${escapeHtml(variant.title)}</p>`
              : "";
          const skuLine =
            showSku && variant?.sku
              ? `<p class="ws-page-card__sku">SKU: ${escapeHtml(variant.sku)}</p>`
              : "";
          const priceLine = showPrice
            ? `<p class="ws-page-card__price">${escapeHtml(formatMoney(variant?.price ?? product.minPrice, product.currencyCode) || "")}</p>`
            : "";
          const imageBox =
            showImage && image && /^https:\/\//.test(image)
              ? `<a class="ws-page-card__image" href="${escapeHtml(href)}"><img loading="lazy" src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" /></a>`
              : "";
          return `
      <div class="ws-page-card ws-page-card--row" data-product-id="${escapeHtml(product.productId)}" data-variant-id="${escapeHtml(variant?.variantId || "")}">
        ${imageBox}
        <div class="ws-page-card__body">
          ${titleLine}
          ${variantLine}
          ${skuLine}
          ${priceLine}
          <div class="ws-page-card__actions"><a class="ws-btn ws-btn--primary ws-btn--small" href="${escapeHtml(href)}">View product</a></div>
        </div>
      </div>`;
        })
        .filter(Boolean)
        .join("");

      const empty = `<div class="ws-page__empty"><svg class="ws-page__empty-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg><h2>No available products</h2><p>This wishlist has no available products.</p></div>`;
      const html = `<span id="ws-share-visit" hidden data-shopper-id="${escapeHtml(shopperId)}" data-share-id="${escapeHtml(shared.shareId || "")}"></span><section class="ws-page" style="max-width:1120px;margin:40px auto;padding:4px 20px 64px"><div class="ws-page__section"><div class="ws-page__section-head"><h2>Shared Wishlist</h2><span class="ws-page__count">${count ? `${count} item${count === 1 ? "" : "s"}` : ""}</span></div><div class="ws-page__grid ws-page__grid--rows">${cards || empty}</div></div></section>`;
      // Encode Liquid delimiters in merchant content before Shopify renders it.
      const headers = new Headers({
        "Content-Type": "application/liquid; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      });
      if (!ctx.loggedInCustomerId && !validCookieShopperId) {
        headers.append(
          "Set-Cookie",
          `ws_shopper_id=${encodeURIComponent(shopperId)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
        );
      }
      return new Response(
        html.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;"),
        { headers },
      );
    },
  );
}
