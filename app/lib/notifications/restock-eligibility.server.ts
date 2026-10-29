import type { Shop } from "@prisma/client";
import type { VariantSummary } from "../shopify-data.server";
import { getUIConfigRow } from "../../models/ui-config.server";
import type { BackInStockSettings } from "../ui-config.shared";

export type RestockEligibility = {
  ok: true;
  backInStockSettings?: Partial<BackInStockSettings>;
  minimumQuantity: number;
} | {
  ok: false;
  reason: string;
};

/**
 * Shared purchasability / feature / min-qty gates used by inline dispatch and enqueue.
 */
export async function checkRestockEligibility(
  shop: Pick<Shop, "id">,
  variant: VariantSummary,
): Promise<RestockEligibility> {
  if (!variant.availableForSale || variant.sellableOnlineQuantity <= 0) {
    return { ok: false, reason: "variant not purchasable" };
  }
  if (variant.productStatus !== "ACTIVE") {
    return { ok: false, reason: "product not active" };
  }

  const uiConfig = await getUIConfigRow(shop.id);
  const rawProductConfig = uiConfig?.productCardConfig;
  const productConfig =
    rawProductConfig &&
    typeof rawProductConfig === "object" &&
    !Array.isArray(rawProductConfig)
      ? (rawProductConfig as Record<string, unknown>)
      : {};
  if (productConfig.backInStockEnabled === false) {
    return { ok: false, reason: "back-in-stock feature disabled" };
  }

  const rawBackInStockSettings = productConfig.backInStockSettings;
  const backInStockSettings =
    rawBackInStockSettings &&
    typeof rawBackInStockSettings === "object" &&
    !Array.isArray(rawBackInStockSettings)
      ? (rawBackInStockSettings as Partial<BackInStockSettings>)
      : undefined;

  const configuredMinimumQuantity = Number(
    backInStockSettings?.minimumQuantity,
  );
  const minimumQuantity =
    Number.isInteger(configuredMinimumQuantity) &&
    configuredMinimumQuantity >= 0
      ? configuredMinimumQuantity
      : 1;

  if (variant.sellableOnlineQuantity < minimumQuantity) {
    return { ok: false, reason: "below minimum stock threshold" };
  }

  return { ok: true, backInStockSettings, minimumQuantity };
}
