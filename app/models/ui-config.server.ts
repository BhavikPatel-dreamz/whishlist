import type { Prisma } from "@prisma/client";
import prisma from "app/db.server";
import {
  defaultProductCardConfig,
  effectiveProductCardConfig,
  isExtensionActive,
  type ExtensionActive,
  type ProductCardConfig,
} from "../lib/ui-config.shared";

export type UIConfigView = {
  extensionActive: ExtensionActive;
  productCardConfig: ProductCardConfig;
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
    };
  }
  return {
    extensionActive: isExtensionActive(config.extensionActive)
      ? config.extensionActive
      : "none",
    productCardConfig: effectiveProductCardConfig(config.productCardConfig),
  };
}

export async function upsertUIConfigForShopDomain(
  shopDomain: string,
  data: {
    extensionActive?: ExtensionActive;
    productCardConfig?: Partial<ProductCardConfig>;
  },
): Promise<UIConfigView> {
  const shop = await prisma.shop.findUnique({ where: { shop: shopDomain } });
  if (!shop) throw new Error("Shop not found");

  const existing = await prisma.uIConfig.findUnique({ where: { shopId: shop.id } });
  const currentExtensionActive = isExtensionActive(existing?.extensionActive)
    ? (existing.extensionActive as ExtensionActive)
    : "none";
  const currentConfig = effectiveProductCardConfig(existing?.productCardConfig);

  const extensionActive = isExtensionActive(data.extensionActive)
    ? (data.extensionActive as ExtensionActive)
    : currentExtensionActive;

  const productCardConfig: ProductCardConfig =
    data.productCardConfig === undefined
      ? currentConfig
      : { ...currentConfig, ...data.productCardConfig };

  const upsertData: Prisma.UIConfigUpsertArgs = {
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      extensionActive,
      productCardConfig: productCardConfig as Prisma.InputJsonValue,
    },
    update: {
      extensionActive,
      productCardConfig: productCardConfig as Prisma.InputJsonValue,
    },
  } as any;

  const result = await prisma.uIConfig.upsert(upsertData as any);
  return {
    extensionActive: isExtensionActive(result.extensionActive)
      ? (result.extensionActive as ExtensionActive)
      : "none",
    productCardConfig: effectiveProductCardConfig(result.productCardConfig),
  };
}

export default { getUIConfigByShopDomain, upsertUIConfigForShopDomain };