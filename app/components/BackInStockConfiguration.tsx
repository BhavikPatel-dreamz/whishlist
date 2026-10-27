// import { Link, useFetcher } from "@remix-run/react";
// import { useState } from "react";
// import { BackInStockCustomizer } from "./Backinstockcustomizer";
// import type { BackInStockSettings } from "../lib/ui-config.shared";
// import "./BackInStockConfiguration.css";



// type Props = {
//   initialSettings?: Partial<BackInStockSettings> | null;
//   backInStockEnabled?: boolean;
//   smsEnabled?: boolean;
//   smsIntegrationsUrl?: string;
//   smsLearnMoreUrl?: string;
// };

// /* ---------- Illustrations ---------- */

// function FormIllustration() {
//   return (
//     <svg viewBox="0 0 130 130" aria-hidden="true">
//       <circle cx="68" cy="65" r="60" fill="#2f7d5a" />
//       <rect x="2" y="28" width="104" height="68" rx="5" fill="#3a3f44" />
//       <rect x="6" y="32" width="96" height="60" rx="2" fill="#f6f6f6" />
//       <circle cx="13" cy="39" r="3" fill="#2f7d5a" />
//       <rect x="19" y="37" width="26" height="4" rx="1" fill="#2f7d5a" />
//       <rect x="12" y="47" width="86" height="3" rx="1" fill="#ececec" />
//       <rect x="12" y="55" width="70" height="8" rx="1" fill="#e2e2e2" />
//       <circle cx="88" cy="58" r="7.5" fill="#2f7d5a" />
//       <path d="m84.5 58 2.5 2.5 4.5-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
//       <rect x="12" y="74" width="84" height="9" rx="1" fill="#1f2326" />
//       <text x="54" y="80.5" textAnchor="middle" fontSize="4" fill="#fff" fontFamily="Roboto, Arial, sans-serif">Confirm Email ID</text>
//     </svg>
//   );
// }

// function SmsIntegrationIllustration() {
//   return (
//     <svg viewBox="0 0 130 130" aria-hidden="true">
//       <circle cx="65" cy="65" r="60" fill="#deb065" />
//       <rect x="32" y="8" width="66" height="116" rx="7" fill="#3b4045" />
//       <rect x="36" y="13" width="58" height="108" rx="3" fill="#f7f7f5" />
//       <circle cx="46" cy="27" r="5.5" fill="#d79a3c" />
//       <rect x="55" y="25" width="22" height="4" rx="1" fill="#d79a3c" />
//       <rect x="42" y="40" width="30" height="3" rx="1" fill="#e4e4e4" />
//       <rect x="42" y="48" width="46" height="2.5" rx="1" fill="#e4e4e4" />
//       <rect x="42" y="54" width="46" height="2.5" rx="1" fill="#e4e4e4" />
//       <rect x="42" y="64" width="46" height="6" rx="1" fill="#d9d9d9" />
//       <rect x="42" y="78" width="5" height="5" rx="1" fill="#e4e4e4" />
//       <rect x="50" y="79" width="30" height="3" rx="1" fill="#e4e4e4" />
//       <rect x="40" y="94" width="50" height="9" rx="1" fill="#1f2326" />
//       <text x="65" y="100.5" textAnchor="middle" fontSize="4.5" fill="#fff" fontFamily="Roboto, Arial, sans-serif">Notify Me</text>
//     </svg>
//   );
// }

// function SmsFormIllustration() {
//   return (
//     <svg viewBox="0 0 130 130" aria-hidden="true">
//       <circle cx="68" cy="65" r="60" fill="#dd8a73" />
//       <rect x="4" y="30" width="116" height="72" rx="5" fill="#3a3f44" />
//       <rect x="8" y="34" width="108" height="64" rx="2" fill="#f4f4f4" />
//       <rect x="8" y="34" width="26" height="64" fill="#ececec" />
//       <rect x="12" y="40" width="14" height="2.5" rx="1" fill="#c9c9c9" />
//       <rect x="12" y="46" width="14" height="2.5" rx="1" fill="#c9c9c9" />
//       <rect x="12" y="52" width="14" height="2.5" rx="1" fill="#c9c9c9" />
//       <circle cx="40" cy="42" r="2" fill="#c8624d" />
//       <rect x="45" y="41" width="22" height="2.5" rx="1" fill="#c8624d" />
//       <circle cx="40" cy="49" r="2" fill="#e08f55" />
//       <rect x="45" y="48" width="22" height="2.5" rx="1" fill="#e08f55" />
//       <rect x="100" y="41" width="6" height="2.5" rx="1" fill="#6fb2c4" />
//       <rect x="109" y="41" width="5" height="2.5" rx="1" fill="#6fb2c4" />
//       {[56, 62, 68, 74, 80, 86].map((y) => (
//         <g key={y}>
//           <circle cx="40" cy={y} r="2" fill="#dcdcdc" />
//           <rect x="45" y={y - 1} width="26" height="2.5" rx="1" fill="#dcdcdc" />
//           <rect x="100" y={y - 1} width="6" height="2.5" rx="1" fill="#e2e2e2" />
//           <rect x="109" y={y - 1} width="5" height="2.5" rx="1" fill="#e2e2e2" />
//         </g>
//       ))}
//     </svg>
//   );
// }

