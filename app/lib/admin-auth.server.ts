import { authenticate } from "../shopify.server";
import { requireShop } from "./shop.server";

/**
 * Shared admin-route preamble: authenticates the embedded request and loads the
 * shop row, so every admin loader/action starts the same way.
 */
export async function requireAdminShop(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  return { session, admin, shop };
}
