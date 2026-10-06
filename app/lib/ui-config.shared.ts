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

export type ThemeSettings = {
  wishlistPageUrl?: string;
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  borderColor?: string;
  borderRadius?: number;
  buttonStyle?: "filled" | "outlined";
};

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
  theme?: ThemeSettings;
};

export function defaultThemeSettings(): ThemeSettings {
  return {
    primaryColor: "#e74c3c",
    backgroundColor: "#ffffff",
    textColor: "#1a1a1a",
    mutedTextColor: "#6b7280",
    borderColor: "#e5e7eb",
    borderRadius: 8,
    buttonStyle: "filled",
  };
}

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
    theme: defaultThemeSettings(),
  };
}

export function normalizeWishlistThemeConfig(stored: unknown): ThemeSettings {
  const base = defaultThemeSettings();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return base;
  }

  const raw = stored as Record<string, unknown>;
  const normalized: ThemeSettings = { ...base };

  const primaryColor =
    typeof raw.primaryColor === "string" ? raw.primaryColor : undefined;
  const secondaryColor =
    typeof raw.secondaryColor === "string" ? raw.secondaryColor : undefined;
  const backgroundColor =
    typeof raw.backgroundColor === "string"
      ? raw.backgroundColor
      : secondaryColor;
  const textColor =
    typeof raw.textColor === "string" ? raw.textColor : undefined;
  const borderColor =
    typeof raw.borderColor === "string" ? raw.borderColor : undefined;

  if (primaryColor) normalized.primaryColor = primaryColor;
  if (backgroundColor) normalized.backgroundColor = backgroundColor;
  if (textColor) normalized.textColor = textColor;
  if (borderColor) normalized.borderColor = borderColor;

  const borderRadius =
    typeof raw.borderRadius === "number" ? raw.borderRadius : undefined;
  if (typeof borderRadius === "number") normalized.borderRadius = borderRadius;

  const buttonStyle = raw.buttonStyle;
  if (buttonStyle === "filled" || buttonStyle === "outlined") {
    normalized.buttonStyle = buttonStyle;
  }

  return normalized;
}

export function isExtensionActive(
  value: string | null | undefined,
): value is ExtensionActive {
  return (
    !!value && (EXTENSION_ACTIVE_VALUES as readonly string[]).includes(value)
  );
}

/** Merges a stored (partial) config over the defaults so callers always get every field. */
export function effectiveProductCardConfig(stored: unknown): ProductCardConfig {
  const base = defaultProductCardConfig();
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return base;
  const raw = stored as Record<string, unknown>;
  const merged = { ...base, ...raw } as ProductCardConfig;
  const normalizedTheme = normalizeWishlistThemeConfig(raw);

  if (raw.theme && typeof raw.theme === "object" && !Array.isArray(raw.theme)) {
    merged.theme = {
      ...normalizedTheme,
      ...defaultThemeSettings(),
      ...(raw.theme as Record<string, unknown>),
    } as ThemeSettings;
  } else {
    merged.theme = normalizedTheme;
  }

  return merged;
}