// function EmailTemplateIllustration() {
//   return (
//     <svg viewBox="0 0 130 130" aria-hidden="true">
//       <circle cx="65" cy="65" r="60" fill="#8bbcc6" />
//       <rect x="32" y="6" width="66" height="118" rx="7" fill="#3b4045" />
//       <rect x="36" y="11" width="58" height="110" rx="3" fill="#f7f7f7" />
//       <circle cx="46" cy="25" r="5.5" fill="#4f93a3" />
//       <rect x="55" y="23" width="22" height="4" rx="1" fill="#8bbcc6" />
//       <rect x="41" y="38" width="48" height="36" rx="1" fill="#e2e2e2" />
//       <rect x="41" y="80" width="28" height="3" rx="1" fill="#e4e4e4" />
//       <rect x="41" y="87" width="46" height="2.5" rx="1" fill="#e4e4e4" />
//       <rect x="41" y="93" width="40" height="2.5" rx="1" fill="#e4e4e4" />
//       <rect x="40" y="103" width="50" height="9" rx="1" fill="#1f2326" />
//       <text x="65" y="109.5" textAnchor="middle" fontSize="4.5" fill="#fff" fontFamily="Roboto, Arial, sans-serif">Notify Me</text>
//     </svg>
//   );
// }

// /* ---------- Component ---------- */

// export function BackInStockConfiguration({
//   initialSettings,
//   backInStockEnabled = true,
//   smsEnabled = false,
//   smsIntegrationsUrl = "/app/integrations",
//   smsLearnMoreUrl = "https://help.shopify.com/",
// }: Props) {
//   const [customizing, setCustomizing] = useState(false);
//   const settingsFetcher = useFetcher<{ saved?: boolean; kind?: string; error?: string }>();
//   const [customizerInitialSection, setCustomizerInitialSection] = useState<"launch" | "form" | "email">("launch");
//   const effectiveSmsEnabled = backInStockEnabled && smsEnabled;

//   return (
//     <div className="ws-bis-config">
//       <div className="ws-bis-content" hidden={customizing}>
//         <h2 className="ws-bis-title">Back-in-Stock Features</h2>
//         <div className="ws-bis-feature-grid">
//           <article className="ws-bis-feature-card">
//             <div className="ws-bis-feature-art"><FormIllustration /></div>
//             <div className="ws-bis-feature-copy">
//               <h3>Notify button &amp; form</h3>
//               <p>Customize the back-in-stock button and signup form to match your store.</p>
//             </div>
//             <div className="ws-bis-feature-footer">
//               <span className={`ws-bis-status ${backInStockEnabled ? "is-on" : ""}`}>
//                 <span />{backInStockEnabled ? "Enabled" : "Disabled"}
//               </span>
//               <button className="ws-bis-btn ws-bis-btn-outline" type="button" onClick={() => {
//                 setCustomizerInitialSection("launch");
//                 setCustomizing(true);
//               }}>
//                 Settings
//               </button>
//             </div>
//           </article>

//           <article className="ws-bis-feature-card">
//             <div className="ws-bis-feature-art"><SmsIntegrationIllustration /></div>
//             <div className="ws-bis-feature-copy">
//               <h3>SMS alerts</h3>
//               <p>Connect an SMS provider to send back-in-stock text notifications.</p>
//             </div>
//             <div className="ws-bis-feature-footer">
//               <span className={`ws-bis-status ${effectiveSmsEnabled ? "is-on" : ""}`}>
//                 <span />{effectiveSmsEnabled ? "Enabled" : "Disabled"}
//               </span>
//               <Link className="ws-bis-btn ws-bis-btn-outline" to={smsIntegrationsUrl}>
//                 Settings
//               </Link>
//             </div>
//           </article>

