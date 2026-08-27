import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import {
  ProxyError,
  assertEmail,
  clientIp,
  errorResponse,
  json,
  numericId,
  readBody,
} from "../lib/proxy.server";
import { rateLimit } from "../lib/rate-limit.server";
import { getVariantsByIds } from "../lib/shopify-data.server";
import { signPayload } from "../lib/crypto.server";
import { sendEmail } from "../lib/notifications/providers.server";
import {
  confirmationEmailHtml,
  confirmationEmailText,
} from "../lib/notifications/template.server";
import { resolveSettings } from "../lib/shop.server";
import db from "../db.server";
import { ALERT_STATUS, cancelStockAlert, createStockAlert } from "../models/stock-alert.server";

/** GET /apps/wishlist-stock/api/stock-alert?variantId=… — is this shopper already waiting? */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const ctx = await authenticateProxyRequest(request);
    await rateLimit({
      key: `alert-read:${ctx.shopDomain}:${clientIp(request)}`,
      limit: 60,
      windowSeconds: 60,
      shopId: ctx.shop.id,
    });

    const variantId = numericId(ctx.url.searchParams.get("variantId"));
    const email = ctx.url.searchParams.get("email")?.trim().toLowerCase();
    if (!variantId || !email) {
      throw new ProxyError(422, "variantId and email are required", "missing_params");
    }

    const alert = await db.stockAlert.findUnique({
      where: {
        one_alert_per_email_variant: { shopId: ctx.shop.id, variantId, email },
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
  } catch (error) {
    return errorResponse(error);
  }
};

/** POST subscribes, DELETE unsubscribes. */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const ctx = await authenticateProxyRequest(request);
    const ip = clientIp(request);
    const body = await readBody(request);
    const method = (body._method || request.method).toUpperCase();

    // Two windows: a burst guard and an hourly cap, so one visitor cannot turn the
    // waitlist form into an email cannon.
    await rateLimit({
      key: `alert-write:${ctx.shopDomain}:${ip}`,
      limit: 5,
      windowSeconds: 60,
      shopId: ctx.shop.id,
      message: "Too many requests. Please wait a minute and try again.",
    });
    await rateLimit({
      key: `alert-write-hour:${ctx.shopDomain}:${ip}`,
      limit: 20,
      windowSeconds: 3600,
      shopId: ctx.shop.id,
      message: "Too many alert sign-ups from this device today.",
    });

    // Honeypot field rendered hidden in the storefront form; only bots fill it in.
    if (body.website) return json({ ok: true, subscribed: true });

    const email = assertEmail(body.email);
    const variantId = numericId(body.variantId);
    if (!variantId) throw new ProxyError(422, "variantId is required", "missing_variant");

    if (method === "DELETE") {
      const existing = await db.stockAlert.findUnique({
        where: { one_alert_per_email_variant: { shopId: ctx.shop.id, variantId, email } },
        select: { id: true },
      });
      if (existing) await cancelStockAlert(existing.id);
      return json({ ok: true, subscribed: false });
    }

    if (method !== "POST") throw new ProxyError(405, "Method not allowed", "method_not_allowed");

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
      email,
      phone: sanitisePhone(body.phone),
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
      const confirmUrl = `${(process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "")}/r/confirm/${alert.id}?sig=${signPayload(alert.id)}`;
      const unsubscribeUrl = `${(process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "")}/alerts/unsubscribe?id=${alert.id}&sig=${signPayload(alert.id)}`;

      await sendEmail(settings, {
        to: email,
        subject: `Confirm your alert for ${variant.productTitle}`,
        html: confirmationEmailHtml({
          shopName: ctx.shopDomain,
          productTitle: variant.productTitle,
          variantTitle: variant.variantTitle,
          confirmUrl,
          unsubscribeUrl,
        }),
        text: confirmationEmailText({
          shopName: ctx.shopDomain,
          productTitle: variant.productTitle,
          variantTitle: variant.variantTitle,
          confirmUrl,
          unsubscribeUrl,
        }),
      }).catch((err) => console.error("[double-opt-in] confirmation email failed:", err));
    }

    return json({
      ok: true,
      subscribed: true,
      created,
      alertId: alert.id,
      message:
        ctx.shop.doubleOptIn && alert.status === ALERT_STATUS.pending
          ? "Check your email to confirm your alert."
          : created
            ? "You're on the list. We'll email you the moment it's back."
            : "You're already on the list for this item.",
    });
  } catch (error) {
    return errorResponse(error);
  }
};

function sanitisePhone(value: string | undefined): string | null {
  const phone = (value || "").replace(/[^\d+]/g, "");
  if (!phone) return null;
  if (phone.length < 8 || phone.length > 16) {
    throw new ProxyError(422, "Enter a valid phone number", "invalid_phone");
  }
  return phone;
}
