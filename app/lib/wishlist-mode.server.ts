import { ProxyError } from "./proxy.server";

/** Multi-wishlist activation is explicit and permanent for this store. */
export function enforceWishlistMode(current: unknown, requested: unknown, confirmation?: string) {
  if (current === "multi") {
    if (requested != null && requested !== "multi") {
      throw new ProxyError(409, "Multi-Wishlist is already enabled. Switching back to Single Wishlist is not available.", "wishlist_mode_locked");
    }
    return "multi" as const;
  }
  if (requested === "multi") {
    if (confirmation !== "ENABLE") {
      throw new ProxyError(422, 'Type "ENABLE" to switch to Multi-Wishlist.', "wishlist_confirmation_required");
    }
    return "multi" as const;
  }
  return "single" as const;
}
