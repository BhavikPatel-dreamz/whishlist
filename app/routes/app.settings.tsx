import { requireAdminShop } from "../lib/admin-auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink, useActionData, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { SmartSaveSettings } from "../components/SmartSaveSettings";
import { ConfigurationFeatures } from "../components/ConfigurationFeatures";
import { BackInStockConfiguration } from "../components/BackInStockConfiguration";
import type { BackInStockSettings } from "../lib/ui-config.shared";
import featureNavigationStyles from "../components/ConfigurationFeaturesNavigation.css?url";
import smartSaveStyles from "../components/SmartSaveSettings.css?url";
import {
  Page,
  Text,
  Card,
  Button,
  ButtonGroup,
  TextField,
  Tabs,
  InlineStack,
  BlockStack,
  Divider,
  Banner,
  Checkbox,
  RadioButton,
  Select,
  Badge,
  Link,
  RangeSlider,
} from "@shopify/polaris";
import { EditIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import {
  getEmailProviderApiKey,
  getEmailProviderApiKeys,
  isEmailProvider,
  invalidateShopCache,
} from "../lib/shop.server";
import { encryptSecret, maskSecret } from "../lib/crypto.server";
import { embedEditorUrl, themeEditorUrl } from "../lib/theme-editor";
import { pricingPlansUrl } from "../lib/billing/pricing-plans-url.server";
import { getShopPlan } from "../lib/billing/plan.server";
import { emailsConsumedThisPeriod } from "../lib/billing/usage.server";
import db from "../db.server";
import { upsertUIConfigForShopDomain } from "../models/ui-config.server";
import { ProxyError } from "../lib/proxy.server";

export const links = () => [
  { rel: "stylesheet", href: featureNavigationStyles },
  { rel: "stylesheet", href: smartSaveStyles },
];

/* Replace with your real help-centre URLs */
const TUTORIAL_URL = "https://example.com/docs/advanced-button";
const SELECTOR_HELP_URL = "https://example.com/docs/find-css-selectors";

/* -------------------------------------------------------------------------- */
/*  Config model                                                              */
/* -------------------------------------------------------------------------- */

type IconType = "heart" | "star" | "bookmark";
type BtnType = "icon-text" | "text" | "icon";
type BtnStyle = "solid" | "outline" | "plain";
type TilePos = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type WishlistConfig = {
  // Basics
  primaryColor: string;
  secondaryColor: string;
  icon: IconType;
  // Product page – shared
  activeMode: "basic" | "advanced";
  labelBefore: string;
  labelAfter: string;
  wishlistMode: "single" | "multi";
  wishlistEnabled: boolean;
  backInStockEnabled: boolean;
  smartSave: boolean;
  smartSaveVisits: number;
  smartSavePosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  smartSaveLoggedInOnly: boolean;
  boostEngagement: boolean;
  loginNudge: boolean;
  wishlistNudge: boolean;
  worksWithoutCookies: boolean;
  askPermission: boolean;
  socialProof: boolean;
  // Product page – basic
  basicPlacement: "near-cart" | "on-image";
  basicPosition: "above" | "left" | "below" | "right";
  basicType: BtnType;
  basicStyle: BtnStyle;
  // Product page – advanced
  theme: string;
  advPosition: "inline" | "overlay" | "title" | "custom";
  cssSelector: string;
  advType: BtnType;
  htmlBefore: string;
  htmlAfter: string;
  css: string;
  // Collections
  quickSaveEnabled: boolean;
  collProductSelector: string;
  collButtonSelector: string;
  collIconColor: string;
  collThickness: number;
  collPosition: TilePos;
  circularBg: boolean;
  collHtml: string;
  collCss: string;
  // Wishlist page
  pageType: "drawer" | "page";
  pageTitle: string;
  showNotifications: boolean;
  closeNotificationsAutomatically: boolean;
  notificationCloseAfter: number;
  allowShare: boolean;
  // Launch point
  launchFrom: "header" | "floating" | "menu";
  headerDesktopSelector: string;
  headerMobileSelector: string;
  floatingPosition: "left" | "right" | "bottom-left" | "bottom-right";
  showCount: boolean;
  // Cart
  saveLaterMode: "popup" | "inline" | "disabled";
  saveLaterTitle: string;
  saveLaterPrimary: string;
  saveLaterSecondary: string;
  saveLaterPermission: "ask" | "always";
};

const ICON_PATHS: Record<IconType, string> = {
  heart: "M12 21s-7.5-4.6-9.5-9.3C1.2 8.6 3 5 6.4 5c2 0 3.6 1.1 4.6 2.7h2C14 6.1 15.6 5 17.6 5 21 5 22.8 8.6 21.5 11.7 19.5 16.4 12 21 12 21Z",
  star: "m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 16.9 6.4 20l1.2-6.2L3 9.5l6.3-.8L12 3Z",
  bookmark: "M6 3h12v18l-6-4.5L6 21V3Z",
};

function WIcon({
  type,
  size = 18,
  color = "currentColor",
  fill = "none",
  stroke = 2,
}: {
  type: IconType;
  size?: number;
  color?: string;
  fill?: string;
  stroke?: number;
}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={color} strokeWidth={stroke} strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[type]} />
    </svg>
  );
}

const buildHtml = (icon: IconType, type: BtnType, label: string) => {
  const svg = `  <svg class="wl-icon" width="20" height="20" viewBox="0 0 24 24">\n    <path d="${ICON_PATHS[icon]}"/>\n  </svg>\n`;
  const text = `  <span class="wl-custom-btn-txt">${label}</span>\n`;
  return `<button class="wl-icon-text" type="button">\n${type !== "text" ? svg : ""}${type !== "icon" ? text : ""}</button>`;
};

const DEFAULT_CSS = `.wl-icon-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  border-radius: 0;
  gap: 8px;
  padding: 12px 20px;
  border: 1px solid var(--wl-primary);
  background: var(--wl-primary);
  color: var(--wl-secondary);
  cursor: pointer;
}
.wl-icon { fill: none; stroke: currentColor; stroke-width: 2; }`;

const POS_CSS: Record<TilePos, string> = {
  "top-left": "top: 8px;\n  left: 8px;",
  "top-right": "top: 8px;\n  right: 8px;",
  "bottom-left": "bottom: 8px;\n  left: 8px;",
  "bottom-right": "bottom: 8px;\n  right: 8px;",
};

const buildCollHtml = (icon: IconType) =>
  `<button class="wl-quick-save" type="button" aria-label="Save to wishlist">\n  <svg width="20" height="20" viewBox="0 0 24 24">\n    <path d="${ICON_PATHS[icon]}"/>\n  </svg>\n</button>`;

const buildCollCss = (c: Pick<WishlistConfig, "collIconColor" | "collThickness" | "collPosition" | "circularBg">) =>
  `.wl-quick-save {
  position: absolute;
  ${POS_CSS[c.collPosition]}
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  cursor: pointer;
  background: ${c.circularBg ? "#fff" : "transparent"};
  border-radius: 50%;${c.circularBg ? "\n  box-shadow: 0 1px 4px rgba(0,0,0,.25);" : ""}
}
.wl-quick-save svg {
  fill: none;
  stroke: ${c.collIconColor};
  stroke-width: ${c.collThickness}px;
}`;

const DEFAULT_CONFIG: WishlistConfig = {
  primaryColor: "#000000",
  secondaryColor: "#ffffff",
  icon: "heart",
  activeMode: "advanced",
  labelBefore: "Add To Wishlist",
  labelAfter: "Added To Wishlist",
  wishlistMode: "single",
  wishlistEnabled: true,
  backInStockEnabled: true,
  smartSave: true,
  smartSaveVisits: 3,
  smartSavePosition: "top-left",
  smartSaveLoggedInOnly: true,
  boostEngagement: true,
  loginNudge: true,
  wishlistNudge: false,
  worksWithoutCookies: false,
  askPermission: true,
  socialProof: false,
  basicPlacement: "near-cart",
  basicPosition: "below",
  basicType: "icon-text",
  basicStyle: "solid",
  theme: "Dawn (Live Theme)",
  advPosition: "inline",
  cssSelector: "#wl-custom-wishlist-button",
  advType: "icon-text",
  htmlBefore: buildHtml("heart", "icon-text", "{{WishlistAddCTA}}"),
  htmlAfter: buildHtml("heart", "icon-text", "{{WishlistAddedCTA}}"),
  css: DEFAULT_CSS,
  quickSaveEnabled: true,
  collProductSelector: ".card.card--standard a.full-unstyled-link, .card.card--standard a.full-unstyled-link",
  collButtonSelector: "div#ProductGridContainer .card.card--standard, .product-grid .grid__item .card-wrapper.product-card-wrapper",
  collIconColor: "#000000",
  collThickness: 1.7,
  collPosition: "top-left",
  circularBg: true,
  collHtml: buildCollHtml("heart"),
  collCss: buildCollCss({ collIconColor: "#000000", collThickness: 1.7, collPosition: "top-left", circularBg: true }),
  pageType: "page",
  pageTitle: "My Wishlist",
  showNotifications: true,
  closeNotificationsAutomatically: true,
  notificationCloseAfter: 5,
  allowShare: true,
  launchFrom: "floating",
  headerDesktopSelector: "",
  headerMobileSelector: "",
  floatingPosition: "bottom-right",
  showCount: true,
  saveLaterMode: "popup",
  saveLaterTitle: "Do you want to save this product for later?",
  saveLaterPrimary: "Save For later",
  saveLaterSecondary: "No, thanks!",
  saveLaterPermission: "always",
};

