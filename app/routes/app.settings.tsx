import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  Checkbox,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);

  return {
    shop: {
      emailProvider: shop.emailProvider,
      hasApiKey: Boolean(shop.apiKey),
      apiKeyMasked: shop.apiKey ? maskSecret(decryptSecret(shop.apiKey)) : "",
      senderEmail: shop.senderEmail || "",
      senderName: shop.senderName || "",
      emailSubject: shop.emailSubject,
      emailHeading: shop.emailHeading,
      emailBody: shop.emailBody,
      buttonLabel: shop.buttonLabel,
      stockAlertDeliveryMode: shop.stockAlertDeliveryMode,
      stockAlertDeliveryTime: shop.stockAlertDeliveryTime,
      smsEnabled: shop.smsEnabled,
      hasTwilioToken: Boolean(shop.twilioAuthToken),
      twilioAccountSid: shop.twilioAccountSid || "",
      twilioFromNumber: shop.twilioFromNumber || "",
      wishlistRequiresLogin: shop.wishlistRequiresLogin,
      doubleOptIn: shop.doubleOptIn,
      alertsPerVariantCap: shop.alertsPerVariantCap,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const formData = await request.formData();

  const emailProvider = String(formData.get("emailProvider") || "resend");
  const apiKeyRaw = String(formData.get("apiKey") || "").trim();
  const senderEmail = String(formData.get("senderEmail") || "").trim();
  const senderName = String(formData.get("senderName") || "").trim();
  const emailSubject = String(formData.get("emailSubject") || "").trim();
  const emailHeading = String(formData.get("emailHeading") || "").trim();
  const emailBody = String(formData.get("emailBody") || "").trim();
  const buttonLabel = String(formData.get("buttonLabel") || "").trim();
  const stockAlertDeliveryMode = String(formData.get("stockAlertDeliveryMode") || "immediate");
  const stockAlertDeliveryTime = String(formData.get("stockAlertDeliveryTime") || "09:00").trim();
  const smsEnabled = formData.get("smsEnabled") === "on";
  const twilioAccountSid = String(formData.get("twilioAccountSid") || "").trim();
  const twilioAuthTokenRaw = String(formData.get("twilioAuthToken") || "").trim();
  const twilioFromNumber = String(formData.get("twilioFromNumber") || "").trim();
  const wishlistRequiresLogin = formData.get("wishlistRequiresLogin") === "on";
  const doubleOptIn = formData.get("doubleOptIn") === "on";
  const alertsPerVariantCap = parseInt(String(formData.get("alertsPerVariantCap") || "0"), 10);

  const updateData: Record<string, unknown> = {
    emailProvider,
    senderEmail: senderEmail || null,
    senderName: senderName || null,
    emailSubject: emailSubject || shop.emailSubject,
    emailHeading: emailHeading || shop.emailHeading,
    emailBody: emailBody || shop.emailBody,
    buttonLabel: buttonLabel || shop.buttonLabel,
    stockAlertDeliveryMode: stockAlertDeliveryMode === "scheduled" ? "scheduled" : "immediate",
    stockAlertDeliveryTime: /^\d{2}:\d{2}$/.test(stockAlertDeliveryTime)
      ? stockAlertDeliveryTime
      : shop.stockAlertDeliveryTime,
    smsEnabled,
    twilioAccountSid: twilioAccountSid || null,
    twilioFromNumber: twilioFromNumber || null,
    wishlistRequiresLogin,
    doubleOptIn,
    alertsPerVariantCap: isNaN(alertsPerVariantCap) ? 0 : alertsPerVariantCap,
  };

  if (apiKeyRaw && apiKeyRaw !== shop.apiKey) {
    updateData.apiKey = encryptSecret(apiKeyRaw);
  }

  if (twilioAuthTokenRaw && twilioAuthTokenRaw !== shop.twilioAuthToken) {
    updateData.twilioAuthToken = encryptSecret(twilioAuthTokenRaw);
  }

  await db.shop.update({ where: { id: shop.id }, data: updateData });

  return { saved: true };
};

export default function Settings() {
  const { shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.saved) {
      shopify.toast.show("Settings saved");
    }
  }, [actionData, shopify]);

  const [emailProvider, setEmailProvider] = useState(shop.emailProvider);
  const [apiKey, setApiKey] = useState("");
  const [senderEmail, setSenderEmail] = useState(shop.senderEmail);
  const [senderName, setSenderName] = useState(shop.senderName);
  const [emailSubject, setEmailSubject] = useState(shop.emailSubject);
  const [emailHeading, setEmailHeading] = useState(shop.emailHeading);
  const [emailBody, setEmailBody] = useState(shop.emailBody);
  const [buttonLabel, setButtonLabel] = useState(shop.buttonLabel);
  const [stockAlertDeliveryMode, setStockAlertDeliveryMode] = useState(shop.stockAlertDeliveryMode);
  const [stockAlertDeliveryTime, setStockAlertDeliveryTime] = useState(
    shop.stockAlertDeliveryTime,
  );
  const [smsEnabled, setSmsEnabled] = useState(shop.smsEnabled);
  const [twilioAccountSid, setTwilioAccountSid] = useState(shop.twilioAccountSid);
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioFromNumber, setTwilioFromNumber] = useState(shop.twilioFromNumber);
  const [wishlistRequiresLogin, setWishlistRequiresLogin] = useState(shop.wishlistRequiresLogin);
  const [doubleOptIn, setDoubleOptIn] = useState(shop.doubleOptIn);
  const [alertsPerVariantCap, setAlertsPerVariantCap] = useState(
    shop.alertsPerVariantCap.toString(),
  );

  return (
    <Page>
      <TitleBar title="Settings" />
      <Form method="post">
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Email Provider
                  </Text>
                  <Select
                    label="Provider"
                    name="emailProvider"
                    options={[
                      { label: "Resend", value: "resend" },
                      { label: "Brevo", value: "brevo" },
                      { label: "SendGrid", value: "sendgrid" },
                      { label: "Klaviyo", value: "klaviyo" },
                    ]}
                    value={emailProvider}
                    onChange={(value) => setEmailProvider(value)}
                  />
                  <TextField
                    label="API Key"
                    name="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={setApiKey}
                    helpText={
                      shop.hasApiKey
                        ? `Current: ${shop.apiKeyMasked} (leave blank to keep)`
                        : "No API key configured"
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Sender Email"
                    name="senderEmail"
                    type="email"
                    value={senderEmail}
                    onChange={setSenderEmail}
                    placeholder="alerts@yourstore.com"
                    autoComplete="off"
                  />
                  <TextField
                    label="Sender Name"
                    name="senderName"
                    value={senderName}
                    onChange={setSenderName}
                    placeholder="My Store"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Email Template
                  </Text>
                  <TextField
                    label="Subject Line"
                    name="emailSubject"
                    value={emailSubject}
                    onChange={setEmailSubject}
                    helpText="Use {{ product_title }} for the product name"
                    autoComplete="off"
                  />
                  <TextField
                    label="Heading"
                    name="emailHeading"
                    value={emailHeading}
                    onChange={setEmailHeading}
                    autoComplete="off"
                  />
                  <TextField
                    label="Body"
                    name="emailBody"
                    value={emailBody}
                    onChange={setEmailBody}
                    multiline={3}
                    autoComplete="off"
                  />
                  <TextField
                    label="Button Label"
                    name="buttonLabel"
                    value={buttonLabel}
                    onChange={setButtonLabel}
                    autoComplete="off"
                  />
                  <Select
                    label="Back-in-stock email schedule"
                    name="stockAlertDeliveryMode"
                    options={[
                      { label: "Immediately when back in stock", value: "immediate" },
                      { label: "At a fixed time each day", value: "scheduled" },
                    ]}
                    value={stockAlertDeliveryMode}
                    onChange={setStockAlertDeliveryMode}
                  />
                  {stockAlertDeliveryMode === "scheduled" && (
                    <TextField
                      label="Daily send time"
                      name="stockAlertDeliveryTime"
                      type="time"
                      value={stockAlertDeliveryTime}
                      onChange={setStockAlertDeliveryTime}
                      helpText="Use your store timezone for the daily send window."
                      autoComplete="off"
                    />
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    SMS Notifications (Optional)
                  </Text>
                  <Checkbox
                    label="Enable SMS alerts via Twilio"
                    name="smsEnabled"
                    checked={smsEnabled}
                    onChange={(checked) => setSmsEnabled(checked)}
                  />
                  {smsEnabled && (
                    <BlockStack gap="300">
                      <TextField
                        label="Twilio Account SID"
                        name="twilioAccountSid"
                        value={twilioAccountSid}
                        onChange={setTwilioAccountSid}
                        autoComplete="off"
                      />
                      <TextField
                        label="Twilio Auth Token"
                        name="twilioAuthToken"
                        type="password"
                        value={twilioAuthToken}
                        onChange={setTwilioAuthToken}
                        helpText={
                          shop.hasTwilioToken
                            ? "Token saved (leave blank to keep)"
                            : "No token configured"
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="Twilio From Number"
                        name="twilioFromNumber"
                        value={twilioFromNumber}
                        onChange={setTwilioFromNumber}
                        placeholder="+1234567890"
                        autoComplete="off"
                      />
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Storefront Behavior
                  </Text>
                  <Checkbox
                    label="Require login for wishlist (guests cannot save items)"
                    name="wishlistRequiresLogin"
                    checked={wishlistRequiresLogin}
                    onChange={(checked) => setWishlistRequiresLogin(checked)}
                  />
                  <Checkbox
                    label="Double opt-in for stock alerts (send confirmation email first)"
                    name="doubleOptIn"
                    checked={doubleOptIn}
                    onChange={(checked) => setDoubleOptIn(checked)}
                  />
                  <TextField
                    label="Max waitlist signups per variant (0 = unlimited)"
                    name="alertsPerVariantCap"
                    type="number"
                    value={alertsPerVariantCap}
                    onChange={setAlertsPerVariantCap}
                    min={0}
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Layout>
            <Layout.Section>
              <InlineStack align="end">
                <Button submit variant="primary" loading={isSaving}>
                  Save settings
                </Button>
              </InlineStack>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Form>
    </Page>
  );
}
