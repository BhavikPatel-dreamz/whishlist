import { appOrigin } from "../app-url.server";
import { signPayload } from "../crypto.server";

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
  const properties = Buffer.from(
    JSON.stringify({
      _back_in_stock_alert: `${alertId}.${signPayload(alertId)}`,
    }),
    "utf8",
  ).toString("base64url");
  const params = new URLSearchParams({
    properties,
  });
  return `${base}?${params}`;
}
