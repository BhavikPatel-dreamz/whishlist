/**
 * Client-safe UI config definitions.
 *
 * No server-only imports here (no Prisma) so route components can import the
 * type + default values without pulling Prisma into the client bundle.
 * ui-config.server.ts re-uses these and adds the Prisma persistence layer.
 */

export const EXTENSION_ACTIVE_VALUES = [
  "none",
  "wishlist",
  "back_in_stock",
  "both",
] as const;

export type ExtensionActive = (typeof EXTENSION_ACTIVE_VALUES)[number];

export const PRODUCT_CARD_LAYOUTS = [
  "grid",
  "list",
  "horizontal",
  "compact",
] as const;

export type ProductCardLayout = (typeof PRODUCT_CARD_LAYOUTS)[number];

export const PRODUCT_CARD_IMAGE_SIZES = ["small", "medium", "large"] as const;
export type ProductCardImageSize = (typeof PRODUCT_CARD_IMAGE_SIZES)[number];

export type ProductCardConfig = {
  displayTitle?: boolean;
  displayPrice?: boolean;
  displaySKU?: boolean;
  displayImage?: boolean;
  displayVariant?: boolean;
  imageSize?: ProductCardImageSize;
  layout?: ProductCardLayout;
  showAddToCart?: boolean;
  showWishlistButton?: boolean;
  showBackInStockButton?: boolean;
  customStyles?: Record<string, string> | null;
};

export function defaultProductCardConfig(): ProductCardConfig {
  return {
    displayTitle: true,
    displayPrice: true,
    displaySKU: false,
    displayImage: true,
    displayVariant: true,
    imageSize: "medium",
    layout: "horizontal",
    showAddToCart: true,
    showWishlistButton: true,
    showBackInStockButton: false,
    customStyles: null,
  };
}

export function isExtensionActive(
  value: string | null | undefined,
): value is ExtensionActive {
  return !!value && (EXTENSION_ACTIVE_VALUES as readonly string[]).includes(value);
}

/** Merges a stored (partial) config over the defaults so callers always get every field. */
export function effectiveProductCardConfig(
  stored: unknown,
): ProductCardConfig {
  const base = defaultProductCardConfig();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  return { ...base, ...(stored as Record<string, unknown>) } as ProductCardConfig;
}