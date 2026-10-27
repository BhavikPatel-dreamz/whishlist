import type { CSSProperties } from "react";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy | Wishlist Stock Notify" },
  {
    name: "description",
    content:
      "Privacy policy for Wishlist Stock Notify, a Shopify app by Dynamic Dreamz for wishlists and back-in-stock alerts.",
  },
];

const page: CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  maxWidth: "42rem",
  margin: "0 auto",
  padding: "3rem 1.5rem 4rem",
  color: "#1a1a1a",
  lineHeight: 1.65,
};

const muted: CSSProperties = { color: "#4a4f54" };
const h1: CSSProperties = {
  fontSize: "1.75rem",
  margin: "0 0 0.5rem",
  lineHeight: 1.3,
};
const h2: CSSProperties = {
  fontSize: "1.15rem",
  margin: "2rem 0 0.75rem",
  lineHeight: 1.35,
};
const list: CSSProperties = { paddingLeft: "1.25rem", margin: "0.5rem 0" };

/** Public privacy policy for App Store listing and merchant/customer disclosure. */
export default function PrivacyPolicy() {
  return (
    <main style={page}>
      <p style={{ ...muted, margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
        Wishlist Stock Notify
      </p>
      <h1 style={h1}>Privacy Policy</h1>
      <p style={muted}>Last updated: October 27, 2026</p>

      <p>
        This Privacy Policy describes how <strong>Dynamic Dreamz</strong>{" "}
        (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, and
        shares information when merchants install and use{" "}
        <strong>Wishlist Stock Notify</strong> (the &quot;App&quot;) on their
        Shopify store, and when shoppers use wishlist and back-in-stock features
        powered by the App.
      </p>

      <h2 style={h2}>1. Who this policy covers</h2>
      <ul style={list}>
        <li>
          <strong>Merchants</strong> — store owners and staff who install and
          configure the App in Shopify Admin.
        </li>
        <li>
          <strong>Shoppers</strong> — customers and visitors who save products to
          a wishlist or sign up for back-in-stock alerts on a merchant&apos;s
          storefront.
        </li>
      </ul>
      <p>
        Merchants are independently responsible for their own privacy notices to
        shoppers. This policy explains how we process data on behalf of
        merchants when they use the App.
      </p>

      <h2 style={h2}>2. Information we collect</h2>
      <p>
        <strong>From Shopify / merchants.</strong> When a merchant installs the
        App, Shopify provides information needed to run the App, which may
        include shop domain, access tokens scoped to the App&apos;s permissions,
        store name and locale, product and inventory data required for alerts,
        and subscription or billing status for App plans.
      </p>
      <p>
        <strong>From shoppers (via the merchant&apos;s store).</strong> Depending
        on features the merchant enables, we may process:
      </p>
      <ul style={list}>
        <li>
          Wishlist data such as product and variant IDs, list names, and guest
          tokens or customer IDs when the shopper is logged in
        </li>
        <li>
          Back-in-stock signup details such as email address and/or phone number,
          product and variant references, and notification preferences
        </li>
        <li>
          Limited event or analytics data related to saves, alerts, and clicks
          (for example, that a restock link was opened)
        </li>
      </ul>
      <p>
        <strong>From merchants in the App.</strong> Configuration they save,
        such as email sender details, notification templates, and—on eligible
        plans—API credentials for their own email, SMS, or WhatsApp providers.
        Secrets are stored encrypted at rest where the App supports encryption.
      </p>

      <h2 style={h2}>3. How we use information</h2>
      <ul style={list}>
        <li>Provide wishlist and back-in-stock functionality on the storefront</li>
        <li>
          Send restock notifications by email, SMS, or WhatsApp when configured
          and allowed by the merchant&apos;s plan
        </li>
        <li>Operate App billing, plan limits, and usage tracking</li>
        <li>Show merchants analytics and alert history inside the App</li>
        <li>Maintain security, prevent abuse, and troubleshoot issues</li>
        <li>Comply with legal obligations and Shopify platform requirements</li>
      </ul>
      <p>
        We do not sell personal information. We do not use shopper contact
        details to market our own products independently of the merchant&apos;s
        store.
      </p>

      <h2 style={h2}>4. How we share information</h2>
      <p>We may share information with:</p>
      <ul style={list}>
        <li>
          <strong>Shopify</strong> — as required to authenticate the App and
          operate within the Shopify platform
        </li>
        <li>
          <strong>Service providers</strong> — hosting, databases, and email/SMS
          delivery providers used to run the App. When a merchant connects their
          own provider (for example Resend, Brevo, SendGrid, Mailgun, Twilio),
          notification content and recipient addresses are sent to that provider
          under the merchant&apos;s account
        </li>
        <li>
          <strong>Authorities</strong> — when required by law or to protect
          rights, safety, or security
        </li>
      </ul>

      <h2 style={h2}>5. Data retention</h2>
      <p>
        We retain App data for as long as the merchant keeps the App installed
        and as needed to provide the service. After uninstall, we delete or
        anonymize shop-linked data within a reasonable period, except where we
        must retain limited records for legal, billing, or security reasons.
        Merchants can remove individual stock-alert subscriptions (for example
        via unsubscribe links) according to App features.
      </p>

      <h2 style={h2}>6. Security</h2>
      <p>
        We use industry-standard measures appropriate to the sensitivity of the
        data, including encrypted storage for secrets where supported and access
        controls on our systems. No method of transmission or storage is
        completely secure; merchants should also protect their Shopify accounts
        and any third-party API keys they configure.
      </p>

      <h2 style={h2}>7. International transfers</h2>
      <p>
        The App may process data on servers located outside your country,
        including where our hosting or delivery providers operate. By using the
        App, merchants instruct us to process data as described in this policy.
      </p>

      <h2 style={h2}>8. Shopper rights and merchant responsibilities</h2>
      <p>
        Shoppers should contact the merchant first for requests about wishlist
        or alert data on that store. Merchants are responsible for providing
        their own privacy policy to shoppers, obtaining any required consents
        for marketing or messaging (including SMS/WhatsApp where applicable),
        and honoring unsubscribe and deletion requests required by law.
      </p>
      <p>
        Depending on location, individuals may have rights to access, correct,
        delete, or restrict processing of personal data. Merchants or shoppers
        may contact us using the details below and we will work with the
        merchant to respond as appropriate.
      </p>

      <h2 style={h2}>9. Children</h2>
      <p>
        The App is intended for merchants operating commercial stores. It is not
        directed at children under 16, and we do not knowingly collect personal
        information from children.
      </p>

      <h2 style={h2}>10. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. The &quot;Last
        updated&quot; date at the top will change when we do. Continued use of
        the App after an update constitutes acceptance of the revised policy
        where permitted by law.
      </p>

      <h2 style={h2}>11. Contact</h2>
      <p>
        For privacy questions about Wishlist Stock Notify:
      </p>
      <ul style={list}>
        <li>
          Email:{" "}
          <a href="mailto:support@dynamicdreamz.com">
            support@dynamicdreamz.com
          </a>
        </li>
        <li>App: Wishlist Stock Notify on Shopify</li>
        <li>Developer: Dynamic Dreamz</li>
      </ul>
    </main>
  );
}
