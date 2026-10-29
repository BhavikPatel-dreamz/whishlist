import type { Plan, Shop, StockAlert } from "@prisma/client";
import { resolveSettingsForPlan } from "../shop.server";
import type { ShopContext, VariantSummary } from "../shopify-data.server";
import { formatMoney } from "../shopify-data.server";
import { sendEmail, sendSms, sendWhatsApp } from "./providers.server";
import {
  emailCountsTowardQuota,
  planAllowsSmsWhatsApp,
} from "../billing/plan.server";
import { backInStockHtml, backInStockText, render } from "./template.server";
import type { BackInStockSettings } from "../ui-config.shared";
import {
  holdAlertForQuota,
  markAlertFailed,
  markAlertSent,
} from "../../models/stock-alert.server";
import {
  consumeNotification,
  releaseNotification,
  reserveNotification,
} from "../billing/usage.server";
import { recordRestockNotificationLog } from "../../models/notification-log.server";
import {
  alertTrackingUrl,
  alertUnsubscribeUrl,
  cartPermalink,
  emailLogoUrl,
} from "./notification-urls.server";
import db from "../../db.server";

function normalizeEmailTemplate(template: string): string {
  return template.replace(/\{\{+\s*Title\s*\}\}+/gi, "{{ product_title }}");
}

export type DeliverContext = {
  plan: Plan;
  settings: ReturnType<typeof resolveSettingsForPlan>;
  backInStockSettings?: Partial<BackInStockSettings>;
  variant: VariantSummary;
  shopContext: ShopContext;
  /** When set, record EmailDeliveryAttempt against this job. */
  notificationJobId?: string;
  attemptNumber?: number;
};

export type DeliverOutcome = "sent" | "failed" | "held" | "timeout_ambiguous";

/**
 * Single-alert delivery shared by inline webhook dispatch and SQS workers.
 */
export async function deliverOne(
  alert: StockAlert,
  ctx: DeliverContext,
): Promise<DeliverOutcome> {
  const { plan, settings, backInStockSettings, variant, shopContext } = ctx;
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

  if (alert.channel === "email" && !settings.emailAlertsEnabled) {
    await holdAlertForQuota(alert.id, "Email alerts are turned off");
    return "held";
  }
  if (alert.channel === "sms" || alert.channel === "whatsapp") {
    if (!planAllowsSmsWhatsApp(plan.code)) {
      await holdAlertForQuota(
        alert.id,
        "SMS and WhatsApp are available on the Scale plan",
      );
      return "held";
    }
  }
  if (alert.channel === "sms" && !settings.smsEnabled) {
    await holdAlertForQuota(alert.id, "SMS alerts are turned off");
    return "held";
  }
  if (alert.channel === "whatsapp" && !settings.whatsappEnabled) {
    await holdAlertForQuota(alert.id, "WhatsApp alerts are turned off");
    return "held";
  }

  // Idempotent: prior successful attempt with provider message id → do not resend.
  if (ctx.notificationJobId) {
    const prior = await db.emailDeliveryAttempt.findFirst({
      where: {
        notificationJobId: ctx.notificationJobId,
        outcome: "success",
      },
      select: { id: true, providerMessageId: true },
    });
    if (prior) {
      await markAlertSent(alert.id);
      return "sent";
    }
  }

  const countsTowardQuota =
    alert.channel === "email" &&
    settings.emailAlertsEnabled &&
    emailCountsTowardQuota(plan, {
      provider: settings.provider,
      usesMerchantEmailProvider: settings.usesMerchantEmailProvider,
    });
  let reserved = false;
  if (countsTowardQuota) {
    const slot = await reserveNotification({
      shopId: alert.shopId,
      stockAlertId: alert.id,
      notifyGeneration: alert.notifyGeneration,
      plan,
    });
    if (slot === "exceeded") {
      await holdAlertForQuota(alert.id);
      return "held";
    }
    if (slot === "already_consumed") {
      await markAlertSent(alert.id);
      return "sent";
    }
    reserved = true;
  }

  const textBody = `${variant.productTitle} is back in stock at ${shopContext.name}. ${actionUrl} Cancel: ${alertUnsubscribeUrl(alert.id)}`;
  const provider = settings.provider || "mailgun";
  const attemptNumber = ctx.attemptNumber ?? alert.attempts;

  let result: Awaited<ReturnType<typeof sendEmail>>;
  let outcome: DeliverOutcome = "failed";
  try {
    result =
      alert.channel === "sms"
        ? alert.phone
          ? await sendSms(settings, alert.phone, textBody)
          : { ok: false as const, error: "No phone number configured for this SMS alert" }
        : alert.channel === "whatsapp"
          ? alert.phone
            ? await sendWhatsApp(settings, alert.phone, textBody)
            : {
                ok: false as const,
                error: "No phone number configured for this WhatsApp alert",
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /timeout|ETIMEDOUT|AbortError/i.test(message);
    outcome = isTimeout ? "timeout_ambiguous" : "failed";
    if (ctx.notificationJobId) {
      await db.emailDeliveryAttempt.create({
        data: {
          notificationJobId: ctx.notificationJobId,
          provider,
          attemptNumber,
          outcome,
          errorMessage: message.slice(0, 500),
        },
      });
    }
    if (reserved) await releaseNotification(alert.id, alert.notifyGeneration);
    if (outcome === "timeout_ambiguous") {
      // Do not mark failed yet — provider may have accepted; worker retries carefully.
      return "timeout_ambiguous";
    }
    await markAlertFailed(alert.id, message, alert.attempts);
    await recordRestockNotificationLog({
      alert,
      status: "failed",
      errorReason: message,
    }).catch(() => {});
    return "failed";
  }

  if (!result.ok) {
    const throttled = /rate|throttl|429|too many/i.test(result.error);
    outcome = throttled ? "failed" : "failed";
    if (ctx.notificationJobId) {
      await db.emailDeliveryAttempt.create({
        data: {
          notificationJobId: ctx.notificationJobId,
          provider,
          attemptNumber,
          outcome: throttled ? "throttled" : "failed",
          errorMessage: result.error.slice(0, 500),
          httpStatus: throttled ? 429 : undefined,
        },
      });
    }
    if (reserved) await releaseNotification(alert.id, alert.notifyGeneration);
    await markAlertFailed(alert.id, result.error, alert.attempts);
    await recordRestockNotificationLog({
      alert,
      status: "failed",
      errorReason: result.error,
    }).catch(() => {});
    return "failed";
  }

  if (ctx.notificationJobId) {
    await db.emailDeliveryAttempt.create({
      data: {
        notificationJobId: ctx.notificationJobId,
        provider,
        attemptNumber,
        outcome: "success",
        providerMessageId: result.id ?? null,
      },
    });
  }

  if (reserved) await consumeNotification(alert.id, alert.notifyGeneration);
  await markAlertSent(alert.id);
  await recordRestockNotificationLog({
    alert,
    status: "sent",
  }).catch(() => {});
  return "sent";
}

/** Build deliver context from shop + plan for workers. */
export function buildDeliverSettings(
  shop: Shop,
  plan: Plan,
  backInStockSettings?: Partial<BackInStockSettings>,
): Pick<DeliverContext, "plan" | "settings" | "backInStockSettings"> {
  const settings = resolveSettingsForPlan(shop, plan);
  if (backInStockSettings?.from?.trim()) {
    settings.senderName = backInStockSettings.from.trim();
  }
  return { plan, settings, backInStockSettings };
}
