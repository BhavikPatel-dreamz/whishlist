import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineGrid,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { requireAdminShop } from "../lib/admin-auth.server";
import { getShopPlan } from "../lib/billing/plan.server";
import {
  emailDomain,
  managedMailgunApiBaseUrl,
  managedMailgunApiKey,
  managedMailgunConfigured,
  managedMailgunDomain,
  managedSenderEmail,
  managedSenderName,
} from "../lib/notifications/managed-mailgun.server";
import { sendEmail } from "../lib/notifications/providers.server";
import { resolveSettingsForPlan } from "../lib/shop.server";

function maskKey(key: string): string {
  if (!key) return "(missing)";
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)} (${key.length} chars)`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, session } = await requireAdminShop(request);
  const plan = await getShopPlan(shop.id).catch(() => null);
  const settings = resolveSettingsForPlan(shop, {
    allowMerchantProvider: Boolean(plan?.allowMerchantProvider),
  });

  const mailgunDomain = managedMailgunDomain();
  const platformSender = managedSenderEmail();
  const senderHost = emailDomain(settings.senderEmail);
  const domainMismatch = Boolean(
    mailgunDomain && senderHost && senderHost !== mailgunDomain.toLowerCase(),
  );

  return {
    shop: session.shop,
    planCode: plan?.code || "starter",
    usingMerchantProvider: settings.usesMerchantEmailProvider,
    provider: settings.provider,
    senderEmail: settings.senderEmail || "",
    senderName: settings.senderName || "",
    hasApiKey: Boolean(settings.apiKey),
    apiKeyMasked: maskKey(settings.apiKey || ""),
    mailgun: {
      configured: managedMailgunConfigured(),
      domain: mailgunDomain || "(missing)",
      platformSender: platformSender || "(missing)",
      platformSenderName: managedSenderName(),
      apiBaseUrl: managedMailgunApiBaseUrl(),
      apiKeyMasked: maskKey(managedMailgunApiKey()),
      domainMismatch,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdminShop(request);
  const formData = await request.formData();
  const to = String(formData.get("to") || "").trim().toLowerCase();

  if (!to || !to.includes("@")) {
    return {
      ok: false as const,
      error: "Enter a valid destination email address.",
      to: "",
      provider: "",
      id: undefined as string | undefined,
    };
  }

  const plan = await getShopPlan(shop.id).catch(() => null);
  const settings = resolveSettingsForPlan(shop, {
    allowMerchantProvider: Boolean(plan?.allowMerchantProvider),
  });

  const result = await sendEmail(settings, {
    to,
    subject: `[Dev test] Wishlist Stock Notify — ${new Date().toISOString()}`,
    text:
      "This is a developer test email from Wishlist Stock Notify.\n" +
      `Shop: ${shop.shop}\nProvider: ${settings.provider}\n`,
    html: `
      <div style="font-family:sans-serif;line-height:1.5;max-width:520px">
        <h2 style="margin:0 0 12px">Developer email test</h2>
        <p>This message confirms transactional email from <strong>Wishlist Stock Notify</strong>.</p>
        <ul>
          <li><strong>Shop:</strong> ${shop.shop}</li>
          <li><strong>Provider:</strong> ${settings.provider}</li>
          <li><strong>From:</strong> ${settings.senderEmail || "(none)"}</li>
          <li><strong>Sent at:</strong> ${new Date().toISOString()}</li>
        </ul>
        <p style="color:#666;font-size:13px">You can delete this message — it is not a customer notification.</p>
      </div>
    `,
  });

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error,
      to,
      provider: settings.provider,
      id: undefined as string | undefined,
    };
  }

  return {
    ok: true as const,
    error: "",
    to,
    provider: settings.provider,
    id: result.id,
  };
};

export default function DevEmailTestPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [to, setTo] = useState(actionData?.to || "");

  useEffect(() => {
    if (actionData?.to) setTo(actionData.to);
  }, [actionData?.to]);

  return (
    <Page
      title="Email test"
      subtitle="Developer tool — send a sample message through the live provider path"
      backAction={{ content: "Integrations", url: "/app/integrations" }}
    >
      <TitleBar title="Email test" />
      <BlockStack gap="400">
        {actionData?.ok === true ? (
          <Banner tone="success" title="Test email accepted by the provider">
            <p>
              Sent to <strong>{actionData.to}</strong> via{" "}
              <strong>{actionData.provider}</strong>
              {actionData.id ? (
                <>
                  {" "}
                  (id: <code>{actionData.id}</code>)
                </>
              ) : null}
              . Check inbox and spam.
            </p>
          </Banner>
        ) : null}
        {actionData?.ok === false ? (
          <Banner tone="critical" title="Test email failed">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {data.mailgun.domainMismatch ? (
          <Banner tone="warning" title="Sender domain does not match MAILGUN_DOMAIN">
            <p>
              Platform sender is <code>{data.mailgun.platformSender}</code> but{" "}
              <code>MAILGUN_DOMAIN</code> is <code>{data.mailgun.domain}</code>.
              Mailgun usually requires From to be on the sending domain (e.g.{" "}
              <code>support@{data.mailgun.domain}</code>).
            </p>
          </Banner>
        ) : null}

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Send sample email
              </Text>
              <Text as="p" tone="subdued">
                Uses the same <code>resolveSettingsForPlan</code> →{" "}
                <code>sendEmail</code> path as restock notifications.
              </Text>
              <Form method="post">
                <FormLayout>
                  <TextField
                    label="Send to"
                    name="to"
                    type="email"
                    autoComplete="email"
                    value={to}
                    onChange={setTo}
                    helpText="For Mailgun sandbox, this address must be an Authorized Recipient."
                  />
                  <Button submit variant="primary" loading={submitting}>
                    Send test email
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Resolved send config
              </Text>
              <Text as="p">
                <strong>Shop:</strong> {data.shop}
              </Text>
              <Text as="p">
                <strong>Plan:</strong> {data.planCode}
              </Text>
              <Text as="p">
                <strong>Provider:</strong> {data.provider}
                {data.usingMerchantProvider ? " (merchant key)" : " (platform Mailgun)"}
              </Text>
              <Text as="p">
                <strong>From name:</strong> {data.senderName || "(empty)"}
              </Text>
              <Text as="p">
                <strong>From email:</strong> {data.senderEmail || "(missing)"}
              </Text>
              <Text as="p">
                <strong>API key:</strong> {data.apiKeyMasked}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Platform Mailgun env
            </Text>
            <Text as="p">
              <strong>Configured:</strong> {data.mailgun.configured ? "yes" : "no"}
            </Text>
            <Text as="p">
              <strong>MAILGUN_DOMAIN:</strong> {data.mailgun.domain}
            </Text>
            <Text as="p">
              <strong>DEFAULT_SENDER_EMAIL:</strong> {data.mailgun.platformSender}
            </Text>
            <Text as="p">
              <strong>DEFAULT_SENDER_NAME:</strong> {data.mailgun.platformSenderName}
            </Text>
            <Text as="p">
              <strong>MAILGUN_API_BASE_URL:</strong> {data.mailgun.apiBaseUrl}
            </Text>
            <Text as="p">
              <strong>MAILGUN_API_KEY:</strong> {data.mailgun.apiKeyMasked}
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
