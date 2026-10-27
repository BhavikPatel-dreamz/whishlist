import { requireAdminShop } from "../lib/admin-auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { encryptSecret, maskSecret } from "../lib/crypto.server";
import {
  EMAIL_PROVIDERS,
  getEmailProviderApiKey,
  getEmailProviderApiKeys,
  isEmailProvider,
  type EmailProvider,
  invalidateShopCache,
} from "../lib/shop.server";
import { getShopPlan, planAllowsSmsWhatsApp } from "../lib/billing/plan.server";
import { emailsConsumedThisPeriod } from "../lib/billing/usage.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdminShop(request);
  const plan = await getShopPlan(shop.id).catch(() => null);
  const canConfigureEmailProvider = Boolean(plan?.allowMerchantProvider);
  const canUseSmsWhatsApp = planAllowsSmsWhatsApp(plan?.code || "starter");
  const emailsSent = plan
    ? await emailsConsumedThisPeriod(shop.id, plan.allowanceWindow).catch(() => 0)
    : 0;
  const sentLabel = plan?.allowanceWindow === "day" ? "today" : "this month";

  const providerKeys = Object.fromEntries(
    EMAIL_PROVIDERS.map((provider) => [
      provider,
      getEmailProviderApiKey(shop, provider)
        ? maskSecret(getEmailProviderApiKey(shop, provider))
        : "",
    ]),
  ) as Record<EmailProvider, string>;
  const maskedKeys = canConfigureEmailProvider ? providerKeys : ({} as Record<EmailProvider, string>);
  return {
    emailProvider: EMAIL_PROVIDERS.includes(shop.emailProvider as EmailProvider)
      ? shop.emailProvider
      : "brevo",
    providerKeys: maskedKeys,
    senderEmail: shop.senderEmail || "",
    senderName: shop.senderName || "",
    canConfigureEmailProvider,
    canUseSmsWhatsApp,
    emailsSent,
    sentLabel,
    smsEnabled: canUseSmsWhatsApp ? shop.smsEnabled : false,
    emailAlertsEnabled: shop.emailAlertsEnabled,
    twilioAccountSid: canUseSmsWhatsApp ? shop.twilioAccountSid || "" : "",
    hasTwilioAuthToken: canUseSmsWhatsApp && Boolean(shop.twilioAuthToken),
    twilioFromNumber: canUseSmsWhatsApp ? shop.twilioFromNumber || "" : "",
    whatsappEnabled: canUseSmsWhatsApp ? shop.whatsappEnabled : false,
    whatsappFromNumber: canUseSmsWhatsApp ? shop.whatsappFromNumber || "" : "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdminShop(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const requestedReturnTo = new URL(request.url).searchParams.get("returnTo");
  const returnTo =
    requestedReturnTo === "/app/settings?section=back-in-stock"
      ? requestedReturnTo
      : undefined;

  if (intent === "saveEmailIntegration") {
    const emailAlertsEnabled = formData.get("emailAlertsEnabled") === "true";
    const plan = await getShopPlan(shop.id).catch(() => null);
    if (!plan?.allowMerchantProvider) {
      await db.shop.update({
        where: { id: shop.id },
        data: { emailAlertsEnabled },
      });
      invalidateShopCache(shop.shop);
      return { ok: true as const, intent };
    }
    const provider = String(formData.get("emailProvider") || "brevo");
    const apiKey = String(formData.get("apiKey") || "").trim();
    const senderEmail = String(formData.get("senderEmail") || "").trim();
    const senderName = String(formData.get("senderName") || "").trim();

    if (!isEmailProvider(provider)) {
      return { ok: false as const, intent, error: "Choose a supported email provider." };
    }
    if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      return { ok: false as const, intent, error: "Enter a valid sender email address." };
    }
    const selectedProvider = provider;
    const hasSavedProviderKey = Boolean(getEmailProviderApiKey(shop, selectedProvider));
    if (!apiKey && !hasSavedProviderKey) {
      return { ok: false as const, intent, error: "Enter an API key for the selected provider before switching." };
    }
    if (apiKey) {
      const inferred = providerFromApiKey(apiKey);
      const selected = EMAIL_PROVIDER_OPTIONS.find((option) => option.value === provider);
      if (inferred && inferred !== provider) {
        const inferredLabel = EMAIL_PROVIDER_OPTIONS.find((option) => option.value === inferred)?.label ?? inferred;
        return {
          ok: false as const,
          intent,
          error: `That API key belongs to ${inferredLabel}, but ${selected?.label ?? provider} is selected. Pick ${inferredLabel} as the provider, or paste its own API key.`,
        };
      }
    }
    if (provider !== "klaviyo" && !senderEmail) {
      return { ok: false as const, intent, error: "Enter a sender email for transactional email delivery." };
    }

    await db.shop.update({
      where: { id: shop.id },
      data: {
        emailProvider: provider,
        emailAlertsEnabled,
        senderEmail: senderEmail || null,
        senderName: senderName || null,
        ...(apiKey
          ? {
              apiKey: encryptSecret(
                JSON.stringify({
                  ...getEmailProviderApiKeys(shop),
                  [selectedProvider]: apiKey,
                }),
              ),
            }
          : {}),
      },
    });
    invalidateShopCache(shop.shop);
    return { ok: true as const, intent };
  }

  if (intent === "saveSmsIntegration" || intent === "saveWhatsAppIntegration") {
    const plan = await getShopPlan(shop.id).catch(() => null);
    if (!planAllowsSmsWhatsApp(plan?.code || "starter")) {
      return {
        ok: false as const,
        intent,
        error: "SMS and WhatsApp are available on the Scale plan.",
      };
    }
  }

  if (intent === "saveWhatsAppIntegration") {
    const whatsappEnabled = formData.get("whatsappEnabled") === "true";
    const whatsappFromNumber = String(formData.get("whatsappFromNumber") || "").trim();
    const twilioAccountSid = String(formData.get("twilioAccountSid") || "").trim();
    const twilioAuthToken = String(formData.get("twilioAuthToken") || "").trim();
    const hasToken = Boolean(twilioAuthToken || shop.twilioAuthToken);
    if (whatsappEnabled && (!twilioAccountSid || !hasToken || !whatsappFromNumber)) {
      return { ok: false as const, intent, error: "Add the Twilio Account SID, auth token, and WhatsApp sender before enabling WhatsApp." };
    }
    if (whatsappFromNumber && !/^\+?[1-9]\d{7,14}$/.test(whatsappFromNumber.replace(/^whatsapp:/, ""))) {
      return { ok: false as const, intent, error: "Use a valid WhatsApp sender number, such as +14155550123." };
    }
    await db.shop.update({
      where: { id: shop.id },
      data: {
        whatsappEnabled,
        whatsappFromNumber: whatsappFromNumber || null,
        twilioAccountSid: twilioAccountSid || null,
        ...(twilioAuthToken ? { twilioAuthToken: encryptSecret(twilioAuthToken) } : {}),
      },
    });
    invalidateShopCache(shop.shop);
    return { ok: true as const, intent, returnTo };
  }

  if (intent === "saveSmsIntegration") {
    const smsEnabled = formData.get("smsEnabled") === "true";
    const twilioAccountSid = String(formData.get("twilioAccountSid") || "").trim();
    const twilioAuthToken = String(formData.get("twilioAuthToken") || "").trim();
    const twilioFromNumber = String(formData.get("twilioFromNumber") || "").trim();
    const hasToken = Boolean(twilioAuthToken || shop.twilioAuthToken);

    if (smsEnabled && (!twilioAccountSid || !hasToken || !twilioFromNumber)) {
      return { ok: false as const, intent, error: "Add the Twilio Account SID, auth token, and sender number before enabling SMS." };
    }
    if (twilioFromNumber && !/^\+[1-9]\d{7,14}$/.test(twilioFromNumber)) {
      return { ok: false as const, intent, error: "Use a valid Twilio sender number in international format, such as +14155550123." };
    }

    await db.shop.update({
      where: { id: shop.id },
      data: {
        smsEnabled,
        twilioAccountSid: twilioAccountSid || null,
        twilioFromNumber: twilioFromNumber || null,
        ...(twilioAuthToken ? { twilioAuthToken: encryptSecret(twilioAuthToken) } : {}),
      },
    });
    invalidateShopCache(shop.shop);
    return { ok: true as const, intent, returnTo };
  }

  return { ok: false as const, intent, error: "Unknown integration settings." };
};

