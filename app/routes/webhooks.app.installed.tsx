import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { restoreWishlistsFromMetafields } from "../lib/wishlist-restore.server";
import { getOrCreateShop } from "../lib/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // On app install/reinstall, restore wishlists from customer metafields
  if ((topic === "APP_INSTALLED" || topic === "app/installed") && admin) {
    try {
      const shopRecord = await getOrCreateShop(shop, session?.accessToken);
      const result = await restoreWishlistsFromMetafields(shopRecord.id, admin);
      console.log(
        `Restored wishlists for ${result.restored} customers with ${result.errors} errors`,
      );
    } catch (error) {
      console.error("Failed to restore wishlists on app install:", error);
      // Don't fail the webhook; restoration is non-critical
    }
  }

  return new Response();
};
