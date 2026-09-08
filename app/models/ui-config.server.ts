import type { Prisma } from "@prisma/client";
import prisma from "app/db.server";
import {
  defaultProductCardConfig,
  defaultThemeSettings,
  effectiveProductCardConfig,
  isExtensionActive,
  type ExtensionActive,
  type ProductCardConfig,
  type ThemeSettings,
} from "../lib/ui-config.shared";

export type UIConfigView = {
  extensionActive: ExtensionActive;
  productCardConfig: ProductCardConfig;
  themeSettings: ThemeSettings;
};

export async function getUIConfigByShopDomain(
  shopDomain: string,
): Promise<UIConfigView | null> {
  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) return null;
  const config = await prisma.uIConfig.findUnique({ where: { shopId: shop.id } });
  if (!config) {
    return {
      extensionActive: "none",
      productCardConfig: defaultProductCardConfig(),
      themeSettings: defaultThemeSettings(),
    };
  }
  const themeSettings = effectiveThemeSettings(config.themeSettings);
  const productCardConfig = effectiveProductCardConfig(config.productCardConfig);
  if (themeSettings) productCardConfig.theme = themeSettings;
  return {
    extensionActive: isExtensionActive(config.extensionActive)
      ? config.extensionActive
      : "none",
    productCardConfig,
    themeSettings,
  };
}

export async function upsertUIConfigForShopDomain(
  shopDomain: string,
  data: {
    extensionActive?: ExtensionActive;
    productCardConfig?: Partial<ProductCardConfig>;
    themeSettings?: Partial<ThemeSettings>;
  },
): Promise<UIConfigView> {
  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) throw new Error("Shop not found");

  const existing = await prisma.uIConfig.findUnique({ where: { shopId: shop.id } });
  const currentExtensionActive = isExtensionActive(existing?.extensionActive)
    ? (existing.extensionActive as ExtensionActive)
    : "none";
  const currentConfig = effectiveProductCardConfig(existing?.productCardConfig);
  const currentTheme = effectiveThemeSettings(existing?.themeSettings);

  const extensionActive = isExtensionActive(data.extensionActive)
    ? (data.extensionActive as ExtensionActive)
    : currentExtensionActive;

  const productCardConfig: ProductCardConfig =
    data.productCardConfig === undefined
      ? currentConfig
      : { ...currentConfig, ...data.productCardConfig };

  const themeSettings: ThemeSettings =
    data.themeSettings === undefined
      ? currentTheme
      : { ...currentTheme, ...data.themeSettings };

  const upsertData: Prisma.UIConfigUpsertArgs = {
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      extensionActive,
      productCardConfig: productCardConfig as Prisma.InputJsonValue,
      themeSettings: themeSettings as Prisma.InputJsonValue,
    },
    update: {
      extensionActive,
      productCardConfig: productCardConfig as Prisma.InputJsonValue,
      themeSettings: themeSettings as Prisma.InputJsonValue,
    },
  } as any;

  const result = await prisma.uIConfig.upsert(upsertData as any);
  const resultTheme = effectiveThemeSettings(result.themeSettings);
  const resultConfig = effectiveProductCardConfig(result.productCardConfig);
  if (resultTheme) resultConfig.theme = resultTheme;
  return {
    extensionActive: isExtensionActive(result.extensionActive)
      ? (result.extensionActive as ExtensionActive)
      : "none",
    productCardConfig: resultConfig,
    themeSettings: resultTheme,
  };
}

export function effectiveThemeSettings(stored: unknown): ThemeSettings {
  const base = defaultThemeSettings();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  return { ...base, ...(stored as Record<string, unknown>) } as ThemeSettings;
}

export default { getUIConfigByShopDomain, upsertUIConfigForShopDomain };