const EMAIL_PROVIDER_OPTIONS = [
  { label: "Brevo (default)", value: "brevo" },
  { label: "Mailgun", value: "mailgun" },
  { label: "Klaviyo", value: "klaviyo" },
  { label: "Resend", value: "resend" },
  { label: "SendGrid", value: "sendgrid" },
];

export default function Integrations() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo =
    requestedReturnTo === "/app/settings?section=back-in-stock"
      ? requestedReturnTo
      : "/app/settings";
  const emailFetcher = useFetcher<typeof action>();
  const smsFetcher = useFetcher<typeof action>();
  const [emailProvider, setEmailProvider] = useState(data.emailProvider);
  const [emailApiKey, setEmailApiKey] = useState("");
  const [senderEmail, setSenderEmail] = useState(data.senderEmail);
  const [senderName, setSenderName] = useState(data.senderName);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(data.emailAlertsEnabled);
  const [whatsappEnabled, setWhatsappEnabled] = useState(data.whatsappEnabled);
  const [whatsappFromNumber, setWhatsappFromNumber] = useState(data.whatsappFromNumber);
  const [twilioAccountSid, setTwilioAccountSid] = useState(data.twilioAccountSid);
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioFromNumber, setTwilioFromNumber] = useState(data.twilioFromNumber);
  const [smsResultDismissed, setSmsResultDismissed] = useState(false);

  const section = searchParams.get("section") === "sms"
    ? "sms"
    : searchParams.get("section") === "whatsapp"
      ? "whatsapp"
      : searchParams.get("section") === "email"
        ? "email"
        : null;
  const sectionQuery = (name: "email" | "sms" | "whatsapp") => {
    const params = new URLSearchParams();
    params.set("section", name);
    if (requestedReturnTo === "/app/settings?section=back-in-stock") {
      params.set("returnTo", requestedReturnTo);
    }
    return `/app/integrations?${params.toString()}`;
  };

  const emailResult = emailFetcher.data;
  const smsResult = smsFetcher.data;

  return (
    <Page
      fullWidth
      backAction={{
        content: returnTo.endsWith("back-in-stock")
          ? "Back to Back-in-Stock"
          : "Back to Configurations",
        onAction: () => navigate(returnTo),
      }}
    >
      <TitleBar title={section === "sms" ? "SMS alerts" : section === "whatsapp" ? "WhatsApp alerts" : section === "email" ? "Email delivery" : "Integrations"} />
      <BlockStack gap="400">
        {!section && (
          <>
            <Text as="p" tone="subdued">
              Turn email delivery and SMS alerts on separately. Each one has its own settings.
            </Text>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Email delivery</Text>
                <Text as="p" tone="subdued">
                  {data.emailAlertsEnabled ? "Enabled" : "Disabled"}. Emails sent {data.sentLabel}: {data.emailsSent}.
                </Text>
                <Link to={sectionQuery("email")}>Email settings</Link>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">SMS alerts</Text>
                <Text as="p" tone="subdued">
                  {data.canUseSmsWhatsApp ? (data.smsEnabled ? "Enabled" : "Disabled") : "Included with the Scale plan."}
                </Text>
                <Link to={sectionQuery("sms")}>SMS settings</Link>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">WhatsApp alerts</Text>
                <Text as="p" tone="subdued">
                  {data.canUseSmsWhatsApp ? (data.whatsappEnabled ? "Enabled" : "Disabled") : "Included with the Scale plan."}
                </Text>
                <Link to={sectionQuery("whatsapp")}>WhatsApp settings</Link>
              </BlockStack>
            </Card>
          </>
        )}

        {section === "email" && (
        <Card>
          {data.canConfigureEmailProvider ? (
          <emailFetcher.Form method="post">
            <input type="hidden" name="intent" value="saveEmailIntegration" />
            <input type="hidden" name="emailAlertsEnabled" value={String(emailAlertsEnabled)} />
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Email delivery</Text>
                <Text as="p" tone="subdued">
                  Turn email alerts on or off without changing SMS. Scale can also choose a custom email provider for unlimited sends.
                </Text>
              </BlockStack>
              <Select
                label="Email alerts"
                options={[
                  { label: "Enabled", value: "true" },
                  { label: "Disabled", value: "false" },
                ]}
                value={String(emailAlertsEnabled)}
                onChange={(value) => setEmailAlertsEnabled(value === "true")}
              />
              {emailResult?.intent === "saveEmailIntegration" && (
                <Banner tone={emailResult.ok ? "success" : "critical"}>
                  {emailResult.ok ? "Email integration settings saved." : emailResult.error}
                </Banner>
              )}
              {emailProvider === "resend" && (
                <Banner tone="warning" title="Resend testing sender restriction">
                  <p>
                    Resend's onboarding@resend.dev sender can only deliver to the
                    email address on your Resend account. To send to customers,
                    verify a domain in Resend and use a sender address on that domain.
                  </p>
                </Banner>
              )}
              <input type="hidden" name="emailProvider" value={emailProvider} />
              <Select
                label="Email provider"
                options={EMAIL_PROVIDER_OPTIONS}
                value={EMAIL_PROVIDER_OPTIONS.some((option) => option.value === emailProvider) ? emailProvider : "brevo"}
                onChange={(value) => {
                  setEmailProvider(value);
                  setEmailApiKey("");
                }}
              />
              <TextField
                label="Provider API key"
                name="apiKey"
                type="password"
                value={emailApiKey}
                onChange={setEmailApiKey}
                placeholder={data.providerKeys[emailProvider as EmailProvider] || "Enter provider API key"}
                autoComplete="new-password"
                helpText={data.providerKeys[emailProvider as EmailProvider] ? "A key is already saved for this provider. Leave blank to keep it; enter a new key to replace it." : "This provider's key is encrypted before it is stored."}
              />
              <TextField
                label="Sender email"
                name="senderEmail"
                type="email"
                value={senderEmail}
                onChange={setSenderEmail}
                autoComplete="email"
              />
              <TextField
                label="Sender name"
                name="senderName"
                value={senderName}
                onChange={setSenderName}
                autoComplete="organization"
              />
              <Button submit variant="primary" loading={emailFetcher.state !== "idle"}>
                Save email integration
              </Button>
            </BlockStack>
          </emailFetcher.Form>
          ) : (
            <emailFetcher.Form method="post">
              <input type="hidden" name="intent" value="saveEmailIntegration" />
              <input type="hidden" name="emailAlertsEnabled" value={String(emailAlertsEnabled)} />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Email delivery</Text>
                <Text as="p" variant="headingLg">{data.emailsSent}</Text>
                <Text as="p" tone="subdued">
                  Emails sent {data.sentLabel}. Starter and Growth use the managed sender. Upgrade to Scale to use your own email provider for unlimited sends.
                </Text>
                <Select
                  label="Email alerts"
                  options={[
                    { label: "Enabled", value: "true" },
                    { label: "Disabled", value: "false" },
                  ]}
                  value={String(emailAlertsEnabled)}
                  onChange={(value) => setEmailAlertsEnabled(value === "true")}
                />
                {emailResult?.intent === "saveEmailIntegration" && (
                  <Banner tone={emailResult.ok ? "success" : "critical"}>
                    {emailResult.ok ? "Email alerts updated." : emailResult.error}
                  </Banner>
                )}
                <Button submit variant="primary" loading={emailFetcher.state !== "idle"}>Save email alerts</Button>
                <Link to="/app/settings">View plans</Link>
              </BlockStack>
            </emailFetcher.Form>
          )}
        </Card>
        )}

        {section === "sms" && (
        <Card>
          {data.canUseSmsWhatsApp ? (
          <smsFetcher.Form
            method="post"
            onChange={() => setSmsResultDismissed(true)}
            onSubmit={() => setSmsResultDismissed(false)}
          >
            <input type="hidden" name="intent" value="saveSmsIntegration" />
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">SMS alerts</Text>
                <Text as="p" tone="subdued">
                  Twilio sends a text when a restock alert is triggered. Add your account credentials below.
                </Text>
              </BlockStack>
              {!smsResultDismissed && smsResult?.intent === "saveSmsIntegration" && (
                <Banner tone={smsResult.ok ? "success" : "critical"}>
                  {smsResult.ok ? (
                    <>
                      SMS integration settings saved.
                      {"returnTo" in smsResult && smsResult.returnTo && (
                        <> <Link to={smsResult.returnTo}>Return to Back-in-Stock settings</Link></>
                      )}
                    </>
                  ) : smsResult.error}
                </Banner>
              )}
              <Select
                label="SMS alerts"
                name="smsEnabled"
                options={[
                  { label: "Disabled", value: "false" },
                  { label: "Enabled", value: "true" },
                ]}
                value={String(smsEnabled)}
                onChange={(value) => setSmsEnabled(value === "true")}
              />
              <TextField
                label="Twilio Account SID"
                name="twilioAccountSid"
                value={twilioAccountSid}
                onChange={setTwilioAccountSid}
                autoComplete="off"
              />
              <TextField
                label="Twilio auth token"
                name="twilioAuthToken"
                type="password"
                value={twilioAuthToken}
                onChange={setTwilioAuthToken}
                placeholder={data.hasTwilioAuthToken ? "Saved securely" : "Enter Twilio auth token"}
                autoComplete="new-password"
                helpText="The token is encrypted before it is stored. Leave blank to keep the saved token."
              />
              <TextField
                label="Twilio sender number"
                name="twilioFromNumber"
                value={twilioFromNumber}
                onChange={setTwilioFromNumber}
                placeholder="+14155550123"
                autoComplete="tel"
              />
              <Button submit variant="primary" loading={smsFetcher.state !== "idle"}>
                Save SMS integration
              </Button>
            </BlockStack>
          </smsFetcher.Form>
          ) : (
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">SMS alerts</Text>
              <Text as="p" tone="subdued">SMS and WhatsApp are available on the Scale plan.</Text>
              <Link to="/app/settings">View plans</Link>
            </BlockStack>
          )}
        </Card>
        )}

        {section === "whatsapp" && (
        <Card>
          {data.canUseSmsWhatsApp ? (
          <smsFetcher.Form method="post">
            <input type="hidden" name="intent" value="saveWhatsAppIntegration" />
            <input type="hidden" name="whatsappEnabled" value={String(whatsappEnabled)} />
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">WhatsApp alerts</Text>
              <Text as="p" tone="subdued">WhatsApp uses the same Twilio account as SMS and is available on the Scale plan.</Text>
              {smsResult?.intent === "saveWhatsAppIntegration" && (
                <Banner tone={smsResult.ok ? "success" : "critical"}>
                  {smsResult.ok ? "WhatsApp settings saved." : smsResult.error}
                </Banner>
              )}
              <Select
                label="WhatsApp alerts"
                options={[{ label: "Disabled", value: "false" }, { label: "Enabled", value: "true" }]}
                value={String(whatsappEnabled)}
                onChange={(value) => setWhatsappEnabled(value === "true")}
              />
              <TextField label="Twilio Account SID" name="twilioAccountSid" value={twilioAccountSid} onChange={setTwilioAccountSid} autoComplete="off" />
              <TextField label="Twilio auth token" name="twilioAuthToken" type="password" value={twilioAuthToken} onChange={setTwilioAuthToken} placeholder={data.hasTwilioAuthToken ? "Saved securely" : "Enter Twilio auth token"} autoComplete="new-password" />
              <TextField label="WhatsApp sender number" name="whatsappFromNumber" value={whatsappFromNumber} onChange={setWhatsappFromNumber} placeholder="+14155550123" autoComplete="tel" />
              <Button submit variant="primary" loading={smsFetcher.state !== "idle"}>Save WhatsApp settings</Button>
            </BlockStack>
          </smsFetcher.Form>
          ) : (
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">WhatsApp alerts</Text>
              <Text as="p" tone="subdued">SMS and WhatsApp are available on the Scale plan.</Text>
              <Link to="/app/settings">View plans</Link>
            </BlockStack>
          )}
        </Card>
        )}
      </BlockStack>
    </Page>
  );
}