//           <article className="ws-bis-feature-card">
//             <div className="ws-bis-feature-art"><SmsFormIllustration /></div>
//             <div className="ws-bis-feature-copy">
//               <h3>SMS signup form</h3>
//               <p>Preview and customize the form shoppers use to sign up for SMS alerts.</p>
//             </div>
//             <div className="ws-bis-feature-footer">
//               <span className={`ws-bis-status ${effectiveSmsEnabled ? "is-on" : ""}`}>
//                 <span />{effectiveSmsEnabled ? "Enabled" : "Disabled"}
//               </span>
//               <button className="ws-bis-btn ws-bis-btn-outline" type="button" onClick={() => {
//                 setCustomizerInitialSection("form");
//                 setCustomizing(true);
//               }}>
//                 Settings
//               </button>
//             </div>
//           </article>

//           <article className="ws-bis-feature-card">
//             <div className="ws-bis-feature-art"><EmailTemplateIllustration /></div>
//             <div className="ws-bis-feature-copy">
//               <h3>Email alert template</h3>
//               <p>Customize the design, color, and text of your back-in-stock email.</p>
//             </div>
//             <div className="ws-bis-feature-footer">
//               <span className={`ws-bis-status ${backInStockEnabled ? "is-on" : ""}`}>
//                 <span />{backInStockEnabled ? "Enabled" : "Disabled"}
//               </span>
//               <button className="ws-bis-btn ws-bis-btn-outline" type="button" onClick={() => {
//                 setCustomizerInitialSection("email");
//                 setCustomizing(true);
//               }}>
//                 Settings
//               </button>
//             </div>
//           </article>
//         </div>
//       </div>

//       {customizing && (
//       <BackInStockCustomizer
//         initial={initialSettings ?? undefined}
//         smsEnabled={smsEnabled}
//         smsIntegrationsUrl={smsIntegrationsUrl}
//         initialSection={customizerInitialSection}
//         saving={settingsFetcher.state !== "idle"}
//         saved={settingsFetcher.data?.saved}
//         saveError={settingsFetcher.data?.error}
//         onBack={() => setCustomizing(false)}
//         onSave={(settings) => {
//           const formData = new FormData();
//           formData.set("intent", "saveBackInStockSettings");
//           formData.set("settings", JSON.stringify(settings));
//           settingsFetcher.submit(formData, { method: "post" });
//         }}
//       />
//       )}
//     </div>
//   );
// }


import { Link, useFetcher } from "@remix-run/react";
import { useState, type ReactNode } from "react";
import { BackInStockCustomizer } from "./Backinstockcustomizer";
import type { BackInStockSettings } from "../lib/ui-config.shared";
import "./BackInStockConfiguration.css";

type Props = {
  initialSettings?: Partial<BackInStockSettings> | null;
  backInStockEnabled?: boolean;
  emailDeliveryEnabled?: boolean;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
  emailDeliveryUrl?: string;
  smsIntegrationsUrl?: string;
  whatsappIntegrationsUrl?: string;
  smsLearnMoreUrl?: string;
  canConfigureEmailProvider?: boolean;
  emailsSent?: number;
  sentLabel?: string;
};

type Section = "launch" | "form" | "email";
type Filter = "all" | "enabled" | "disabled";

type FeatureItem = {
  key: string;
  title: string;
  description: string;
  enabled: boolean;
  art: ReactNode;
  section?: Section; // opens the customizer
  channel?: "email" | "sms";
  to?: string;
  locked?: boolean;
};

/* ---------- Icons ---------- */

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 3.5a1.8 1.8 0 0 1 2.5 2.5L6.5 15.5 3 16.5l1-3.5 9.5-9.5Z" />
    </svg>
  );
}

/* ---------- Illustrations ---------- */

function FormIllustration() {
  return (
    <svg viewBox="0 0 130 130" aria-hidden="true">
      <circle cx="68" cy="65" r="60" fill="#2f7d5a" />
      <rect x="2" y="28" width="104" height="68" rx="5" fill="#3a3f44" />
      <rect x="6" y="32" width="96" height="60" rx="2" fill="#f6f6f6" />
      <circle cx="13" cy="39" r="3" fill="#2f7d5a" />
      <rect x="19" y="37" width="26" height="4" rx="1" fill="#2f7d5a" />
      <rect x="12" y="47" width="86" height="3" rx="1" fill="#ececec" />
      <rect x="12" y="55" width="70" height="8" rx="1" fill="#e2e2e2" />
      <circle cx="88" cy="58" r="7.5" fill="#2f7d5a" />
      <path d="m84.5 58 2.5 2.5 4.5-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="12" y="74" width="84" height="9" rx="1" fill="#1f2326" />
      <text x="54" y="80.5" textAnchor="middle" fontSize="4" fill="#fff" fontFamily="Roboto, Arial, sans-serif">Confirm Email ID</text>
    </svg>
  );
}

