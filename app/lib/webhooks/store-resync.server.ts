import db from "../../db.server";
import { unauthenticated } from "../../shopify.server";

export async function withStoreAdmin(
  shopDomain: string,
  run: (
    admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
    storeId: string,
  ) => Promise<void>,
): Promise<void> {
  const store = await db.store.findUnique({ where: { shopDomain } });
  if (!store) return;
  const { admin } = await unauthenticated.admin(shopDomain);
  await run(admin, store.id);
}
