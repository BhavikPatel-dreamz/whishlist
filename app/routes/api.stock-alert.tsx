import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  ProxyError,
  assertEmail,
  json,
  numericId,
  readBody,
} from "../lib/proxy.server";
import { withProxy } from "../lib/proxy-route.server";
import { getVariantsByIds } from "../lib/shopify-data.server";
import { alertConfirmUrl, alertUnsubscribeUrl } from "../lib/notifications/dispatch.server";
import { sendEmail, sendSms } from "../lib/notifications/providers.server";
import {
  confirmationEmailHtml,
  confirmationEmailText,
} from "../lib/notifications/template.server";
import { resolveSettings } from "../lib/shop.server";
import db from "../db.server";
import { getUIConfigByShopId } from "../models/ui-config.server";
import {
  ALERT_STATUS,
  cancelStockAlert,
  createStockAlert,
  stockAlertContactKey,
  type AlertChannel,
} from "../models/stock-alert.server";

/** GET /apps/wishlist-stock/api/stock-alert?variantId=… — is this shopper already waiting? */
export const loader = async ({ request }: LoaderFunctionArgs) =>
  withProxy(
    request,
    { limit: { name: "alert-read", limit: 60, windowSeconds: 60 } },
    async (ctx) => {
    const variantId = numericId(ctx.url.searchParams.get("variantId"));
    const channel: AlertChannel = ctx.url.searchParams.get("channel") === "sms" ? "sms" : "email";
    const email = channel === "email" ? assertEmail(ctx.url.searchParams.get("email") ?? undefined) : null;
    const phone = channel === "sms" ? sanitisePhone(ctx.url.searchParams.get("phone") || undefined) : null;
    const contact = email || phone;
    if (!variantId || !contact) throw new ProxyError(422, "variantId and a valid contact are required", "missing_params");

    const alert = await db.stockAlert.findUnique({
      where: {
        one_alert_per_contact_variant: {
          shopId: ctx.shop.id,
          variantId,
          contactKey: stockAlertContactKey(channel, contact),
        },
      },
      select: { status: true, createdAt: true },
    });

    return json({
      ok: true,
      // "On the list" spans the whole live lifecycle: awaiting opt-in (PENDING), confirmed
      // and waiting (CONFIRMED), or mid-send (SENDING). Omitting CONFIRMED reported a
      // double-opt-in shopper who *had* confirmed as not subscribed.
      subscribed:
        alert?.status === ALERT_STATUS.pending ||
        alert?.status === ALERT_STATUS.confirmed ||
        alert?.status === ALERT_STATUS.sending,
      status: alert?.status ?? null,
    });
    },
  );