function SignupFormIllustration() {
  return (
    <svg viewBox="0 0 130 130" aria-hidden="true">
      <circle cx="68" cy="65" r="60" fill="#dd8a73" />
      <rect x="4" y="30" width="116" height="72" rx="5" fill="#3a3f44" />
      <rect x="8" y="34" width="108" height="64" rx="2" fill="#f4f4f4" />
      <rect x="8" y="34" width="26" height="64" fill="#ececec" />
      <rect x="12" y="40" width="14" height="2.5" rx="1" fill="#c9c9c9" />
      <rect x="12" y="46" width="14" height="2.5" rx="1" fill="#c9c9c9" />
      <rect x="12" y="52" width="14" height="2.5" rx="1" fill="#c9c9c9" />
      <circle cx="40" cy="42" r="2" fill="#c8624d" />
      <rect x="45" y="41" width="22" height="2.5" rx="1" fill="#c8624d" />
      <circle cx="40" cy="49" r="2" fill="#e08f55" />
      <rect x="45" y="48" width="22" height="2.5" rx="1" fill="#e08f55" />
      <rect x="100" y="41" width="6" height="2.5" rx="1" fill="#6fb2c4" />
      <rect x="109" y="41" width="5" height="2.5" rx="1" fill="#6fb2c4" />
      {[56, 62, 68, 74, 80, 86].map((y) => (
        <g key={y}>
          <circle cx="40" cy={y} r="2" fill="#dcdcdc" />
          <rect x="45" y={y - 1} width="26" height="2.5" rx="1" fill="#dcdcdc" />
          <rect x="100" y={y - 1} width="6" height="2.5" rx="1" fill="#e2e2e2" />
          <rect x="109" y={y - 1} width="5" height="2.5" rx="1" fill="#e2e2e2" />
        </g>
      ))}
    </svg>
  );
}

function EmailTemplateIllustration() {
  return (
    <svg viewBox="0 0 130 130" aria-hidden="true">
      <circle cx="65" cy="65" r="60" fill="#8bbcc6" />
      <rect x="32" y="6" width="66" height="118" rx="7" fill="#3b4045" />
      <rect x="36" y="11" width="58" height="110" rx="3" fill="#f7f7f7" />
      <circle cx="46" cy="25" r="5.5" fill="#4f93a3" />
      <rect x="55" y="23" width="22" height="4" rx="1" fill="#8bbcc6" />
      <rect x="41" y="38" width="48" height="36" rx="1" fill="#e2e2e2" />
      <rect x="41" y="80" width="28" height="3" rx="1" fill="#e4e4e4" />
      <rect x="41" y="87" width="46" height="2.5" rx="1" fill="#e4e4e4" />
      <rect x="41" y="93" width="40" height="2.5" rx="1" fill="#e4e4e4" />
      <rect x="40" y="103" width="50" height="9" rx="1" fill="#1f2326" />
      <text x="65" y="109.5" textAnchor="middle" fontSize="4.5" fill="#fff" fontFamily="Roboto, Arial, sans-serif">Notify Me</text>
    </svg>
  );
}

/* ---------- Component ---------- */