/* -------------------------------------------------------------------------- */
/*  Loader / action                                                           */
/* -------------------------------------------------------------------------- */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, shop } = await requireAdminShop(request);
  const uiConfig = await db.uIConfig.findUnique({ where: { shopId: shop.id } });
  const storedProductConfig = uiConfig?.productCardConfig as Record<string, unknown> | null;
  const backInStockEditor = embedEditorUrl(session.shop, "back-in-stock-app-embed");
  const emailProvider = isEmailProvider(shop.emailProvider)
    ? shop.emailProvider
    : "mailgun";
  const providerApiKey = getEmailProviderApiKey(shop, emailProvider);

  let currentPlanName = "Starter";
  let currentPlanCode = "starter";
  let canConfigureEmailProvider = false;
  let emailsSent = 0;
  let sentLabel = "this month";
  let plans: Array<{ code: string; name: string; monthlyPriceCents: number; allowance: number; allowanceWindow: string }> = [];
  try {
    const plan = await getShopPlan(shop.id);
    currentPlanName = plan.name;
    currentPlanCode = plan.code;
    canConfigureEmailProvider = plan.allowMerchantProvider;
    sentLabel = plan.allowanceWindow === "day" ? "today" : "this month";
    emailsSent = await emailsConsumedThisPeriod(shop.id, plan.allowanceWindow);
    plans = await db.plan.findMany({
      where: { active: true },
      orderBy: { monthlyPriceCents: "asc" },
      select: { code: true, name: true, monthlyPriceCents: true, allowance: true, allowanceWindow: true },
    });
  } catch {
    currentPlanName = "Starter";
    currentPlanCode = "starter";
  }

  return {
    shopDomain: session.shop,
    pricingPlansUrl: pricingPlansUrl(session.shop),
    currentPlanName,
    currentPlanCode,
    plans,
    canConfigureEmailProvider,
    emailsSent,
    sentLabel,
    backInStockEditor,
    wishlistConfig: (uiConfig?.productCardConfig as Partial<WishlistConfig> | null) ?? null,
    backInStockSettings: (storedProductConfig?.backInStockSettings as Partial<BackInStockSettings> | undefined) ?? null,
    shop: {
      emailProvider: shop.emailProvider,
      hasApiKey: Boolean(providerApiKey),
      apiKeyMasked: providerApiKey ? maskSecret(providerApiKey) : "",
      senderEmail: shop.senderEmail || "",
      senderName: shop.senderName || "",
      emailSubject: shop.emailSubject,
      emailHeading: shop.emailHeading,
      emailBody: shop.emailBody,
      buttonLabel: shop.buttonLabel,
      stockAlertDeliveryMode: shop.stockAlertDeliveryMode,
      stockAlertDeliveryTime: shop.stockAlertDeliveryTime,
      smsEnabled: shop.smsEnabled,
      whatsappEnabled: shop.whatsappEnabled,
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
  const { session, shop } = await requireAdminShop(request);
  const formData = await request.formData();

  if (formData.get("intent") === "saveBackInStockSettings") {
    let settings: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(String(formData.get("settings") || "{}"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid settings");
      settings = parsed as Record<string, unknown>;
      const textFields: Record<string, number> = {
        buttonText: 60,
        formHeading: 200,
        emailPlaceholder: 200,
        emailButton: 60,
        smsPlaceholder: 200,
        confirmation: 500,
        from: 120,
        replyTo: 254,
        subject: 500,
        headline: 500,
        emailButtonText: 60,
        footer: 2000,
        headerText: 80,
      };
      for (const [key, maxLength] of Object.entries(textFields)) {
        if (typeof settings[key] !== "string" || settings[key].length > maxLength) throw new Error("Invalid text setting");
      }
      if (typeof settings.logoUrl !== "string" || settings.logoUrl.length > 400000) throw new Error("Invalid logo");
      if (settings.logoUrl && !/^data:image\/(png|jpe?g);base64,/.test(settings.logoUrl)) throw new Error("Invalid logo");
      if (settings.launchType !== "inline" && settings.launchType !== "modal") throw new Error("Invalid launch type");
      if (!Number.isInteger(settings.minimumQuantity) || Number(settings.minimumQuantity) < 0 || Number(settings.minimumQuantity) > 999999) throw new Error("Invalid minimum quantity");
      if (!["next", "right", "left"].includes(String(settings.placement))) throw new Error("Invalid button placement");
      if (!["text", "iconText", "icon"].includes(String(settings.buttonType))) throw new Error("Invalid button type");
      if (!Number.isInteger(settings.textSize) || Number(settings.textSize) < 8 || Number(settings.textSize) > 40) throw new Error("Invalid text size");
      if (!Number.isInteger(settings.radius) || Number(settings.radius) < 0 || Number(settings.radius) > 50) throw new Error("Invalid button radius");
      if (typeof settings.buttonColor !== "string" || !/^#[0-9a-f]{6}$/i.test(settings.buttonColor)) throw new Error("Invalid button color");
      if (typeof settings.textColor !== "string" || !/^#[0-9a-f]{6}$/i.test(settings.textColor)) throw new Error("Invalid text color");
      if (settings.replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.replyTo))) throw new Error("Invalid reply-to email");
    } catch {
      return { saved: false, kind: "backInStockSettings" as const, error: "Check the settings and try again." };
    }

    try {
      await upsertUIConfigForShopDomain(session.shop, {
        productCardConfig: { backInStockSettings: settings as unknown as BackInStockSettings },
      });
      return { saved: true, kind: "backInStockSettings" as const };
    } catch {
      return { saved: false, kind: "backInStockSettings" as const, error: "Could not save back-in-stock settings." };
    }
  }

  if (formData.get("intent") === "saveFeatureFlags") {
    const wishlistEnabled = formData.get("wishlistEnabled") === "true";
    const backInStockEnabled = formData.get("backInStockEnabled") === "true";
    try {
      await upsertUIConfigForShopDomain(session.shop, {
        productCardConfig: { wishlistEnabled, backInStockEnabled },
      });
      return { saved: true, kind: "featureFlags" as const, wishlistEnabled, backInStockEnabled };
    } catch {
      return { saved: false, kind: "featureFlags" as const, wishlistEnabled, backInStockEnabled };
    }
  }

  if (formData.get("intent") === "enableMultiWishlist") {
    try {
      await upsertUIConfigForShopDomain(session.shop, {
        productCardConfig: { wishlistMode: "multi" },
        confirmation: String(formData.get("confirmation") || ""),
      });
      return { saved: true, kind: "multiWishlist" as const, error: null };
    } catch (error) {
      return { saved: false, kind: "multiWishlist" as const, error: error instanceof ProxyError ? error.message : "Could not enable Multi-Wishlist. Please try again." };
    }
  }

  if (formData.get("intent") === "saveWishlistConfig") {
    let config: unknown;
    try {
      config = JSON.parse(String(formData.get("config") || "{}"));
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid settings");
      const values = config as Record<string, unknown>;
      if (values.pageType === "modal") values.pageType = "drawer";
      if (values.wishlistMode != null && !["single", "multi"].includes(String(values.wishlistMode))) throw new Error("Invalid wishlist mode");
      if (values.pageType != null && !["drawer", "page"].includes(String(values.pageType))) throw new Error("Invalid wishlist page type");
      if (values.launchFrom != null && !["header", "floating", "menu"].includes(String(values.launchFrom))) throw new Error("Invalid launch point");
      if (values.floatingPosition != null && !["left", "right", "bottom-left", "bottom-right"].includes(String(values.floatingPosition))) throw new Error("Invalid floating button position");
      if (values.smartSaveVisits != null && (!Number.isInteger(values.smartSaveVisits) || Number(values.smartSaveVisits) < 1 || Number(values.smartSaveVisits) > 100)) throw new Error("Invalid visit threshold");
      if (values.smartSavePosition != null && !["top-left", "top-right", "bottom-left", "bottom-right"].includes(String(values.smartSavePosition))) throw new Error("Invalid notification position");
      if (values.notificationCloseAfter != null && (!Number.isInteger(values.notificationCloseAfter) || Number(values.notificationCloseAfter) < 1 || Number(values.notificationCloseAfter) > 60)) throw new Error("Invalid notification duration");
      for (const key of ["headerDesktopSelector", "headerMobileSelector"]) {
        if (values[key] != null && typeof values[key] !== "string") throw new Error("Invalid header selector");
      }
      for (const key of ["allowShare", "showNotifications", "closeNotificationsAutomatically", "smartSave", "smartSaveLoggedInOnly", "boostEngagement", "loginNudge", "wishlistNudge"]) {
        if (values[key] != null && typeof values[key] !== "boolean") throw new Error("Invalid feature setting");
      }
    } catch {
      return { saved: false, kind: "wishlistConfig" as const };
    }

    try {
      await upsertUIConfigForShopDomain(session.shop, {
        extensionActive: "wishlist",
        productCardConfig: config as Record<string, unknown>,
      });
    } catch (error) {
      return { saved: false, kind: "wishlistConfig" as const, error: error instanceof ProxyError ? error.message : "Could not save settings" };
    }

    return { saved: true, kind: "wishlistConfig" as const };
  }

  const requestedEmailProvider = String(formData.get("emailProvider") || shop.emailProvider || "mailgun");
  const emailProvider = isEmailProvider(requestedEmailProvider)
    ? requestedEmailProvider
    : "mailgun";
  const plan = await getShopPlan(shop.id).catch(() => null);
  const canConfigureEmailProvider = Boolean(plan?.allowMerchantProvider);
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
    ...(canConfigureEmailProvider
      ? {
          emailProvider,
          senderEmail: senderEmail || null,
          senderName: senderName || null,
        }
      : {}),
    emailSubject: emailSubject || shop.emailSubject,
    emailHeading: emailHeading || shop.emailHeading,
    emailBody: emailBody || shop.emailBody,
    buttonLabel: buttonLabel || shop.buttonLabel,
    stockAlertDeliveryMode: stockAlertDeliveryMode === "scheduled" ? "scheduled" : "immediate",
    stockAlertDeliveryTime: /^\d{2}:\d{2}$/.test(stockAlertDeliveryTime) ? stockAlertDeliveryTime : shop.stockAlertDeliveryTime,
    smsEnabled,
    twilioAccountSid: twilioAccountSid || null,
    twilioFromNumber: twilioFromNumber || null,
    wishlistRequiresLogin,
    doubleOptIn,
    alertsPerVariantCap: isNaN(alertsPerVariantCap) ? 0 : alertsPerVariantCap,
  };

  if (apiKeyRaw && canConfigureEmailProvider) {
    updateData.apiKey = encryptSecret(
      JSON.stringify({
        ...getEmailProviderApiKeys(shop),
        [emailProvider]: apiKeyRaw,
      }),
    );
  }
  if (twilioAuthTokenRaw && twilioAuthTokenRaw !== shop.twilioAuthToken) {
    updateData.twilioAuthToken = encryptSecret(twilioAuthTokenRaw);
  }

  await db.shop.update({ where: { id: shop.id }, data: updateData });
  invalidateShopCache(shop.shop);
  return { saved: true, kind: "settings" as const };
};

/* -------------------------------------------------------------------------- */
/*  Feature cards                                                             */
/* -------------------------------------------------------------------------- */

const MODAL_TABS = ["Basics", "Product Page", "Collections", "Wishlist Page", "Launch Point", "Cart"] as const;
type ModalTab = (typeof MODAL_TABS)[number];

type FeatureCard = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  variant: "wishlist" | "quick" | "later" | "smart" | "boost";
  tab: ModalTab;
};

