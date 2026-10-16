import { Link, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { BackInStockCustomizer } from "./Backinstockcustomizer";
import type { BackInStockSettings } from "../lib/ui-config.shared";
import "./BackInStockConfiguration.css";



type Props = {
  initialSettings?: Partial<BackInStockSettings> | null;
  smsEnabled?: boolean;
  smsIntegrationsUrl?: string;
  smsLearnMoreUrl?: string;
};

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

function SmsIntegrationIllustration() {
  return (
    <svg viewBox="0 0 130 130" aria-hidden="true">
      <circle cx="65" cy="65" r="60" fill="#deb065" />
      <rect x="32" y="8" width="66" height="116" rx="7" fill="#3b4045" />
      <rect x="36" y="13" width="58" height="108" rx="3" fill="#f7f7f5" />
      <circle cx="46" cy="27" r="5.5" fill="#d79a3c" />
      <rect x="55" y="25" width="22" height="4" rx="1" fill="#d79a3c" />
      <rect x="42" y="40" width="30" height="3" rx="1" fill="#e4e4e4" />
      <rect x="42" y="48" width="46" height="2.5" rx="1" fill="#e4e4e4" />
      <rect x="42" y="54" width="46" height="2.5" rx="1" fill="#e4e4e4" />
      <rect x="42" y="64" width="46" height="6" rx="1" fill="#d9d9d9" />
      <rect x="42" y="78" width="5" height="5" rx="1" fill="#e4e4e4" />
      <rect x="50" y="79" width="30" height="3" rx="1" fill="#e4e4e4" />
      <rect x="40" y="94" width="50" height="9" rx="1" fill="#1f2326" />
      <text x="65" y="100.5" textAnchor="middle" fontSize="4.5" fill="#fff" fontFamily="Roboto, Arial, sans-serif">Notify Me</text>
    </svg>
  );
}

function SmsFormIllustration() {
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
  smsEnabled = false,
  smsIntegrationsUrl = "/app/integrations",
  smsLearnMoreUrl = "https://help.shopify.com/",
}: Props) {
  const [customizing, setCustomizing] = useState(false);
  const settingsFetcher = useFetcher<{ saved?: boolean; kind?: string; error?: string }>();
  const [customizerInitialSection, setCustomizerInitialSection] = useState<"launch" | "form" | "email">("launch");

  return (
    <div className="ws-bis-config">
      <div className="ws-bis-content" hidden={customizing}>
        {/* Card 1 – Form / button */}
        <section className="ws-bis-card">
          <div className="ws-bis-row">
            <div className="ws-bis-row-copy">
              <h3>Customize Back in stock form/ button</h3>
              <p>You can change the design, color, and text of the back in stock alert email to match your store's branding.</p>
              <div className="ws-bis-actions">
                <button className="ws-bis-btn ws-bis-btn-outline" type="button" onClick={() => {
                  setCustomizerInitialSection("launch");
                  setCustomizing(true);
                }}>
                  Customize Form
                </button>
              </div>
            </div>
            <div className="ws-bis-art"><FormIllustration /></div>
          </div>
        </section>

        {/* Card 2 – SMS */}
        <section className="ws-bis-card">
          <div className="ws-bis-row ws-bis-row-header">
            <div className="ws-bis-row-copy">
              <span className="ws-bis-badge">Recommended Features</span>
              <h3>Enable SMS Alerts</h3>
              <p>You can now enable sms alerts by enabling SMS integrations.</p>
            </div>
          </div>

          <div className="ws-bis-row ws-bis-row-divided ws-bis-row-tall">
            <div className="ws-bis-row-copy">
              <h3>Setup SMS Integration</h3>
              <p>Goto our integrations page and select an integration - We support Klaviyo,Postscript and Twilio integrations out of the box.</p>
              <div className="ws-bis-actions">
                <Link className="ws-bis-btn ws-bis-btn-primary" to={smsIntegrationsUrl}>
                  Goto SMS Integrations
                </Link>
                <a className="ws-bis-link" href={smsLearnMoreUrl} target="_blank" rel="noreferrer">
                  Learn more
                </a>
              </div>
            </div>
            <div className="ws-bis-art"><SmsIntegrationIllustration /></div>
          </div>

          <div className="ws-bis-row ws-bis-row-divided">
            <div className="ws-bis-row-copy">
              <h3>Customize SMS Form</h3>
              <p>Preview the SMS form and customize the UI as per your brand</p>
              <div className="ws-bis-actions">
                <button className="ws-bis-btn ws-bis-btn-primary" type="button" onClick={() => {
                  setCustomizerInitialSection("form");
                  setCustomizing(true);
                }}>
                  Customize SMS Form
                </button>
              </div>
            </div>
            <div className="ws-bis-art"><SmsFormIllustration /></div>
          </div>
        </section>

        {/* Card 3 – Email template */}
        <section className="ws-bis-card">
          <div className="ws-bis-row">
            <div className="ws-bis-row-copy">
              <h3>Customize Email Alert Template</h3>
              <p>You can customize the Back in stock alert email template design, color, and text to match your store's branding.</p>
              <div className="ws-bis-actions">
                <button className="ws-bis-btn ws-bis-btn-outline" type="button" onClick={() => {
                  setCustomizerInitialSection("email");
                  setCustomizing(true);
                }}>
                  Customize Email Alert Template
                </button>
              </div>
            </div>
            <div className="ws-bis-art"><EmailTemplateIllustration /></div>
          </div>
        </section>
      </div>

      {customizing && (
      <BackInStockCustomizer
        initial={initialSettings ?? undefined}
        smsEnabled={smsEnabled}
        smsIntegrationsUrl={smsIntegrationsUrl}
        initialSection={customizerInitialSection}
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
