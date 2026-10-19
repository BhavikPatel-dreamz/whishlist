import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
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
import { authenticate } from "../shopify.server";
import { encryptSecret, maskSecret } from "../lib/crypto.server";
import {
  EMAIL_PROVIDERS,
  getEmailProviderApiKey,
  getEmailProviderApiKeys,
  isEmailProvider,
  requireShop,
  type EmailProvider,
} from "../lib/shop.server";
import { providerFromApiKey } from "../lib/notifications/providers.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const providerKeys = Object.fromEntries(
    EMAIL_PROVIDERS.map((provider) => [
      provider,
      getEmailProviderApiKey(shop, provider)
        ? maskSecret(getEmailProviderApiKey(shop, provider))
        : "",
    ]),
  ) as Record<EmailProvider, string>;
  return {
    emailProvider: EMAIL_PROVIDERS.includes(shop.emailProvider as EmailProvider)
      ? shop.emailProvider
      : "brevo",
    providerKeys,
    senderEmail: shop.senderEmail || "",
    senderName: shop.senderName || "",
    smsEnabled: shop.smsEnabled,
    twilioAccountSid: shop.twilioAccountSid || "",
    hasTwilioAuthToken: Boolean(shop.twilioAuthToken),
    twilioFromNumber: shop.twilioFromNumber || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "saveEmailIntegration") {
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
    return { ok: true as const, intent };
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
    return { ok: true as const, intent };
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
  const emailFetcher = useFetcher<typeof action>();
  const smsFetcher = useFetcher<typeof action>();
  const [emailProvider, setEmailProvider] = useState(data.emailProvider);
  const [emailApiKey, setEmailApiKey] = useState("");
  const [senderEmail, setSenderEmail] = useState(data.senderEmail);
  const [senderName, setSenderName] = useState(data.senderName);
  const [smsEnabled, setSmsEnabled] = useState(data.smsEnabled);
  const [twilioAccountSid, setTwilioAccountSid] = useState(data.twilioAccountSid);
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioFromNumber, setTwilioFromNumber] = useState(data.twilioFromNumber);
  const [smsResultDismissed, setSmsResultDismissed] = useState(false);

  const emailResult = emailFetcher.data;
  const smsResult = smsFetcher.data;

  return (
    <Page fullWidth>
      <TitleBar title="Integrations" />
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Connect the services used to send back-in-stock emails and SMS alerts.
        </Text>

        <Card>
          <emailFetcher.Form method="post">
            <input type="hidden" name="intent" value="saveEmailIntegration" />
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Email delivery</Text>
                <Text as="p" tone="subdued">
                  Brevo is the default. Klaviyo sends a back-in-stock event to a configured Klaviyo flow; Brevo, Resend, and SendGrid send transactional email directly.
                </Text>
              </BlockStack>
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
              <Select
                label="Email provider"
                name="emailProvider"
                options={EMAIL_PROVIDER_OPTIONS}
                value={emailProvider}
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
        </Card>

        <Card>
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
                  {smsResult.ok ? "SMS integration settings saved." : smsResult.error}
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
        </Card>
      </BlockStack>
    </Page>
  );
}