/** POST subscribes, DELETE unsubscribes. */
export const action = async ({ request }: ActionFunctionArgs) =>
  withProxy(
    request,
    {
      // Two windows: a burst guard and an hourly cap, so one visitor cannot turn the
      // waitlist form into an email cannon.
      limit: { name: "alert-write", limit: 5, windowSeconds: 60, message: "Too many requests. Please wait a minute and try again." },
      extraLimits: [{ name: "alert-write-hour", limit: 20, windowSeconds: 3600, message: "Too many alert sign-ups from this device today." }],
    },
    async (ctx) => {
    const body = await readBody(request);
    const method = (body._method || request.method).toUpperCase();

    // Honeypot field rendered hidden in the storefront form; only bots fill it in.
    if (body.website) return json({ ok: true, subscribed: true });

    const channel: AlertChannel = body.channel === "sms" ? "sms" : "email";
    const email = channel === "email" ? assertEmail(body.email) : null;
    const phone = channel === "sms" ? sanitisePhone(body.phone) : null;
    const contact = email || phone;
    if (!contact) throw new ProxyError(422, "Enter a valid email or phone number", "missing_contact");
    const variantId = numericId(body.variantId);
    if (!variantId) throw new ProxyError(422, "variantId is required", "missing_variant");

    if (method === "DELETE") {
      const existing = await db.stockAlert.findUnique({
        where: {
          one_alert_per_contact_variant: {
            shopId: ctx.shop.id,
            variantId,
            contactKey: stockAlertContactKey(channel, contact),
          },
        },
        select: { id: true },
      });
      if (existing) await cancelStockAlert(existing.id);
      return json({ ok: true, subscribed: false });
    }

    if (method !== "POST") throw new ProxyError(405, "Method not allowed", "method_not_allowed");
    const uiConfig = await getUIConfigByShopId(ctx.shop.id);
    if (uiConfig?.productCardConfig.backInStockEnabled === false) {
      throw new ProxyError(403, "Back-in-stock alerts are currently disabled", "feature_disabled");
    }
    if (channel === "sms" && !ctx.shop.smsEnabled) {
      throw new ProxyError(422, "SMS alerts are not enabled for this store", "sms_disabled");
    }

    // Trust Shopify, not the form: confirm the variant exists and really is unavailable.
    const [variant] = await getVariantsByIds(await ctx.admin(), [variantId]);
    if (!variant) throw new ProxyError(404, "That product variant no longer exists", "unknown_variant");
    // Judge availability the way the storefront does: `sellableOnlineQuantity` is the
    // online-channel figure behind Liquid's `variant.available`. `inventoryQuantity` sums
    // ALL locations, so a product sold out online but stocked elsewhere (e.g. third-party
    // fulfillment) would otherwise be wrongly rejected here — and the alert never stored.
    if (variant.availableForSale && variant.sellableOnlineQuantity > 0) {
      return json(
        { ok: false, code: "already_available", message: "Good news — it's in stock right now." },
        { status: 409 },
      );
    }

    const { alert, created } = await createStockAlert({
      shopId: ctx.shop.id,
      channel,
      email,
      phone,
      customerId: ctx.loggedInCustomerId,
      productId: numericId(body.productId) || variant.productId,
      variantId,
      productTitle: variant.productTitle,
      variantTitle: variant.variantTitle,
      locale: body.locale || ctx.url.searchParams.get("locale"),
    });

    // Double opt-in: send a confirmation email so the subscriber must verify before alerts fire.
    // Keyed on the row still being PENDING rather than just `created`: a shopper who lost the first
    // email and signs up again (existing PENDING → created:false) still needs the link, or with
    // double opt-in on they'd stay unconfirmed forever and never receive the restock alert. An
    // already-CONFIRMED or in-flight SENDING row is not PENDING, so it is never re-sent.
    if (ctx.shop.doubleOptIn && alert.status === ALERT_STATUS.pending) {
      const settings = resolveSettings(ctx.shop);
      const confirmUrl = alertConfirmUrl(alert.id);
      const unsubscribeUrl = alertUnsubscribeUrl(alert.id);

      const confirmationResult = channel === "email"
        ? await sendEmail(settings, {
            to: email!,
            subject: `Confirm your alert for ${variant.productTitle}`,
            html: confirmationEmailHtml({ shopName: ctx.shopDomain, productTitle: variant.productTitle, variantTitle: variant.variantTitle, confirmUrl, unsubscribeUrl }),
            text: confirmationEmailText({ shopName: ctx.shopDomain, productTitle: variant.productTitle, variantTitle: variant.variantTitle, confirmUrl, unsubscribeUrl }),
          })
        : await sendSms(settings, phone!, `Confirm your back-in-stock alert for ${variant.productTitle}: ${confirmUrl} Cancel: ${unsubscribeUrl}`);
      if (!confirmationResult.ok) {
        console.error(`[double-opt-in] ${channel} confirmation failed:`, confirmationResult.error);
        return json(
          {
            ok: false,
            code: "confirmation_email_failed",
            message: "Your signup was saved, but we couldn't send the confirmation email. Please try again shortly.",
          },
          { status: 502 },
        );
      }
    }

    return json({
      ok: true,
      subscribed: true,
      created,
      alertId: alert.id,
      message:
        ctx.shop.doubleOptIn && alert.status === ALERT_STATUS.pending
          ? channel === "email" ? "Check your email to confirm your alert." : "Check your phone for a text to confirm your alert."
          : created
            ? "You're on the list. We'll email you the moment it's back."
            : "You're already on the list for this item.",
    });
    },
  );

function sanitisePhone(value: string | undefined): string | null {
  const phone = (value || "").replace(/[^\d+]/g, "");
  if (!phone) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new ProxyError(422, "Enter a phone number in international format, such as +14155550123", "invalid_phone");
  }
  return phone;
}
