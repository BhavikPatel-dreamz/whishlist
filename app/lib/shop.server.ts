import db from "../db.server";
import { decryptSecret } from "./crypto.server";
import { ProxyError } from "./proxy.server";
import { ttlDelete, ttlGet, ttlSet } from "./ttl-cache.server";
import type { Shop } from "@prisma/client";

const shopCacheKey = (shop: string) => `shop:${shop}`;

export const EMAIL_PROVIDERS = [
  "brevo",
  "mailgun",
  "klaviyo",
  "resend",
  "sendgrid",
] as const;

export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export function isEmailProvider(value: string): value is EmailProvider {
  return EMAIL_PROVIDERS.includes(value as EmailProvider);
}

export function getEmailProviderApiKeys(
  shop: Shop,
): Record<EmailProvider, string> {
  const keys: Record<EmailProvider, string> = {
    brevo: "",
    mailgun: "",
    klaviyo: "",
    resend: "",
    sendgrid: "",
  };
  const storedApiKey = decryptSecret(shop.apiKey);
  let isKeyMap = false;

  try {
    const parsed: unknown = JSON.parse(storedApiKey);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      isKeyMap = true;
      const parsedKeys = parsed as Record<string, unknown>;
      for (const provider of EMAIL_PROVIDERS) {
        const key = parsedKeys[provider];
        if (typeof key === "string") keys[provider] = key;
      }
    }
  } catch {
    // Older versions stored a single provider key instead of a JSON map.
  }

  if (!isKeyMap && storedApiKey && isEmailProvider(shop.emailProvider)) {
    keys[shop.emailProvider] = storedApiKey;
  }

  return keys;
}

export function getEmailProviderApiKey(
  shop: Shop,
  provider: EmailProvider,
): string {
  return getEmailProviderApiKeys(shop)[provider];
}

/** Fetches the Shop row, creating it on first touch (install, webhook, or proxy call). */
export async function getOrCreateShop(
  shop: string,
  accessToken?: string,
): Promise<Shop> {
  const record = await db.shop.upsert({
    where: { shop },
    create: { shop, accessToken },
    update: accessToken ? { accessToken } : {},
  });
  ttlSet(shopCacheKey(shop), record);
  return record;
}

export async function findShop(shop: string): Promise<Shop | null> {
  const cached = ttlGet<Shop>(shopCacheKey(shop));
  if (cached) return cached;
  const record = await db.shop.findUnique({ where: { shop } });
  if (record) ttlSet(shopCacheKey(shop), record);
  return record;
}

export async function requireShop(
  shop: string | undefined | null,
): Promise<Shop> {
  if (!shop) throw new ProxyError(400, "Missing shop", "missing_shop");
  const record = await findShop(shop);
  if (!record) throw new ProxyError(404, "Shop not installed", "not_installed");
  return record;
}

/** Drops the cached Shop row (call after direct `db.shop.update` writes). */
export function invalidateShopCache(shop: string): void {
  ttlDelete(shopCacheKey(shop));
}

export type ResolvedNotificationSettings = {
  provider: string;
  apiKey: string;
  senderEmail: string;
  senderName: string;
  emailSubject: string;
  emailHeading: string;
  emailBody: string;
  buttonLabel: string;
  emailAlertsEnabled: boolean;
  smsEnabled: boolean;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  whatsappEnabled: boolean;
  whatsappFromNumber: string;
  /** True when the shop's own provider API key is used (not the platform env fallback). */
  usesMerchantEmailProvider: boolean;
};

/** True when the shop has saved an API key for its selected email provider. */
export function shopHasMerchantEmailKey(shop: Shop): boolean {
  const provider = (shop.emailProvider || "brevo") as EmailProvider;
  return Boolean(getEmailProviderApiKey(shop, provider));
}

/** Merges shop settings with the platform-level fallback credentials from env. */
export function resolveSettings(shop: Shop): ResolvedNotificationSettings {
  const provider = (shop.emailProvider || "brevo") as EmailProvider;
  const merchantKey = getEmailProviderApiKey(shop, provider);
  const apiKey =
    merchantKey || (provider === "brevo" ? process.env.BREVO_API_KEY || "" : "");
  return {
    provider,
    apiKey,
    senderEmail: shop.senderEmail || process.env.DEFAULT_SENDER_EMAIL || "",
    senderName: shop.senderName || shop.shop.replace(".myshopify.com", ""),
    emailSubject: shop.emailSubject,
    emailHeading: shop.emailHeading,
    emailBody: shop.emailBody,
    buttonLabel: shop.buttonLabel,
    emailAlertsEnabled: shop.emailAlertsEnabled,
    smsEnabled: shop.smsEnabled,
    twilioAccountSid: shop.twilioAccountSid || "",
    twilioAuthToken: decryptSecret(shop.twilioAuthToken),
    twilioFromNumber: shop.twilioFromNumber || "",
    whatsappEnabled: shop.whatsappEnabled,
    whatsappFromNumber: shop.whatsappFromNumber || "",
    usesMerchantEmailProvider: Boolean(merchantKey),
  };
}

/**
 * Starter/Growth always send via the managed platform key.
 * Scale may use the shop's own provider credentials when configured.
 */
export function resolveSettingsForPlan(
  shop: Shop,
  plan: { allowMerchantProvider: boolean },
): ResolvedNotificationSettings {
  const settings = resolveSettings(shop);
  if (plan.allowMerchantProvider && settings.usesMerchantEmailProvider) {
    return settings;
  }
  return {
    ...settings,
    provider: "brevo",
    apiKey: process.env.BREVO_API_KEY || "",
    usesMerchantEmailProvider: false,
  };
}