export function BackInStockConfiguration({
  initialSettings,
  backInStockEnabled = true,
  emailDeliveryEnabled = false,
  smsEnabled = false,
  whatsappEnabled = false,
  emailDeliveryUrl = "/app/integrations?section=email",
  smsIntegrationsUrl = "/app/integrations?section=sms",
  whatsappIntegrationsUrl = "/app/integrations?section=whatsapp",
  smsLearnMoreUrl = "https://help.shopify.com/",
  canConfigureEmailProvider = false,
  emailsSent = 0,
  sentLabel = "this month",
}: Props) {
  const [customizing, setCustomizing] = useState(false);
  const settingsFetcher = useFetcher<{ saved?: boolean; kind?: string; error?: string }>();
  const [customizerInitialSection, setCustomizerInitialSection] = useState<Section>("launch");
  const [customizerInitialChannel, setCustomizerInitialChannel] = useState<"email" | "sms">("email");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const items: FeatureItem[] = [
    {
      key: "notify",
      title: "Notify button & form",
      description: "Customize the back-in-stock button and signup form to match your store.",
      enabled: backInStockEnabled,
      art: <FormIllustration />,
      section: "launch",
    },
    {
      key: "email-delivery",
      title: "Email alerts",
      description: canConfigureEmailProvider
        ? "Turn email alerts on or off, and choose your own email provider on Scale for unlimited sends."
        : `Emails sent ${sentLabel}: ${emailsSent}. Turn email alerts on or off. Starter and Growth use the managed sender.`,
      enabled: backInStockEnabled && emailDeliveryEnabled,
      art: <EmailTemplateIllustration />,
      to: emailDeliveryUrl,
    },
    {
      key: "sms-delivery",
      title: "SMS alerts",
      description: "Turn text alerts on or off. Available on the Scale plan.",
      enabled: backInStockEnabled && smsEnabled,
      art: <EmailTemplateIllustration />,
      to: smsIntegrationsUrl,
    },
    {
      key: "whatsapp-delivery",
      title: "WhatsApp alerts",
      description: "Turn WhatsApp alerts on or off. Available on the Scale plan.",
      enabled: backInStockEnabled && whatsappEnabled,
      art: <EmailTemplateIllustration />,
      to: whatsappIntegrationsUrl,
    },
    {
      key: "email-signup",
      title: "Email signup form",
      description: "Customize the form shoppers use to sign up for back-in-stock email alerts.",
      enabled: backInStockEnabled,
      art: <SignupFormIllustration />,
      section: "form",
      channel: "email",
    },
    {
      key: "email",
      title: "Email alert template",
      description: "Customize the design, color, and text of your back-in-stock email.",
      enabled: backInStockEnabled,
      art: <EmailTemplateIllustration />,
      section: "email",
    },
  ];

  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => {
    if (filter === "enabled" && !i.enabled) return false;
    if (filter === "disabled" && i.enabled) return false;
    return !q || `${i.title} ${i.description}`.toLowerCase().includes(q);
  });

  const openSection = (s: Section, channel?: "email" | "sms") => {
    setCustomizerInitialSection(s);
    setCustomizerInitialChannel(channel ?? (s === "form" ? "sms" : "email"));
    setCustomizing(true);
  };

  return (
    <div className="ws-bis-config">
      <div className="ws-bis-content" hidden={customizing}>
        <input
          className="ws-bis-search"
          type="search"
          placeholder="Search..."
          aria-label="Search back-in-stock features"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="ws-bis-toolbar">
          <div className="ws-bis-tabs" role="tablist">
            {(["all", "enabled", "disabled"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={filter === t}
                className={`ws-bis-tab ${filter === t ? "is-active" : ""}`}
                onClick={() => setFilter(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <span className="ws-bis-count">
            Showing {visible.length} of {items.length}
          </span>
        </div>

        <h2 className="ws-bis-title">Back-in-Stock Features</h2>

        <div className="ws-bis-feature-grid">
          {visible.map((item) => (
            <article className="ws-bis-feature-card" key={item.key}>
              <div className="ws-bis-feature-art">{item.art}</div>
              <div className="ws-bis-feature-copy">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <div className="ws-bis-feature-footer">
                <span className={`ws-bis-status ${item.enabled ? "is-on" : ""}`}>
                  <span />
                  {item.enabled ? "Enabled" : "Disabled"}
                </span>
                {item.locked ? null : item.to ? (
                  <Link className="ws-bis-btn ws-bis-btn-outline" to={item.to}>
                    <PencilIcon /> Settings
                  </Link>
                ) : (
                  <button
                    className="ws-bis-btn ws-bis-btn-outline"
                    type="button"
                    onClick={() => openSection(item.section!, item.channel)}
                  >
                    <PencilIcon /> Settings
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {customizing && (
        <BackInStockCustomizer
          initial={initialSettings ?? undefined}
          smsEnabled={smsEnabled}
          smsIntegrationsUrl={smsIntegrationsUrl}
          initialSection={customizerInitialSection}
          initialChannel={customizerInitialChannel}
          saving={settingsFetcher.state !== "idle"}
          saved={settingsFetcher.data?.saved}
          saveError={settingsFetcher.data?.error}
          onBack={() => setCustomizing(false)}
          onSave={(settings) => {
            const formData = new FormData();
            formData.set("intent", "saveBackInStockSettings");
            formData.set("settings", JSON.stringify(settings));
            settingsFetcher.submit(formData, { method: "post" });
          }}
        />
      )}
    </div>
  );
}