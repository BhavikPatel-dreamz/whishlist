import type { Shop, StockAlert } from "@prisma/client";
import { resolveSettings } from "../shop.server";
import { appOrigin } from "../app-url.server";
import { signPayload } from "../crypto.server";
import {
  formatMoney,
  getVariantsByIds,
  type GraphqlClient,
  type ShopContext,
  type VariantSummary,
} from "../shopify-data.server";
import { sendEmail, sendSms } from "./providers.server";
import { backInStockHtml, backInStockText, render } from "./template.server";
import { getUIConfigRow } from "../../models/ui-config.server";
import type { BackInStockSettings } from "../ui-config.shared";
import {
  claimPendingAlerts,
  markAlertFailed,
  markAlertSent,
  reactivateFailedAlerts,
  variantIdsNeedingRetry,
} from "../../models/stock-alert.server";

const SEND_CONCURRENCY = 10;

export type DispatchResult = {
  variantId: string;
  claimed: number;
  sent: number;
  failed: number;
  skippedReason?: string;
};

export function alertTrackingUrl(alertId: string): string {
  const base = appOrigin();
  return `${base}/r/alert/${alertId}?sig=${signPayload(alertId)}`;
}

export function alertConfirmUrl(alertId: string): string {
  const base = appOrigin();
  return `${base}/r/confirm/${alertId}?sig=${signPayload(alertId)}`;
}

export function alertUnsubscribeUrl(alertId: string): string {
  const base = appOrigin();
  return `${base}/alerts/unsubscribe?id=${alertId}&sig=${signPayload(alertId)}`;
}

/**
 * Emails strip `data:` URL images, so an uploaded logo is served from this app instead.
 * External https logos are used as-is.
 */
export function emailLogoUrl(
  rawLogo: string | undefined,
  shopId: string,
): string | null {
  if (!rawLogo) return null;
  if (rawLogo.startsWith("data:")) {
    const base = appOrigin();
    return base ? `${base}/logo/${shopId}` : rawLogo;
  }
  return rawLogo;
}

/** Cart permalink: adds the variant and lands the shopper straight on the cart. */
export function cartPermalink(
  domain: string,
  variantId: string,
  alertId?: string,
): string {
  const base = `${domain.replace(/\/$/, "")}/cart/${variantId}:1`;
  if (!alertId) return base;
  const params = new URLSearchParams({
    "properties[_back_in_stock_alert]": `${alertId}.${signPayload(alertId)}`,
  });
  return `${base}?${params}`;
}

/**
 * Sends every pending alert for a variant that just came back in stock.
 * Safe to call repeatedly: `claimPendingAlerts` hands out each row exactly once.
 */
export async function dispatchRestockAlerts(params: {
  shop: Shop;
  variant: VariantSummary;
  shopContext: ShopContext;
}): Promise<DispatchResult> {
  const { shop, variant, shopContext } = params;
  const base: DispatchResult = {
    variantId: variant.variantId,
    claimed: 0,
    sent: 0,
    failed: 0,
  };

  // Only email "it's back!" when the shopper can actually buy it on the online store.
  // sellableOnlineQuantity is the online-channel figure; inventoryQuantity (all locations)
  // would fire alerts for stock the storefront can't sell.
  if (!variant.availableForSale || variant.sellableOnlineQuantity <= 0) {
    return { ...base, skippedReason: "variant not purchasable" };
  }
  if (variant.productStatus !== "ACTIVE") {
    return { ...base, skippedReason: "product not active" };
  }

  const uiConfig = await getUIConfigRow(shop.id);
  const rawProductConfig = uiConfig?.productCardConfig;
  const productConfig =
    rawProductConfig &&
    typeof rawProductConfig === "object" &&
    !Array.isArray(rawProductConfig)
      ? (rawProductConfig as Record<string, unknown>)
      : {};
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
    return { ...base, skippedReason: "below minimum stock threshold" };
  }

  const alerts = await claimPendingAlerts(
    shop.id,
    variant.variantId,
    500,
    shop.doubleOptIn,
  );
  if (!alerts.length) return { ...base, skippedReason: "no pending alerts" };

  const settings = resolveSettings(shop);
  if (backInStockSettings?.from?.trim())
    settings.senderName = backInStockSettings.from.trim();
  const price = formatMoney(
    variant.price,
    variant.currencyCode || shopContext.currencyCode,
  );
  const vars = {
    product_title: variant.productTitle,
    variant_title: variant.variantTitle,
    shop_name: shopContext.name,
    price: price || "",
    product_url:
      variant.onlineStoreUrl ||
      `${shopContext.domain}/products/${variant.productHandle}`,
    checkout_url: cartPermalink(shopContext.domain, variant.variantId),
  };

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < alerts.length; i += SEND_CONCURRENCY) {
    const batch = alerts.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((alert) =>
        deliver(alert, {
          settings,
          backInStockSettings,
          vars,
          variant,
          shopContext,
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) sent += 1;
      else {
        failed += 1;
        const alert = batch[index];
        const message =
          result.status === "rejected"
            ? String(result.reason).slice(0, 300)
            : "delivery reported failure";
        console.error(`[restock] alert ${alert.id} failed: ${message}`);
      }
    });
  }

  return { ...base, claimed: alerts.length, sent, failed };
}

