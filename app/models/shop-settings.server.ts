import db from "../db.server";
import type { ShopSettings } from "@prisma/client";

/**
 * Per-store analytics settings. The row is created on first use so a store
 * never has to be configured before its reports work.
 */
export const DEFAULT_SHOP_SETTINGS = {
  wishlistWindowDays: 14,
  restockWindowDays: 7,
  abandonedAfterDays: 30,
  lowStockThreshold: 5,
  timezone: "UTC",
  weeklyReportEmail: false,
} as const;

export type ResolvedShopSettings = {
  wishlistWindowDays: number;
  restockWindowDays: number;
  abandonedAfterDays: number;
  lowStockThreshold: number;
  timezone: string;
  weeklyReportEmail: boolean;
};

export async function getShopSettings(
  shopId: string,
): Promise<ResolvedShopSettings> {
  let stored: ShopSettings | null = null;
  try {
    stored = await db.shopSettings.findUnique({ where: { shopId } });
  } catch {
    // The settings table may not exist yet on a store that was installed before
    // the analytics migration — the defaults still produce a usable report.
    return { ...DEFAULT_SHOP_SETTINGS };
  }
  if (!stored) return { ...DEFAULT_SHOP_SETTINGS };
  return {
    wishlistWindowDays: stored.wishlistWindowDays,
    restockWindowDays: stored.restockWindowDays,
    abandonedAfterDays: stored.abandonedAfterDays,
    lowStockThreshold: stored.lowStockThreshold,
    timezone: stored.timezone,
    weeklyReportEmail: stored.weeklyReportEmail,
  };
}

/** Creates the settings row for a store if it does not exist yet. */
export async function ensureShopSettings(shopId: string): Promise<void> {
  try {
    await db.shopSettings.upsert({
      where: { shopId },
      create: { shopId },
      update: {},
    });
  } catch {
    // Ignore — the defaults are used when the row is missing.
  }
}
