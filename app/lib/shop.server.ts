import db from "../db.server";
import { decryptSecret } from "./crypto.server";
import { ProxyError } from "./proxy.server";
import type { Shop } from "@prisma/client";

/** Fetches the Shop row, creating it on first touch (install, webhook, or proxy call). */
export async function getOrCreateShop(shop: string, accessToken?: string): Promise<Shop> {
  return db.shop.upsert({
    where: { shop },
    create: { shop, accessToken },
    update: accessToken ? { accessToken } : {},
  });
}

export async function requireShop(shop: string | undefined | null): Promise<Shop> {
  if (!shop) throw new ProxyError(400, "Missing shop", "missing_shop");
  const record = await db.shop.findUnique({ where: { shop } });
  if (!record) throw new ProxyError(404, "Shop not installed", "not_installed");
  return record;
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
  smsEnabled: boolean;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
};

/** Merges shop settings with the platform-level fallback credentials from env. */
export function resolveSettings(shop: Shop): ResolvedNotificationSettings {
  const apiKey = decryptSecret(shop.apiKey) || process.env.DEFAULT_EMAIL_API_KEY || "";
  return {
    provider: shop.apiKey ? shop.emailProvider : process.env.DEFAULT_EMAIL_PROVIDER || shop.emailProvider,
    apiKey,
    senderEmail: shop.senderEmail || process.env.DEFAULT_SENDER_EMAIL || "",
    senderName: shop.senderName || shop.shop.replace(".myshopify.com", ""),
    emailSubject: shop.emailSubject,
    emailHeading: shop.emailHeading,
    emailBody: shop.emailBody,
    buttonLabel: shop.buttonLabel,
    smsEnabled: shop.smsEnabled,
    twilioAccountSid: shop.twilioAccountSid || "",
    twilioAuthToken: decryptSecret(shop.twilioAuthToken),
    twilioFromNumber: shop.twilioFromNumber || "",
  };
}