function FeatureArt({ variant }: { variant: FeatureCard["variant"] }) {
  const heart = (x: number, y: number, s: number, fill: string) => (
    <path transform={`translate(${x} ${y}) scale(${s})`} d={ICON_PATHS.heart} fill={fill} />
  );
  return (
    <svg viewBox="0 0 180 130" width="100%" height="100%" aria-hidden="true">
      <rect x="16" y="24" width="148" height="84" rx="10" fill="#edf3f5" />
      {variant === "later" && (
        <>
          <rect x="30" y="38" width="46" height="46" rx="8" fill="#fff" />
          <path d="M96 52h50M96 66h36" stroke="#9aa8b3" strokeWidth="3" strokeLinecap="round" />
          <rect x="70" y="88" width="76" height="16" rx="8" fill="#dfeaf0" />
        </>
      )}
      {variant === "quick" && (
        <>
          <rect x="28" y="36" width="56" height="56" rx="6" fill="#fff" />
          <rect x="96" y="36" width="56" height="56" rx="6" fill="#fff" />
          {heart(126, 40, 0.9, "#ef6aa5")}
        </>
      )}
      {variant === "wishlist" && (
        <>
          <rect x="28" y="36" width="60" height="64" rx="6" fill="#fff" />
          <rect x="100" y="40" width="52" height="10" rx="4" fill="#dfeaf0" />
          <rect x="100" y="60" width="52" height="16" rx="4" fill="#fcdde9" />
          {heart(104, 60, 0.6, "#ef6aa5")}
        </>
      )}
      {(variant === "smart" || variant === "boost") && (
        <>
          <ellipse cx="82" cy="78" rx="34" ry="22" fill="#a9d4e2" />
          <circle cx="126" cy="46" r="16" fill="#8b5cf6" />
          {heart(116, 36, 0.8, "#fff")}
        </>
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small reusable pieces                                                     */
/* -------------------------------------------------------------------------- */

function ColorField({
  label,
  value,
  onChange,
  variant = "dropdown",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  variant?: "dropdown" | "field";
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const normalize = (color: string) => {
    const hex = color.trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return `#${hex.split("").map((digit) => digit + digit).join("")}`;
    }
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
  };
  const update = (color: string) => {
    setDraft(color);
    const valid = normalize(color);
    if (valid) onChange(valid);
  };
  return (
    <div className={variant === "field" ? "wl-color-field" : "wl-color-btn"}>
      <input
        type="color"
        className="wl-color-picker"
        value={normalize(value) || "#000000"}
        onChange={(event) => update(event.target.value)}
        aria-label={`${label} picker`}
      />
      <input
        type="text"
        className="wl-color-hex"
        aria-label={`${label} HEX value`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const valid = normalize(draft);
          if (valid) { onChange(valid); setDraft(valid); }
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        }}
        autoComplete="off"
        spellCheck={false}
        maxLength={7}
      />
    </div>
  );
}

function RadioGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  inline,
  disabled,
}: {
  name: string;
  value: T;
  options: { value: T; label: string; help?: string }[];
  onChange: (v: T) => void;
  inline?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={inline ? "wl-radio-inline" : "wl-radio-stack"}>
      {options.map((o) => (
        <RadioButton
          key={o.value}
          id={`${name}-${o.value}`}
          name={name}
          label={o.label}
          helpText={o.help}
          checked={value === o.value}
          disabled={disabled}
          onChange={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}

function PillTabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="wl-pills" role="tablist">
      {items.map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={value === i.id} className={value === i.id ? "active" : ""} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <BlockStack gap="300">
    <Text as="h3" variant="headingSm">
      {title}
    </Text>
    {children}
  </BlockStack>
);

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="wl-field-row">
    <Text as="span" variant="bodySm">
      {label}
    </Text>
    <div>{children}</div>
  </div>
);

const IconChoice = ({ value, onChange }: { value: IconType; onChange: (v: IconType) => void }) => (
  <div className="wl-icon-options">
    {(["heart", "star", "bookmark"] as IconType[]).map((t) => (
      <label key={t} className={`wl-icon-option ${value === t ? "selected" : ""}`}>
        <input type="radio" name="icon-choice" checked={value === t} onChange={() => onChange(t)} />
        <span style={{ textTransform: "capitalize" }}>{t}</span>
        <WIcon type={t} size={16} />
      </label>
    ))}
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export default function Settings() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [searchParams] = useSearchParams();
  const showingSaveFeatures = searchParams.get("section") === "save";
  const showingBackInStock = searchParams.get("section") === "back-in-stock";
  const overviewParams = new URLSearchParams(searchParams);
  overviewParams.delete("section");
  const overviewUrl = `/app/settings${overviewParams.size ? `?${overviewParams}` : ""}`;
  const featureParams = new URLSearchParams(searchParams);
  featureParams.set("section", "save");
  const backInStockParams = new URLSearchParams(searchParams);
  backInStockParams.set("section", "back-in-stock");

  const [smartSaveOpen, setSmartSaveOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTab, setSelectedTab] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<ModalTab>("Basics");
  const featureFetcher = useFetcher<typeof action>();

  const [saved, setSaved] = useState<WishlistConfig>(() => {
    const config = { ...DEFAULT_CONFIG, ...(loaderData.wishlistConfig ?? {}) } as WishlistConfig;
    if ((loaderData.wishlistConfig as Record<string, unknown> | null)?.pageType === "modal") {
      config.pageType = "drawer";
    }
    return config;
  });
  const [cfg, setCfg] = useState<WishlistConfig>(saved);

  const [ppView, setPpView] = useState<"basic" | "advanced">("advanced");
  const [infoOpen, setInfoOpen] = useState(true);
  const [textTab, setTextTab] = useState<"before" | "after">("before");
  const [codeTab, setCodeTab] = useState<"htmlBefore" | "htmlAfter" | "css">("htmlBefore");
  const [advancedCodeOpen, setAdvancedCodeOpen] = useState(false);
  const [collPreview, setCollPreview] = useState<"mock" | "code">("mock");
  const [collCodeTab, setCollCodeTab] = useState<"collHtml" | "collCss">("collHtml");
  const [editing, setEditing] = useState(false);
  const [previewWishlisted, setPreviewWishlisted] = useState(false);

  const set = <K extends keyof WishlistConfig>(key: K, value: WishlistConfig[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));

  /** Update collection settings and regenerate the preset HTML/CSS (as the reference app does). */
  const setColl = (patch: Partial<WishlistConfig>) =>
    setCfg((c) => {
      const next = { ...c, ...patch };
      return { ...next, collHtml: buildCollHtml(next.icon), collCss: buildCollCss(next) };
    });

  const setIcon = (icon: IconType) =>
    setCfg((c) => {
      const next = { ...c, icon };
      return {
        ...next,
        htmlBefore: buildHtml(icon, next.advType, "{{WishlistAddCTA}}"),
        htmlAfter: buildHtml(icon, next.advType, "{{WishlistAddedCTA}}"),
        collHtml: buildCollHtml(icon),
      };
    });

  useEffect(() => {
    if (actionData?.saved && actionData.kind === "settings") shopify.toast.show("Settings saved");
  }, [actionData, shopify]);

  useEffect(() => {
    if (fetcher.data?.kind === "wishlistConfig") {
      if (fetcher.data.saved) {
        setSaved(cfg);
        shopify.toast.show("Settings saved");
      } else {
        shopify.toast.show(("error" in fetcher.data && fetcher.data.error) || "Could not save settings", { isError: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  useEffect(() => {
    const result = featureFetcher.data;
    if (result?.kind !== "featureFlags") return;
    if (result.saved) {
      setSaved((current) => ({
        ...current,
        wishlistEnabled: result.wishlistEnabled,
        backInStockEnabled: result.backInStockEnabled,
      }));
      shopify.toast.show("Feature settings saved");
    } else {
      shopify.toast.show("Could not save feature settings", { isError: true });
    }
  }, [featureFetcher.data, shopify]);

  const toggleFeature = (feature: "wishlist" | "backInStock", enabled: boolean) => {
    const next = {
      wishlistEnabled: feature === "wishlist" ? enabled : saved.wishlistEnabled,
      backInStockEnabled: feature === "backInStock" ? enabled : saved.backInStockEnabled,
    };
    const formData = new FormData();
    formData.set("intent", "saveFeatureFlags");
    formData.set("wishlistEnabled", String(next.wishlistEnabled));
    formData.set("backInStockEnabled", String(next.backInStockEnabled));
    featureFetcher.submit(formData, { method: "post" });
  };

  const features: FeatureCard[] = [
    { id: "wishlist-button", title: "Wishlist button", description: "Shoppers can save products from product details page", enabled: saved.wishlistEnabled, variant: "wishlist", tab: "Product Page" },
    { id: "quick-save", title: "Quick save", description: "Shoppers can add items to wishlist from collections", enabled: saved.wishlistEnabled && saved.quickSaveEnabled, variant: "quick", tab: "Collections" },
    { id: "save-later", title: "Save for later", description: "Prompt to save items when shoppers remove them from cart", enabled: saved.wishlistEnabled && saved.saveLaterMode !== "disabled", variant: "later", tab: "Cart" },
    { id: "smart-save", title: "Smart save", description: `Auto-wishlist products after ${saved.smartSaveVisits} visits by the shopper`, enabled: saved.wishlistEnabled && saved.smartSave, variant: "smart", tab: "Product Page" },
    { id: "boost-engagement", title: "Boost wishlist engagement", description: "Show subtle, non-intrusive tooltips and toasts that guide new shoppers on how and why to use their wishlist", enabled: saved.wishlistEnabled && saved.boostEngagement, variant: "boost", tab: "Basics" },
  ];

  const filterOptions = [
    { id: "all", content: "All" },
    { id: "enabled", content: "Enabled" },
    { id: "disabled", content: "Disabled" },
  ] as const;

  const filtered = features.filter((f) => {
    const match = f.title.toLowerCase().includes(search.trim().toLowerCase());
    const id = filterOptions[selectedTab].id;
    return match && (id === "all" || (id === "enabled" ? f.enabled : !f.enabled));
  });

  const openSettings = (f: FeatureCard) => {
    setCfg(saved);
    if (f.id === "smart-save" || f.id === "boost-engagement") {
      setSmartSaveOpen(true);
      return;
    }
    setPpView(saved.activeMode);
    setTab(f.tab);
    setEditing(false);
    setAdvancedCodeOpen(false);
    setPreviewWishlisted(false);
    setCollPreview("mock");
    setIsOpen(true);
  };

  const closeSettings = () => setIsOpen(false);

  const saveSettings = () => {
    const payload: WishlistConfig = !smartSaveOpen && tab === "Product Page" ? { ...cfg, activeMode: ppView } : cfg;
    setCfg(payload);
    const fd = new FormData();
    fd.set("intent", "saveWishlistConfig");
    fd.set("config", JSON.stringify(payload));
    fetcher.submit(fd, { method: "post" });
  };

  /* ------------------------------ Left panels ------------------------------ */

  const basicDisabled = ppView === "basic" && cfg.activeMode === "advanced";

  const typeOptions: { value: BtnType; label: string }[] = [
    { value: "icon-text", label: "Icon & Text" },
    { value: "text", label: "Only Text" },
    { value: "icon", label: "Only Icon" },
  ];

  const otherSettings = (
    <Section title="Other Settings">
      <Checkbox
        label="Smart-Save: Auto-wishlist products viewed thrice or more by the shopper"
        checked={cfg.smartSave}
        onChange={(v) => set("smartSave", v)}
      />
      <Checkbox
        label="Social Proof: Show number of shoppers who wishlisted the product"
        checked={cfg.socialProof}
        onChange={(v) => set("socialProof", v)}
      />
    </Section>
  );

  const renderBasics = () => (
    <BlockStack gap="400">
      <Section title="Colors">
        <FieldRow label="Primary Color">
          <ColorField label="Primary Color" value={cfg.primaryColor} onChange={(v) => set("primaryColor", v)} />
        </FieldRow>
        <Divider />
        <FieldRow label="Secondary Color">
          <ColorField label="Secondary Color" value={cfg.secondaryColor} onChange={(v) => set("secondaryColor", v)} />
        </FieldRow>
      </Section>
      <Divider />
      <Section title="Icons">
        <IconChoice value={cfg.icon} onChange={setIcon} />
      </Section>
    </BlockStack>
  );

  const renderProductPage = () => (
    <BlockStack gap="400">
      <ButtonGroup variant="segmented" fullWidth>
        <Button pressed={ppView === "basic"} onClick={() => {
          setPpView("basic");
          setAdvancedCodeOpen(false);
          setEditing(false);
          setPreviewWishlisted(false);
        }}>
          Basic Button
        </Button>
        <Button pressed={ppView === "advanced"} onClick={() => {
          setPpView("advanced");
          setAdvancedCodeOpen(false);
          setEditing(false);
          setPreviewWishlisted(false);
        }}>
          Advanced Button
        </Button>
      </ButtonGroup>

      {infoOpen && (
        <Banner tone="info" title={ppView === "basic" ? "When to use Basic Button" : "When to use Advanced Button"} onDismiss={() => setInfoOpen(false)}>
          {ppView === "basic" ? (
            <p>For basic out-of-the-box customisation.</p>
          ) : (
            <p>
              Get full control of your button via HTML &amp; CSS editing.{" "}
              <Link url={TUTORIAL_URL} external>
                Read Tutorial
              </Link>
            </p>
          )}
        </Banner>
      )}

      {ppView === "basic" ? (
        <>
          {cfg.activeMode === "advanced" && (
            <>
              <Banner tone="success">
                <BlockStack gap="200">
                  <p>The Advanced Button is active on your live theme ({cfg.theme}).</p>
                  <Button fullWidth variant="primary" onClick={() => setPpView("advanced")}>
                    Customize Button
                  </Button>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="100">
                  <p>Switching to Basic Button will deactivate Advanced Button on your live theme.</p>
                  <Button variant="plain" onClick={() => set("activeMode", "basic")}>
                    How to switch to Basic Button
                  </Button>
                </BlockStack>
              </Banner>
            </>
          )}

          <fieldset disabled={basicDisabled} className={basicDisabled ? "wl-disabled" : ""}>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Text as="span" variant="headingSm">
                  Button Position
                </Text>
                <PillTabs
                  items={[
                    { id: "near-cart", label: "Near cart button" },
                    { id: "on-image", label: "On product image" },
                  ]}
                  value={cfg.basicPlacement}
                  onChange={(v) => set("basicPlacement", v as WishlistConfig["basicPlacement"])}
                />
              </InlineStack>
              {cfg.basicPlacement === "near-cart" && (
                <div className="wl-grid-2">
                  {(
                    [
                      ["above", "Above Cart Button"],
                      ["left", "Left of Cart Button"],
                      ["below", "Below Cart Button"],
                      ["right", "Right of Cart Button"],
                    ] as const
                  ).map(([v, l]) => (
                    <RadioButton key={v} id={`pos-${v}`} name="basicPosition" label={l} checked={cfg.basicPosition === v} onChange={() => set("basicPosition", v)} />
                  ))}
                </div>
              )}

              <Text as="h4" variant="headingSm">
                Button Type
              </Text>
              <RadioGroup
                inline
                name="basicType"
                value={cfg.basicType}
                onChange={(v) => set("basicType", v)}
                options={[
                  { value: "icon-text", label: "Icon and Text" },
                  { value: "text", label: "Only Text" },
                  { value: "icon", label: "Only Icon" },
                ]}
              />

              <Text as="h4" variant="headingSm">
                Appearance
              </Text>
              <InlineStack gap="400" blockAlign="center">
                <Text as="span" variant="bodySm">
                  Button Style
                </Text>
                <RadioGroup
                  inline
                  name="basicStyle"
                  value={cfg.basicStyle}
                  onChange={(v) => set("basicStyle", v)}
                  options={[
                    { value: "solid", label: "Solid" },
                    { value: "outline", label: "Outline" },
                    { value: "plain", label: "Plain" },
                  ]}
                />
              </InlineStack>

              <Divider />
              <InlineStack gap="300" blockAlign="center">
                <Text as="span" variant="headingSm">
                  Button Text
                </Text>
                <PillTabs
                  items={[
                    { id: "before", label: "Before Click" },
                    { id: "after", label: "After Click" },
                  ]}
                  value={textTab}
                  onChange={(v) => setTextTab(v as "before" | "after")}
                />
              </InlineStack>
              <TextField
                label="Label"
                value={textTab === "before" ? cfg.labelBefore : cfg.labelAfter}
                onChange={(v) => set(textTab === "before" ? "labelBefore" : "labelAfter", v)}
                autoComplete="off"
              />
              <Divider />
              {otherSettings}
            </BlockStack>
          </fieldset>
        </>
      ) : (
        <BlockStack gap="400">
          {/* <Select label="Theme" options={["Dawn (Live Theme)", "Custom"]} value={cfg.theme} onChange={(v) => set("theme", v)} /> */}
          <Divider />
          <Text as="h4" variant="headingSm">
            Button Position
          </Text>
          <div className="wl-radio-list">
            {(
              [
                ["inline", "Inline with Product Details", "Positioned above or below the title, price, or buy button. Configure the exact location in the Theme Editor."],
                ["overlay", "Overlay on Product Image", "Default: Top Right. Custom positioning available via CSS."],
                ["title", "Product Title", "Near product title. Default: To the right of the title. Custom positioning available via CSS."],
                ["custom", "Custom Placement", ""],
              ] as const
            ).map(([v, l, help]) => (
              <div key={v} className="wl-radio-item">
                <RadioButton id={`adv-${v}`} name="advPosition" label={l} helpText={help || undefined} checked={cfg.advPosition === v} onChange={() => set("advPosition", v)} />
                {v === "custom" && (
                  <div style={{ paddingLeft: 24 }}>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Anchor the button to a specific page element using a CSS selector.{" "}
                      <Link url={SELECTOR_HELP_URL} external>
                        See how
                      </Link>
                    </Text>
                    <div style={{ marginTop: 8 }}>
                      <TextField label="CSS Selector" value={cfg.cssSelector} onChange={(v) => set("cssSelector", v)} autoComplete="off" disabled={cfg.advPosition !== "custom"} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Divider />
          <Text as="h4" variant="headingSm">
            Button Type
          </Text>
          <RadioGroup
            inline
            name="advType"
            value={cfg.advType}
            options={typeOptions}
            onChange={(v) =>
              setCfg((c) => ({
                ...c,
                advType: v,
                htmlBefore: buildHtml(c.icon, v, "{{WishlistAddCTA}}"),
                htmlAfter: buildHtml(c.icon, v, "{{WishlistAddedCTA}}"),
              }))
            }
          />
          <Divider />
          <Text as="h4" variant="headingSm">
            Button Text
          </Text>
          <InlineStack gap="300" wrap={false}>
            <div style={{ flex: 1 }}>
              <TextField label="Before Click" value={cfg.labelBefore} onChange={(v) => set("labelBefore", v)} autoComplete="off" />
            </div>
            <div style={{ flex: 1 }}>
              <TextField label="After Click" value={cfg.labelAfter} onChange={(v) => set("labelAfter", v)} autoComplete="off" />
            </div>
          </InlineStack>
          <Divider />
          {otherSettings}
        </BlockStack>
      )}
    </BlockStack>
  );

  const renderCollections = () => (
    <BlockStack gap="400">
      {/* <Section title="Theme Selection"> */}
        {/* <div style={{ maxWidth: 260 }}>
          <Select label="Theme" labelHidden options={["Dawn (Live Theme)", "Custom"]} value={cfg.theme} onChange={(v) => set("theme", v)} />
        </div> */}
        <Checkbox
          label="Enable Wishlist button "
          helpText="Enable wishlist button on Collections Pages"
          checked={cfg.quickSaveEnabled}
          onChange={(v) => set("quickSaveEnabled", v)}
        />
      {/* </Section> */}
      <Divider />
      <Section title="Theme Integration">
        <div style={{ maxWidth: 420 }}>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h4" variant="headingSm">
                Product URL Selector
              </Text>
              {/* <Text as="p" variant="bodySm" fontWeight="semibold">
                CSS selector to find product links on collection pages.{" "}
                <Link url={SELECTOR_HELP_URL} external>
                  How to find CSS selectors?
                </Link>
              </Text> */}
              <TextField label="Product URL Selector" labelHidden value={cfg.collProductSelector} onChange={(v) => set("collProductSelector", v)} autoComplete="off" />
              <Text as="p" variant="bodyXs" tone="subdued">
                Default: {DEFAULT_CONFIG.collProductSelector}
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="h4" variant="headingSm">
                Button Container Selector
              </Text>
              {/* <Text as="p" variant="bodySm" fontWeight="semibold"> */}
                {/* CSS selector for where to attach the wishlist button.{" "} */}
                {/* <Link url={SELECTOR_HELP_URL} external>
                  How to find CSS selectors?
                </Link> */}
              {/* </Text> */}
              <TextField label="Button Container Selector" labelHidden value={cfg.collButtonSelector} onChange={(v) => set("collButtonSelector", v)} autoComplete="off" />
              <Text as="p" variant="bodyXs" tone="subdued">
                Default: {DEFAULT_CONFIG.collButtonSelector}
              </Text>
            </BlockStack>
          </BlockStack>
        </div>
      </Section>
      <Divider />
      <Section title="Icon Type">
        <IconChoice value={cfg.icon} onChange={setIcon} />
        <Text as="p" variant="bodyXs" tone="subdued">
          Choose the icon that will appear on the wishlist button. Icon type changes will regenerate HTML from templates (if using preset HTML).
        </Text>
      </Section>
      <div style={{ maxWidth: 420 }}>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h4" variant="headingSm">
              Icon Color
            </Text>
            <ColorField variant="field" label="Icon Color" value={cfg.collIconColor} onChange={(v) => setColl({ collIconColor: v })} />
            <Text as="p" variant="bodyXs" tone="subdued">
              Color applies to the SVG stroke property. For more granular control, edit the HTML/CSS directly in the code editor.
            </Text>
          </BlockStack>
          <BlockStack gap="100">
            <RangeSlider
              label="Icon Thickness"
              min={0.5}
              max={3}
              step={0.1}
              value={cfg.collThickness}
              output
              suffix={<span style={{ minWidth: 40, textAlign: "right" }}>{cfg.collThickness.toFixed(1)} px</span>}
              onChange={(v) => setColl({ collThickness: Array.isArray(v) ? v[0] : v })}
            />
            <Text as="p" variant="bodySm" tone="subdued">
              Thickness applies to the SVG stroke-width property. For more granular control, edit the HTML/CSS directly in the code editor.
            </Text>
          </BlockStack>
          <Select
            label="Button Position on tile"
            value={cfg.collPosition}
            onChange={(v) => setColl({ collPosition: v as TilePos })}
            options={[
              { label: "Top left of the tile", value: "top-left" },
              { label: "Top right of the tile", value: "top-right" },
              { label: "Bottom left of the tile", value: "bottom-left" },
              { label: "Bottom right of the tile", value: "bottom-right" },
            ]}
          />
        </BlockStack>
      </div>
      <Divider />
      <Section title="Other Settings">
        <Checkbox
          label="Enable circular background for collection icon"
          helpText="Adds a white circular background with shadow behind the icon to improve visibility on all product images"
          checked={cfg.circularBg}
          onChange={(v) => setColl({ circularBg: v })}
        />
      </Section>
    </BlockStack>
  );

  const renderWishlistPage = () => (
    <BlockStack gap="400">
      <Section title="Appearance">
        <Divider />
        <FieldRow label="Type">
          <RadioGroup
            inline
            name="pageType"
            value={cfg.pageType}
            onChange={(v) => set("pageType", v)}
            options={[
              { value: "drawer", label: "Side Drawer" },
              { value: "page", label: "Separate Page" },
            ]}
          />
        </FieldRow>
        <Divider />
        <FieldRow label="Page Title">
          <div style={{ maxWidth: 436 }}>
            <TextField label="Page Title" labelHidden value={cfg.pageTitle} onChange={(v) => set("pageTitle", v)} autoComplete="off" />
          </div>
        </FieldRow>
        <Divider />
      </Section>
      <Section title="Notifications">
        <BlockStack gap="400">
          <Checkbox
            label="Show wishlist notifications on your store"
            helpText="Shoppers see a short message when they save, remove, or move items."
            checked={cfg.showNotifications}
            onChange={(v) => set("showNotifications", v)}
          />
          <Checkbox
            label="Close the saved item notification automatically"
            helpText="Turn this off to keep it on screen until the shopper closes it. This helps shoppers who use screen readers. Other notifications are not affected."
            checked={cfg.closeNotificationsAutomatically}
            onChange={(v) => set("closeNotificationsAutomatically", v)}
            disabled={!cfg.showNotifications}
          />
          {cfg.showNotifications && cfg.closeNotificationsAutomatically && (
            <div style={{ maxWidth: 180 }}>
              <TextField
                label="Close after"
                value={String(cfg.notificationCloseAfter)}
                onChange={(value) => {
                  const seconds = Number.parseInt(value, 10);
                  if (Number.isFinite(seconds)) set("notificationCloseAfter", Math.max(1, Math.min(60, seconds)));
                }}
                type="number"
                min={1}
                max={60}
                suffix="seconds"
                autoComplete="off"
              />
            </div>
          )}
        </BlockStack>
      </Section>
      <Divider />
      <Section title="Other Settings">
        <Checkbox label="Allow shoppers to Share Wishlist" checked={cfg.allowShare} onChange={(v) => set("allowShare", v)} />
      </Section>
      <Divider />
      <Section title="Advanced Customizations">
        <Text as="p" variant="bodySm">
          Adjust colors, position, and more for your Wishlist page, notifications, and pop-ups in our App Embed in the Theme Editor.
        </Text>
        <InlineStack gap="200">
          {/* <Button size="slim" url={HELP_DOCS_URL} external>
            Read help docs
          </Button> */}
          <Button size="slim" url={themeEditorUrl(loaderData.shopDomain)} target="_blank">
            Go to Theme Editor
          </Button>
        </InlineStack>
      </Section>
    </BlockStack>
  );

  const renderLaunch = () => (
    <BlockStack gap="400">
      <Section title="Where should the Wishlist page launch from?">
        <RadioGroup
          inline
          name="launchFrom"
          value={cfg.launchFrom}
          onChange={(v) => set("launchFrom", v)}
          options={[
            { value: "header", label: "Header" },
            { value: "floating", label: "Floating Button" },
            { value: "menu", label: "Navigation Menu" },
          ]}
        />
      </Section>
      {/* {cfg.launchFrom === "header" && <>
        <Divider />
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">Header placement</Text>
          <TextField label="CSS Selector — Desktop & Tablet" value={cfg.headerDesktopSelector} onChange={(v) => set("headerDesktopSelector", v)} helpText="Optional. Enter the element the wishlist icon should appear next to. Leave blank to detect your theme header automatically." autoComplete="off" />
          <TextField label="CSS Selector — Mobile" value={cfg.headerMobileSelector} onChange={(v) => set("headerMobileSelector", v)} helpText="Optional. Used on screens smaller than 750px." autoComplete="off" />
        </BlockStack>
      </>} */}
      {cfg.launchFrom === "floating" && <>
        <Divider />
        <FieldRow label="Position">
          <div className="wl-grid-2" style={{ maxWidth: 260 }}>
            {(
              [["left", "Left"], ["right", "Right"], ["bottom-left", "Bottom Left"], ["bottom-right", "Bottom Right"]] as const
            ).map(([v, l]) => (
              <RadioButton key={v} id={`fp-${v}`} name="floatingPosition" label={l} checked={cfg.floatingPosition === v} onChange={() => set("floatingPosition", v)} />
            ))}
          </div>
        </FieldRow>
      </>}
      {cfg.launchFrom === "menu" && <>
        <Divider />
        <Banner tone="info">A Wishlist link is added to compatible desktop and mobile navigation menus. Add a link to your wishlist page in your theme navigation if your theme uses a custom menu.</Banner>
      </>}
      {cfg.launchFrom !== "menu" && <>
        <Divider />
        <Section title="Other Settings">
          <Checkbox label="Show Wishlist Count" checked={cfg.showCount} onChange={(v) => set("showCount", v)} />
        </Section>
      </>}
    </BlockStack>
  );

  const renderCart = () => {
    const popup = cfg.saveLaterMode === "popup";
    const inline = cfg.saveLaterMode === "inline";
    const disabled = cfg.saveLaterMode === "disabled";
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Save for later pop-up
        </Text>

        <div className={`wl-option-card ${popup ? "selected" : ""}`}>
          <InlineStack align="space-between" blockAlign="center">
            <RadioButton id="sl-popup" name="saveLaterMode" label="Pop-up on cart delete" checked={popup} onChange={() => set("saveLaterMode", "popup")} />
            <Badge tone="success">Live</Badge>
          </InlineStack>
          {popup && (
            <div className="wl-option-fields">
              <FieldRow label="Pop-up title">
                <TextField label="Pop-up title" labelHidden value={cfg.saveLaterTitle} onChange={(v) => set("saveLaterTitle", v)} autoComplete="off" />
              </FieldRow>
              <Divider />
              <FieldRow label="Primary button text">
                <TextField label="Primary button text" labelHidden value={cfg.saveLaterPrimary} onChange={(v) => set("saveLaterPrimary", v)} autoComplete="off" />
              </FieldRow>
              <Divider />
              <FieldRow label="Secondary button text">
                <TextField label="Secondary button text" labelHidden value={cfg.saveLaterSecondary} onChange={(v) => set("saveLaterSecondary", v)} autoComplete="off" />
              </FieldRow>
              <Divider />
              <FieldRow label="Permission">
                <RadioGroup
                  name="permission"
                  value={cfg.saveLaterPermission}
                  onChange={(v) => set("saveLaterPermission", v)}
                  options={[
                    { value: "ask", label: "Ask the shopper if they want to see the pop-up again" },
                    { value: "always", label: "Always show the pop-up" },
                  ]}
                />
              </FieldRow>
            </div>
          )}
        </div>

        <div className={`wl-option-card ${cfg.saveLaterMode === "inline" ? "selected" : ""}`}>
          <InlineStack align="space-between" blockAlign="center">
            <RadioButton id="sl-inline" name="saveLaterMode" label="Inline cart-line-item link" checked={cfg.saveLaterMode === "inline"} onChange={() => set("saveLaterMode", "inline")} />
            <Badge tone="warning">Coming soon</Badge>
          </InlineStack>
          {inline && (
            <div className="wl-cart-message" role="status">
              Inline Save for Later needs a small theme-specific setup because cart implementations vary between themes. The current storefront integration will add the link where your theme exposes cart remove controls.
            </div>
          )}
        </div>

        <div className={`wl-option-card ${cfg.saveLaterMode === "disabled" ? "selected" : ""}`}>
          <RadioButton id="sl-off" name="saveLaterMode" label="Disable Save for Later" checked={cfg.saveLaterMode === "disabled"} onChange={() => set("saveLaterMode", "disabled")} />
          {disabled && <Text as="p" variant="bodySm" tone="subdued">Save for Later will stop showing on this store after you save. You can re-enable it any time.</Text>}
        </div>

        <div className="wl-wishlist-picks">
          <Badge tone="info">New</Badge>
          <Text as="h3" variant="headingSm">Wishlist Picks</Text>
          <Text as="p" variant="bodySm" tone="subdued">Personalized wishlist recommendations will appear here when this feature is available.</Text>
        </div>
      </BlockStack>
    );
  };

  const renderForm = () => {
    switch (tab) {
      case "Basics":
        return renderBasics();
      case "Product Page":
        return renderProductPage();
      case "Collections":
        return renderCollections();
      case "Wishlist Page":
        return renderWishlistPage();
      case "Launch Point":
        return renderLaunch();
      case "Cart":
        return renderCart();
    }
  };

  /* ----------------------------- Right: previews ---------------------------- */

  const solidBtn = (style: BtnStyle): React.CSSProperties => {
    const base: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 44, fontWeight: 600, fontSize: 13 };
    if (style === "solid") return { ...base, background: cfg.primaryColor, color: cfg.secondaryColor, border: `1px solid ${cfg.primaryColor}` };
    if (style === "outline") return { ...base, background: "transparent", color: cfg.primaryColor, border: `1px solid ${cfg.primaryColor}` };
    return { ...base, background: "transparent", color: cfg.primaryColor, border: "1px solid transparent" };
  };

  const renderProductMock = () => {
    const basic = tab === "Product Page" && ppView === "basic";
    const advanced = tab === "Product Page" && ppView === "advanced";
    const type: BtnType = basic ? cfg.basicType : cfg.advType;
    const style: BtnStyle = basic ? cfg.basicStyle : "solid";
    const onImage = basic ? cfg.basicPlacement === "on-image" : advanced && cfg.advPosition === "overlay";
    const onTitle = advanced && cfg.advPosition === "title";
    const buttonLabel = previewWishlisted ? cfg.labelAfter : cfg.labelBefore;

    const btn = (
      <button
        type="button"
        aria-pressed={previewWishlisted}
        onClick={() => setPreviewWishlisted((current) => !current)}
        style={{
          ...solidBtn(style),
          cursor: "pointer",
          width: onImage || onTitle ? (type === "icon" ? 44 : "auto") : "100%",
          minWidth: onImage || onTitle ? 44 : undefined,
          padding: onImage || onTitle ? "0 12px" : undefined,
        }}
      >
        {type !== "text" && <WIcon type={cfg.icon} size={18} />}
        {type !== "icon" && <span>{buttonLabel}</span>}
      </button>
    );
    const cart = <div className="wl-ph" style={{ height: 44, width: "100%" }} />;
    const pos = basic && !onImage ? cfg.basicPosition : "below";

    let actions: React.ReactNode;
    if (onImage || onTitle) actions = cart;
    else if (pos === "above") actions = <>{btn}{cart}</>;
    else if (pos === "left") actions = <div className="wl-inline-row">{btn}{cart}</div>;
    else if (pos === "right") actions = <div className="wl-inline-row">{cart}{btn}</div>;
    else actions = <>{cart}{btn}</>;

    return (
      <div className="wl-product">
        <div className="wl-ph wl-product-img" style={{ position: "relative" }}>
          {onImage && (
            <div style={{ position: "absolute", top: 10, right: 10 }}>{btn}</div>
          )}
        </div>
        <div className="wl-product-info">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="wl-ph" style={{ height: 24, flex: 1 }} />
            {onTitle && btn}
          </div>
          <div className="wl-ph" style={{ height: 24, width: "65%" }} />
          <div style={{ height: 16 }} />
          <div className="wl-ph-line" />
          <div className="wl-ph-line" />
          <div className="wl-ph-line" style={{ width: "70%" }} />
          <div style={{ height: 16 }} />
          {actions}
          {advanced && cfg.advPosition === "custom" && (
            <div className="wl-preview-placement">Custom placement: {cfg.cssSelector || "CSS selector"}</div>
          )}
          {cfg.socialProof && (
            <Text as="p" variant="bodyXs" tone="subdued">
              12 shoppers wishlisted this
            </Text>
          )}
        </div>
      </div>
    );
  };

  const tilePos: Record<TilePos, React.CSSProperties> = {
    "top-left": { top: 14, left: 14 },
    "top-right": { top: 14, right: 14 },
    "bottom-left": { bottom: 14, left: 14 },
    "bottom-right": { bottom: 14, right: 14 },
  };

  const renderCollectionsMock = () => (
    <div className="wl-tiles">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="wl-tile">
          <div className="wl-ph" style={{ aspectRatio: "1.09", position: "relative" }}>
            {cfg.quickSaveEnabled && (
              <span
                className="wl-quick"
                style={{
                  ...tilePos[cfg.collPosition],
                  background: cfg.circularBg ? "#fff" : "transparent",
                  boxShadow: cfg.circularBg ? "0 1px 4px rgba(0,0,0,.25)" : "none",
                }}
              >
                <WIcon type={cfg.icon} size={18} color={cfg.collIconColor} stroke={cfg.collThickness} />
              </span>
            )}
          </div>
          <div className="wl-ph" style={{ height: 24, width: "75%", marginTop: 12 }} />
          <div className="wl-ph-line" style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  );

  const NavBar = ({ items }: { items: string[] }) => (
    <div className="wl-nav">
      {items.map((i) => (
        <span key={i}>{i}</span>
      ))}
      {cfg.launchFrom === "menu" && tab === "Launch Point" && <span>WISHLIST{cfg.showCount ? " (2)" : ""}</span>}
      <span className="wl-nav-actions">
        {cfg.launchFrom === "header" && tab === "Launch Point" ? (
          <span className="wl-nav-circle" style={{ position: "relative", background: cfg.primaryColor, color: cfg.secondaryColor }}>
            <WIcon type={cfg.icon} size={14} fill="currentColor" />
            {cfg.showCount && <b className="wl-badge">2</b>}
          </span>
        ) : (
          <span className="wl-nav-circle" />
        )}
        <span className="wl-nav-circle" />
        <span className="wl-nav-circle dark">🛒</span>
      </span>
    </div>
  );

  const renderWishlistMock = () => {
    const grid = (cols: number, n: number) => (
      <div className="wl-wgrid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div className="wl-ph" style={{ aspectRatio: "0.9" }} />
            <div className="wl-add">+ Add to Cart</div>
          </div>
        ))}
      </div>
    );
    const head = (
      <div className="wl-whead">
        <span>{cfg.pageTitle}</span>
        {cfg.allowShare && (
          <span className="wl-share">
            <span className="wl-nav-circle">⇪</span>Share
          </span>
        )}
      </div>
    );
    return (
      <div style={{ position: "relative" }}>
        <NavBar items={["HOME", "CATEGORIES"]} />
        {cfg.pageType === "page" && (
          <>
            {head}
            {grid(4, 8)}
          </>
        )}
        {cfg.pageType === "drawer" && (
          <div className="wl-overlay-wrap">
            <div className="wl-drawer">
              {head}
              {grid(2, 4)}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLaunchMock = () => {
    const fp: Record<string, React.CSSProperties> = {
      left: { left: 16, top: "45%" },
      right: { right: 16, top: "45%" },
      "bottom-left": { left: 24, bottom: 24 },
      "bottom-right": { right: 24, bottom: 24 },
    };
    return (
      <div style={{ position: "relative", minHeight: 300 }}>
        <NavBar items={["HOME", "SHOP", "CATEGORIES"]} />
        {cfg.launchFrom === "floating" && (
          <span className="wl-float" style={{ ...fp[cfg.floatingPosition], background: cfg.primaryColor, color: cfg.secondaryColor }}>
            <WIcon type={cfg.icon} size={22} fill="currentColor" />
            {cfg.showCount && <b className="wl-badge">2</b>}
          </span>
        )}
      </div>
    );
  };

  const renderCartMock = () => (
    <div style={{ position: "relative", minHeight: 440 }}>
      <div className="wl-cartdrawer">
        <div className="wl-cart-title">Cart</div>
        {[0, 1].map((i) => (
          <div key={i} className="wl-cart-line">
            <div className="wl-ph" style={{ width: 90, height: 90 }} />
            <div style={{ flex: 1 }}>
              <div className="wl-ph-line" style={{ height: 10 }} />
              <div className="wl-ph-line" style={{ width: "60%", height: 10 }} />
              <div className="wl-remove">Remove</div>
              {cfg.saveLaterMode === "inline" && <div className="wl-remove">Save for later</div>}
            </div>
          </div>
        ))}
        <div className="wl-ph" style={{ height: 28, marginTop: "auto", background: "#bbb" }} />
      </div>
      {cfg.saveLaterMode === "popup" && (
        <div className="wl-popup">
          <div className="wl-popup-img">☕</div>
          <div className="wl-popup-body">
            <div style={{ fontSize: 12 }}>Sample Product Title | Permission 1 Qty</div>
            <div style={{ fontSize: 15, fontWeight: 600, margin: "2px 0 12px" }}>{cfg.saveLaterTitle}</div>
            <InlineStack gap="200">
              <span className="wl-popup-sec">{cfg.saveLaterSecondary}</span>
              <span className="wl-popup-pri" style={{ background: cfg.primaryColor, color: cfg.secondaryColor }}>
                {cfg.saveLaterPrimary}
              </span>
            </InlineStack>
          </div>
        </div>
      )}
    </div>
  );

  const renderPreviewBody = () => {
    switch (tab) {
      case "Basics":
      case "Product Page":
        return renderProductMock();
      case "Collections":
        return renderCollectionsMock();
      case "Wishlist Page":
        return renderWishlistMock();
      case "Launch Point":
        return renderLaunchMock();
      case "Cart":
        return renderCartMock();
    }
  };

  /** Generic read-only/editable code editor used by Product Page (advanced) and Collections. */
  const renderCodeEditor = <K extends "htmlBefore" | "htmlAfter" | "css" | "collHtml" | "collCss">(
    tabs: { id: K; label: string }[],
    active: K,
    setActive: (k: K) => void,
    onPreview?: () => void,
  ) => {
    const value = cfg[active] as string;
    return (
      <div className="wl-editor">
        <div className="wl-editor-head">
          <div className="wl-editor-tabs">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={active === t.id ? "active" : ""} onClick={() => setActive(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <InlineStack gap="100" blockAlign="center">
            {onPreview && <Button variant="tertiary" onClick={onPreview}>Preview</Button>}
            <Button icon={EditIcon} variant="tertiary" accessibilityLabel={editing ? "Stop editing" : "Edit code"} pressed={editing} onClick={() => setEditing((e) => !e)} />
          </InlineStack>
        </div>
        {!editing && (
          <div className="wl-editor-note">
            <b>Read-only mode:</b> Click the Edit button to make changes
          </div>
        )}
        <div className="wl-editor-body">
          <div className="wl-editor-gutter" aria-hidden="true">
            {value.split("\n").map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea className="wl-editor-text" spellCheck={false} wrap="off" readOnly={!editing} value={value} onChange={(e) => set(active, e.target.value as WishlistConfig[K])} />
        </div>
      </div>
    );
  };

  const renderRight = () => {
    if (tab === "Product Page" && ppView === "advanced") {
      if (advancedCodeOpen) {
        return renderCodeEditor(
          [
            { id: "htmlBefore", label: "HTML (Before Click)" },
            { id: "htmlAfter", label: "HTML (After Click)" },
            { id: "css", label: "CSS" },
          ],
          codeTab,
          setCodeTab,
          () => {
            setAdvancedCodeOpen(false);
            setEditing(false);
          },
        );
      }

      return (
        <div className="wl-preview-card">
          <div className="wl-preview-top wl-preview-top-actions">
            <span>Mock Preview</span>
            <Button variant="tertiary" onClick={() => {
              setAdvancedCodeOpen(true);
              setEditing(true);
            }}>
              Edit code
            </Button>
          </div>
          <div className="wl-preview-stage">{renderPreviewBody()}</div>
        </div>
      );
    }
    if (tab === "Collections") {
      return (
        <BlockStack gap="300">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <PillTabs
              items={[
                { id: "mock", label: "Mock Preview" },
                { id: "code", label: "Code Editor" },
              ]}
              value={collPreview}
              onChange={(v) => setCollPreview(v as "mock" | "code")}
            />
          </div>
          {collPreview === "code" ? (
            renderCodeEditor(
              [
                { id: "collHtml", label: "HTML" },
                { id: "collCss", label: "CSS" },
              ],
              collCodeTab,
              setCollCodeTab,
            )
          ) : (
            <div className="wl-preview-card">
              <div className="wl-preview-top">
                <span>Mock Preview</span>
              </div>
              <div className="wl-preview-stage">{renderPreviewBody()}</div>
            </div>
          )}
        </BlockStack>
      );
    }
    return (
      <div className="wl-preview-card">
        <div className="wl-preview-top">
          <span>Mock Preview</span>
        </div>
        <div className="wl-preview-stage">{renderPreviewBody()}</div>
      </div>
    );
  };

  /* --------------------------------- Render -------------------------------- */

  if (smartSaveOpen) return <Page fullWidth>
    <TitleBar title="Wishlist Configuration" />
    <SmartSaveSettings config={cfg} onMultiWishlistEnabled={() => {
      setSaved((current) => ({ ...current, wishlistMode: "multi" }));
      setCfg((current) => ({ ...current, wishlistMode: "multi" }));
      shopify.toast.show("Multi-Wishlist enabled");
    }} onChange={set} onBack={() => setSmartSaveOpen(false)} onSave={saveSettings} saving={fetcher.state !== "idle"} />
  </Page>;


  return (
    <Page fullWidth>
      <TitleBar title={showingSaveFeatures ? "Wishlist Configuration" : showingBackInStock ? "Back in Stock Configuration" : "Configurations"} />
      <style>{CSS}</style>

      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center">
          {showingSaveFeatures || showingBackInStock ? <RemixLink to={overviewUrl}>Configurations</RemixLink> : <Text as="span" fontWeight="semibold">Configurations</Text>}
          {(showingSaveFeatures || showingBackInStock) && <>
          <Text as="span" tone="subdued">
            /
          </Text>
          <Text as="span" fontWeight="semibold">
            {showingSaveFeatures ? "Wishlist Configuration" : "Back in Stock Configuration"}
          </Text>
          </>}
        </InlineStack>

        {!showingSaveFeatures && !showingBackInStock && <>
        <Text as="p" variant="bodySm" tone="subdued">
          Manage and configure Wishlist Stock Notify capabilities
        </Text>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingSm">Pricing Plan</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Current plan: {loaderData.currentPlanName}
            </Text>
            <Text as="p" variant="bodySm">
              Emails sent {loaderData.sentLabel}: {loaderData.emailsSent}
            </Text>
            <div className="wl-plan-choices">
              {loaderData.plans.map((plan) => {
                const selected = plan.code === loaderData.currentPlanCode;
                const detail = plan.monthlyPriceCents === 0
                  ? "$0/month"
                  : `$${plan.monthlyPriceCents / 100}/month`;
                const allowance = plan.allowanceWindow === "day"
                  ? `${plan.allowance} emails/day`
                  : `${plan.allowance} emails/month`;
                const body = (
                  <>
                    <strong>{plan.name}</strong>
                    <span>{detail}</span>
                    <span>{allowance}</span>
                    <span>{selected ? "Selected" : "Choose"}</span>
                  </>
                );
                return selected ? (
                  <div key={plan.code} className="wl-plan-choice selected" aria-current="true">
                    {body}
                  </div>
                ) : (
                  <a key={plan.code} className="wl-plan-choice" href={loaderData.pricingPlansUrl} target="_top">
                    {body}
                  </a>
                );
              })}
            </div>
            <a className="wl-subscription-link" href={loaderData.pricingPlansUrl} target="_top" rel="noopener noreferrer">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="M3 10h18M7 15h4" />
              </svg>
              <span>
                <strong>Manage Subscription</strong>
                <span>View pricing plans, compare options, and explore monthly or annual subscriptions.</span>
              </span>
            </a>
          </BlockStack>
        </Card>

        <ConfigurationFeatures
          saveFeaturesUrl={`/app/settings?${featureParams}`}
          backInStockFeaturesUrl={`/app/settings?${backInStockParams}`}
          wishlistEnabled={saved.wishlistEnabled}
          backInStockEnabled={saved.backInStockEnabled}
          saving={featureFetcher.state !== "idle"}
          onToggle={toggleFeature}
        />
        </>}

        {showingSaveFeatures && <div className="wl-save-features"><BlockStack gap="400">
        <TextField label="Search features" labelHidden value={search} onChange={setSearch} placeholder="Search..." autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />

        <InlineStack align="space-between" blockAlign="center">
          <Tabs tabs={filterOptions.map((t) => ({ id: t.id, content: t.content, accessibilityLabel: `${t.content} features` }))} selected={selectedTab} onSelect={setSelectedTab} />
          <Text as="span" variant="bodySm" tone="subdued">
            Showing {filtered.length} of {features.length}
          </Text>
        </InlineStack>

        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Wishlist Configuration
          </Text>
          <div className="wl-feature-grid">
            {filtered.length ? (
              filtered.map((f) => (
                <Card key={f.id}>
                  <BlockStack gap="300">
                    <div className="wl-feature-visual">
                      <FeatureArt variant={f.variant} />
                    </div>
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        {f.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {f.description}
                      </Text>
                    </BlockStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <span className={`wl-status ${f.enabled ? "on" : "off"}`}>
                        <span className="wl-status-dot" />
                        {f.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <Button size="slim" icon={EditIcon} onClick={() => openSettings(f)}>
                        Settings
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              ))
            ) : (
              <Card>
                <Text as="p" tone="subdued">
                  No matching features found.
                </Text>
              </Card>
            )}
          </div>
        </BlockStack>
        </BlockStack></div>}

        {showingBackInStock && (
          <BackInStockConfiguration
            initialSettings={loaderData.backInStockSettings}
            backInStockEnabled={saved.backInStockEnabled}
            emailDeliveryEnabled={loaderData.shop.emailAlertsEnabled}
            emailDeliveryUrl="/app/integrations?section=email&returnTo=%2Fapp%2Fsettings%3Fsection%3Dback-in-stock"
            emailsSent={loaderData.emailsSent}
            sentLabel={loaderData.sentLabel}
            smsIntegrationsUrl="/app/integrations?section=sms&returnTo=%2Fapp%2Fsettings%3Fsection%3Dback-in-stock"
            smsEnabled={loaderData.shop.smsEnabled}
            whatsappEnabled={loaderData.shop.whatsappEnabled}
            whatsappIntegrationsUrl="/app/integrations?section=whatsapp&returnTo=%2Fapp%2Fsettings%3Fsection%3Dback-in-stock"
          />
        )}
      </BlockStack>

      {isOpen && (
        <div className="wl-backdrop" onClick={closeSettings}>
          <div className="wl-modal" role="dialog" aria-modal="true" aria-label="Customize Wishlist Stock Notify" onClick={(e) => e.stopPropagation()}>
            <div className="wl-modal-head">
              <InlineStack gap="200" blockAlign="center">
                <span className="wl-brand">♥</span>
                <Text as="span" variant="headingSm">
                  Customize Wishlist Stock Notify
                </Text>
              </InlineStack>
              <button type="button" className="wl-close" aria-label="Close" onClick={closeSettings}>
                ×
              </button>
            </div>

            <div className="wl-modal-tabs" role="tablist">
              {MODAL_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? "active" : ""}
                  onClick={() => {
                    setTab(t);
                    setEditing(false);
                    setAdvancedCodeOpen(false);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="wl-modal-body">
              <div className="wl-form">{renderForm()}</div>
              <div className="wl-preview">{renderRight()}</div>
            </div>

            <div className="wl-modal-foot">
              <Button variant="tertiary" onClick={closeSettings}>
                Cancel
              </Button>
              <Button variant="primary" loading={fetcher.state !== "idle"} onClick={saveSettings}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/*  Styles (scoped with wl- prefix)                                           */
/* -------------------------------------------------------------------------- */

const CSS = `
.wl-subscription-link{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid var(--wl-border,#e2e8f0);border-radius:10px;color:var(--wl-text,#0f172a);text-decoration:none;background:var(--wl-surface,#fff)}
.wl-plan-choices{display:flex;gap:12px;flex-wrap:wrap}
.wl-plan-choice{display:flex;flex:1;min-width:140px;flex-direction:column;gap:4px;padding:14px;border:1px solid var(--wl-border,#e2e8f0);border-radius:10px;color:var(--wl-text,#0f172a);background:var(--wl-surface,#fff);text-decoration:none}
.wl-plan-choice.selected{border:2px solid var(--wl-primary,#334155);background:var(--wl-primary-soft,#e2e8f0)}
.wl-plan-choice:hover{background:var(--wl-background,#f1f5f9)}
.wl-subscription-link:hover{background:var(--wl-background,#f1f5f9)}
.wl-subscription-link:focus-visible{outline:2px solid var(--wl-accent);outline-offset:3px}
.wl-subscription-link>svg{flex-shrink:0}
.wl-subscription-link>span:nth-child(2){display:flex;flex:1;flex-direction:column;gap:5px}
.wl-subscription-link strong{font-weight:600}
.wl-subscription-link>.wl-configuration-coming-soon{font-size:11px;color:var(--wl-text-secondary,#64748b)}
.wl-feature-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.wl-feature-visual{height:150px;border:1px solid var(--p-color-border,var(--wl-border));border-radius:8px;overflow:hidden;background:var(--wl-surface,#fff)}
.wl-status{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500}
.wl-status.on{color:var(--wl-success,#15803d)}.wl-status.off{color:var(--wl-text-secondary,#64748b)}
.wl-status-dot{width:8px;height:8px;border-radius:50%;background:currentColor}

.wl-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:520;display:flex;padding:12px}
.wl-modal{background:linear-gradient(135deg,var(--wl-primary-soft,#e2e8f0),var(--wl-accent-soft,#e0f2fe));border-radius:12px;display:flex;flex-direction:column;width:100%;overflow:hidden}
.wl-modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--wl-background,#f1f5f9);border-bottom:1px solid var(--wl-border,#e2e8f0)}
.wl-brand{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;background:var(--wl-primary-variant,#1e293b);color:var(--wl-surface);font-size:12px}
.wl-close{border:0;background:none;font-size:22px;cursor:pointer;line-height:1;color:var(--wl-text,#0f172a)}
.wl-modal-tabs{display:flex;gap:4px;padding:28px 36px 14px;overflow:auto}
.wl-modal-tabs button{border:0;background:none;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;color:var(--wl-text,#0f172a);white-space:nowrap}
.wl-modal-tabs button.active{background:var(--wl-surface,#fff);box-shadow:0 1px 2px rgba(15,23,42,.12);font-weight:600}
.wl-modal-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(360px,5fr) 6fr;gap:30px;margin:0 36px;padding:20px 20px 0;background:var(--wl-surface,#fff);border-radius:12px 12px 0 0;overflow:hidden}
.wl-form{overflow:auto;padding:0 12px 24px 0}
.wl-preview{overflow:auto;padding-bottom:24px}
.wl-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 36px;background:var(--wl-surface,#fff);border-top:1px solid var(--wl-border,#e2e8f0);margin:0 36px}

.wl-field-row{display:grid;grid-template-columns:150px 1fr;gap:16px;align-items:center;padding:2px 0}
.wl-color-btn,.wl-color-field{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--wl-text-disabled);border-radius:8px;background:var(--wl-surface);cursor:pointer;font-size:13px}
.wl-color-btn{min-width:146px;justify-content:flex-start}
.wl-color-btn .wl-caret{margin-left:auto}
.wl-color-field{width:100%}
.wl-color-picker{width:26px;height:26px;border:0;padding:0;background:transparent;cursor:pointer;flex-shrink:0}
.wl-color-hex{width:90px;min-width:0;border:0;background:transparent;font:inherit;color:inherit;padding:4px}
.wl-color-field .wl-color-hex{flex:1}
.wl-color-hex:focus-visible,.wl-color-picker:focus-visible{outline:2px solid var(--wl-accent);outline-offset:2px}
.wl-swatch{width:16px;height:16px;border-radius:3px;border:1px solid var(--wl-border-strong)}
.wl-color-btn .wl-swatch{border-radius:50%}
.wl-icon-options{display:flex;gap:10px;flex-wrap:wrap}
.wl-icon-option{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:var(--wl-background);font-size:13px;cursor:pointer}
.wl-icon-option.selected{background:var(--wl-accent-soft,#e0f2fe)}
.wl-radio-stack{display:flex;flex-direction:column;gap:12px}
.wl-radio-inline{display:flex;gap:16px;flex-wrap:wrap}
.wl-radio-list{display:flex;flex-direction:column}
.wl-radio-item{padding:12px 0;border-bottom:1px solid #ebebeb}
.wl-radio-item:last-child{border-bottom:0}
.wl-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
fieldset{border:0;padding:0;margin:0;min-width:0}
.wl-disabled{opacity:.5;pointer-events:none}
.wl-pills{display:inline-flex;gap:4px;background:var(--wl-background);border-radius:8px;padding:2px}
.wl-pills button{border:0;background:none;padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--wl-text-secondary)}
.wl-pills button.active{background:var(--wl-surface);color:var(--wl-text);font-weight:600;box-shadow:0 1px 1px rgba(0,0,0,.1)}

.wl-option-card{border:1px solid var(--wl-border-strong);border-radius:10px;padding:12px 14px}
.wl-option-card.selected{border-color:var(--wl-primary,#334155);background:var(--wl-primary-soft,#e2e8f0);box-shadow:0 0 0 1px var(--wl-primary,#334155) inset}
.wl-option-card.muted{opacity:.7}
.wl-option-fields{margin-top:10px}
.wl-cart-message{margin:12px 22px 4px;padding:12px;border:1px solid var(--wl-border-strong);border-radius:8px;background:var(--wl-surface);font-size:13px;line-height:1.45}
.wl-wishlist-picks{border-top:1px solid var(--wl-border);padding-top:14px;display:grid;gap:6px}

.wl-preview-card{border:1px solid var(--wl-border-strong);border-radius:10px;min-height:520px;background:var(--wl-surface)}
.wl-preview-top{padding:12px 20px;border-bottom:1px solid #ebebeb}
.wl-preview-top-actions{display:flex;align-items:center;justify-content:space-between}
.wl-preview-top span{font-size:11px;background:var(--wl-background);border-radius:6px;padding:2px 8px;color:var(--wl-text-secondary)}
.wl-preview-stage{padding:32px 40px;position:relative}
.wl-ph{background:var(--wl-border);border-radius:6px}
.wl-ph-line{height:8px;border-radius:4px;background:var(--wl-border);margin-bottom:8px}
.wl-product{display:grid;grid-template-columns:1.45fr 1fr;gap:16px;align-items:start;padding-top:24px}
.wl-product-img{aspect-ratio:1.09}
.wl-product-info{display:flex;flex-direction:column;gap:8px;padding-top:36px}
.wl-inline-row{display:flex;gap:8px}
.wl-quick{position:absolute;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--wl-surface);box-shadow:0 1px 4px rgba(0,0,0,.25)}
.wl-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.wl-tile{border:1px solid var(--wl-border-strong);border-radius:8px;padding:14px}
.wl-nav{display:flex;gap:18px;font-size:13px;padding-bottom:14px;margin-bottom:18px;border-bottom:1px solid #eee;align-items:center}
.wl-nav-actions{margin-left:auto;display:inline-flex;gap:8px}
.wl-nav-circle{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--wl-border);font-size:12px}
.wl-nav-circle.dark{background:var(--wl-border)}
.wl-badge{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:#f00;color:var(--wl-surface);font-size:10px;display:grid;place-items:center;padding:0 4px}
.wl-float{position:absolute;display:grid;place-items:center;width:52px;height:44px}
.wl-whead{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:6px 8px 16px;border-bottom:1px solid #eee;margin-bottom:18px}
.wl-share{display:inline-flex;gap:8px;align-items:center;font-size:12px}
.wl-wgrid{display:grid;gap:16px 40px;padding:0 40px}
.wl-add{font-size:11px;margin-top:6px}
.wl-overlay-wrap{position:relative;min-height:380px;background:rgba(0,0,0,.05);border-radius:6px;display:flex;justify-content:flex-end}
.wl-drawer{width:60%;background:var(--wl-surface);padding:12px;box-shadow:-4px 0 12px rgba(0,0,0,.1)}
.wl-drawer .wl-wgrid{padding:0;gap:12px}
.wl-cartdrawer{margin-left:auto;width:230px;min-height:430px;background:var(--wl-background);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:16px;display:flex;flex-direction:column;gap:14px}
.wl-cart-title{font-weight:600;color:#3d4a9a}
.wl-cart-line{display:flex;gap:10px}
.wl-remove{font-size:9px;text-decoration:underline;color:#3d4a9a;margin-top:30px}
.wl-popup{position:absolute;left:0;top:150px;width:75%;display:flex;background:var(--wl-surface);border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.2);overflow:hidden}
.wl-popup-img{width:104px;background:var(--wl-background);display:grid;place-items:center;font-size:32px;opacity:.4}
.wl-popup-body{padding:14px 14px 18px;flex:1}
.wl-popup-pri,.wl-popup-sec{padding:9px 14px;font-size:12px;border:1px solid var(--wl-text)}
.wl-popup-sec{background:var(--wl-surface);color:var(--wl-text)}

.wl-editor{border:1px solid var(--wl-border-strong);border-radius:10px;display:flex;flex-direction:column;height:100%;min-height:520px;overflow:hidden;background:var(--wl-surface)}
.wl-editor-head{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-bottom:1px solid #ebebeb}
.wl-editor-tabs{display:flex;gap:4px}
.wl-editor-tabs button{border:0;background:none;padding:8px 10px;font-size:12px;cursor:pointer;color:var(--wl-text);border-radius:6px}
.wl-editor-tabs button.active{background:var(--wl-accent-soft,#e0f2fe);color:var(--wl-primary-variant,#1e293b);font-weight:600}
.wl-editor-note{background:#fff7e0;border-bottom:1px solid #f1d98a;padding:8px 12px;font-size:11px;color:#6b4e00}
.wl-editor-body{display:flex;flex:1;min-height:0;font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace}
.wl-editor-gutter{padding:8px;text-align:right;color:#9a9a9a;background:#fafafa;user-select:none}
.wl-editor-text{flex:1;border:0;outline:0;resize:none;padding:8px;font:inherit;color:#1f4f9a;background:var(--wl-surface);white-space:pre;overflow:auto}
.wl-editor-text[readonly]{cursor:default}
@media (max-width:900px){.wl-modal-body{grid-template-columns:1fr;overflow:auto}.wl-modal-tabs{padding:16px}.wl-modal-body,.wl-modal-foot{margin:0 12px}.wl-field-row{grid-template-columns:1fr}}
`;
