import type { Shop } from "@prisma/client";
import { authenticate, unauthenticated } from "../shopify.server";
import { ProxyError, verifyAppProxySignature } from "./proxy.server";
import { requireShop } from "./shop.server";
import type { GraphqlClient } from "./shopify-data.server";

export type ProxyContext = {
  url: URL;
  shopDomain: string;
  shop: Shop;
  /** Shopify-signed customer id — trustworthy, unlike anything in the request body. */
  loggedInCustomerId: string | null;
  admin: () => Promise<GraphqlClient>;
};

/**
 * Guards every public storefront endpoint.
 *
 * 1. Verifies the App Proxy HMAC ourselves (`signature` query param) — an unsigned or
 *    tampered request never reaches any handler.
 * 2. Delegates to `authenticate.public.appProxy`, which re-checks the signature and
 *    loads the shop's offline session.
 *
 * `logged_in_customer_id` is part of the signed payload, so a shopper cannot claim to be
 * another customer by editing the request.
 */
export async function authenticateProxyRequest(request: Request): Promise<ProxyContext> {
  const url = new URL(request.url);

  if (!verifyAppProxySignature(url)) {
    throw new ProxyError(401, "Invalid app proxy signature", "invalid_signature");
  }

  await authenticate.public.appProxy(request);

  const shopDomain = url.searchParams.get("shop");
  if (!shopDomain) throw new ProxyError(400, "Missing shop parameter", "missing_shop");

  const shop = await requireShop(shopDomain);
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id") || null;

  let cached: GraphqlClient | null = null;
  return {
    url,
    shopDomain,
    shop,
    loggedInCustomerId,
    admin: async () => {
      if (!cached) {
        const { admin } = await unauthenticated.admin(shopDomain);
        cached = admin as unknown as GraphqlClient;
      }
      return cached;
    },
  };
}
