import { afterEach, describe, expect, it } from "vitest";
import type { Shop } from "@prisma/client";
import { resolveSettingsForPlan } from "../shop.server";

const envKeys = [
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "DEFAULT_SENDER_EMAIL",
  "DEFAULT_SENDER_NAME",
  "BREVO_API_KEY",
] as const;

const previous = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of envKeys) {
    if (!previous.has(key)) continue;
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    previous.delete(key);
  }
});

function setEnv(key: (typeof envKeys)[number], value: string | undefined) {
  if (!previous.has(key)) previous.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function shop(partial: Partial<Shop> = {}): Shop {
  return {
    id: "shop-1",
    shop: "demo.myshopify.com",
    accessToken: null,
    installedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    emailProvider: "brevo",
    apiKey: null,
    brevoApiKey: null,
    mailgunApiKey: null,
    klaviyoApiKey: null,
    resendApiKey: null,
    sendgridApiKey: null,
    senderEmail: null,
    senderName: "Demo Store",
    emailSubject: "back",
    emailHeading: "heading",
    emailBody: "body",
    buttonLabel: "Buy",
    stockAlertDeliveryMode: "immediate",
    stockAlertDeliveryTime: "09:00",
    emailAlertsEnabled: true,
    smsEnabled: false,
    twilioAccountSid: null,
    twilioAuthToken: null,
    twilioFromNumber: null,
    whatsappEnabled: false,
    whatsappFromNumber: null,
    wishlistRequiresLogin: false,
    doubleOptIn: false,
    alertsPerVariantCap: 0,
    ...partial,
  } as Shop;
}

describe("resolveSettingsForPlan", () => {
  it("uses platform Mailgun for managed plans", () => {
    setEnv("MAILGUN_API_KEY", "key-managed");
    setEnv("MAILGUN_DOMAIN", "mg.example.com");
    setEnv("DEFAULT_SENDER_EMAIL", "alerts@mg.example.com");
    setEnv("BREVO_API_KEY", "xkeysib-should-not-win");

    const settings = resolveSettingsForPlan(shop(), {
      allowMerchantProvider: false,
    });

    expect(settings.provider).toBe("mailgun");
    expect(settings.apiKey).toBe("key-managed");
    expect(settings.senderEmail).toBe("alerts@mg.example.com");
    expect(settings.usesMerchantEmailProvider).toBe(false);
  });

  it("keeps merchant provider on Scale when a key is saved", () => {
    setEnv("MAILGUN_API_KEY", "key-managed");
    setEnv("DEFAULT_SENDER_EMAIL", "alerts@mg.example.com");

    const settings = resolveSettingsForPlan(
      shop({
        emailProvider: "resend",
        apiKey: JSON.stringify({ resend: "re_merchant" }),
      }),
      { allowMerchantProvider: true },
    );

    expect(settings.provider).toBe("resend");
    expect(settings.apiKey).toBe("re_merchant");
    expect(settings.usesMerchantEmailProvider).toBe(true);
  });
});
