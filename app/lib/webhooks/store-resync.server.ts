import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";

export async function withStoreAdmin(
  shopDomain: string,
  run: (
    admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
    shopId: string,
  ) => Promise<void>,
): Promise<void> {
  const shop = await db.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) return;
  const { admin } = await unauthenticated.admin(shopDomain);
  await run(admin, shop.id);
}