async function deliver(
  alert: StockAlert,
  ctx: {
    settings: ReturnType<typeof resolveSettings>;
    backInStockSettings?: Partial<BackInStockSettings>;
    vars: Record<string, string>;
    variant: VariantSummary;
    shopContext: ShopContext;
  },
): Promise<boolean> {
  const { settings, backInStockSettings, vars, variant, shopContext } = ctx;
  const emailVars = { ...vars, customer_email: alert.email || "" };
  const actionUrl = alertTrackingUrl(alert.id);
  const subject = backInStockSettings?.subject
    ? normalizeEmailTemplate(backInStockSettings.subject)
    : settings.emailSubject;
  const heading = backInStockSettings?.headline
    ? normalizeEmailTemplate(backInStockSettings.headline)
    : settings.emailHeading;
  const buttonLabel =
    backInStockSettings?.emailButtonText || settings.buttonLabel;
  const replyTo =
    backInStockSettings?.replyTo &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(backInStockSettings.replyTo)
      ? backInStockSettings.replyTo
      : undefined;

  const payload = {
    heading: render(heading, emailVars),
    body: render(settings.emailBody, emailVars),
    buttonLabel: render(buttonLabel, emailVars),
    productTitle: variant.productTitle,
    variantTitle: variant.variantTitle,
    imageUrl: variant.imageUrl,
    price: vars.price || null,
    actionUrl,
    shopName: shopContext.name,
    unsubscribeUrl: alertUnsubscribeUrl(alert.id),
    footer: render(backInStockSettings?.footer || "", emailVars),
    logoUrl: emailLogoUrl(backInStockSettings?.logoUrl, alert.shopId),
    headerText: render(backInStockSettings?.headerText || "", emailVars),
  };

  const result =
    alert.channel === "sms"
      ? alert.phone
        ? await sendSms(
            settings,
            alert.phone,
            `${variant.productTitle} is back in stock at ${shopContext.name}. ${actionUrl} Cancel: ${alertUnsubscribeUrl(alert.id)}`,
          )
        : {
            ok: false as const,
            error: "No phone number configured for this SMS alert",
          }
      : alert.email
        ? await sendEmail(settings, {
            to: alert.email,
            subject: render(subject, emailVars),
            html: backInStockHtml(payload),
            text: backInStockText(payload),
            replyTo,
          })
        : {
            ok: false as const,
            error: "No email address configured for this email alert",
          };

  if (!result.ok) {
    await markAlertFailed(alert.id, result.error, alert.attempts);
    return false;
  }

  await markAlertSent(alert.id);
  return true;
}

function normalizeEmailTemplate(template: string): string {
  return template.replace(/\{\{+\s*Title\s*\}\}+/gi, "{{ product_title }}");
}

export type RetryResult = {
  variantsChecked: number;
  variantsDispatched: number;
  reactivated: number;
  sent: number;
  failed: number;
};

/**
 * Re-drives alerts a normal restock webhook would have handled but didn't: sends stranded by a
 * crash (recovered through `claimPendingAlerts`' stale-SENDING sweep), alerts left PENDING after a
 * failed attempt, and — when `includeFailed` — FAILED rows reactivated by an explicit manual retry.
 *
 * Purchasability is still decided inside `dispatchRestockAlerts`, so a variant that is *still* sold
 * out claims nothing and nobody is emailed. This adds no new send path; it only supplies a trigger
 * (admin button / cron) for the same dispatch the webhooks use.
 */
export async function retryStuckAlerts(params: {
  shop: Shop;
  admin: GraphqlClient;
  shopContext: ShopContext;
  includeFailed?: boolean;
}): Promise<RetryResult> {
  const { shop, admin, shopContext, includeFailed = false } = params;
  const result: RetryResult = {
    variantsChecked: 0,
    variantsDispatched: 0,
    reactivated: 0,
    sent: 0,
    failed: 0,
  };

  const variantIds = await variantIdsNeedingRetry(shop.id, { includeFailed });
  if (!variantIds.length) return result;
  result.variantsChecked = variantIds.length;

  if (includeFailed) {
    result.reactivated = await reactivateFailedAlerts(shop.id, variantIds);
  }

  // `nodes()` accepts up to 250 ids; chunk to stay comfortably under that.
  // Chunks run concurrently (bounded) so a large sweep doesn't crawl.
  const chunks: string[][] = [];
  for (let i = 0; i < variantIds.length; i += 100) chunks.push(variantIds.slice(i, i + 100));
  let nextChunk = 0;
  const workers = Array.from({ length: Math.min(3, chunks.length) }, async () => {
    while (nextChunk < chunks.length) {
      const chunk = chunks[nextChunk++];
      const variants = await getVariantsByIds(admin, chunk);
      for (const variant of variants) {
        const dispatched = await dispatchRestockAlerts({
          shop,
          variant,
          shopContext,
        });
        if (dispatched.claimed) {
          result.variantsDispatched += 1;
          result.sent += dispatched.sent;
          result.failed += dispatched.failed;
        }
      }
    }
  });
  await Promise.all(workers);

  return result;
}
