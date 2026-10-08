import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { errorResponse, clientIp } from "../lib/proxy.server";
import { readShareToken } from "../lib/wishlist-share.server";
import { rateLimit } from "../lib/rate-limit.server";
import db from "../db.server";
import { getProductsByIds, formatMoney } from "../lib/shopify-data.server";
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const ctx = await authenticateProxyRequest(request);
    await rateLimit({ key: `wishlist-share-read:${ctx.shop.id}:${clientIp(request)}`, limit: 60, windowSeconds: 60, shopId: ctx.shop.id });
    const customerId = readShareToken(params.token || "", ctx.shop.id);
    const items = await db.wishlistItem.findMany({ where: { shopId: ctx.shop.id, customerId }, select: { productId: true, variantId: true }, take: 250, orderBy: { createdAt: "desc" } });
    const products = await getProductsByIds(await ctx.admin(), [...new Set(items.map((item) => item.productId))]);
    const cards = items.map((item) => {
      const product = products.get(item.productId);
      if (!product || product.status !== "ACTIVE" || !product.onlineStoreUrl) return '';
      const variant = product.variants.find((v) => v.variantId === item.variantId) || product.variants[0];
      const image = variant?.imageUrl || product.imageUrl;
      const href = `/products/${encodeURIComponent(product.handle)}${variant ? `?variant=${encodeURIComponent(variant.variantId)}` : ''}`;
      return `<article><a href="${escape(href)}">${image && /^https:\/\//.test(image) ? `<img loading="lazy" src="${escape(image)}" alt="${escape(product.title)}" style="width:100%;height:240px;object-fit:contain">` : ''}<h2>${escape(product.title)}</h2></a><p>${escape(formatMoney(variant?.price ?? product.minPrice, product.currencyCode) || "")}</p><a href="${escape(href)}">View product</a></article>`;
    }).join('');
    const html = `<section style="max-width:1200px;margin:40px auto;padding:20px"><h1>Shared Wishlist</h1><p>View products from this wishlist. Only its owner can edit it.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px">${cards || '<p>This wishlist has no available products.</p>'}</div></section>`;
    // Encode Liquid delimiters in merchant content before Shopify renders it.
    return new Response(html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;'), { headers: { "Content-Type": "application/liquid; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
