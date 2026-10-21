import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "@remix-run/react";
import "./Backinstockcustomizer.css";
import { type BackInStockSettings } from "../lib/ui-config.shared";


type Props = {
  initial?: Partial<BackInStockSettings>;
  smsEnabled?: boolean;
  smsIntegrationsUrl?: string;
  initialSection?: "launch" | "button" | "form" | "email";
  initialChannel?: "email" | "sms";
  saving?: boolean;
  saved?: boolean;
  saveError?: string;
  onBack: () => void;
  onSave?: (settings: BackInStockSettings) => void;
};

type SectionId = "launch" | "button" | "form" | "email";

const DEFAULTS: BackInStockSettings = {
  launchType: "modal",
  minimumQuantity: 1,
  placement: "next",
  buttonType: "iconText",
  buttonText: "Email me when available",
  textSize: 14,
  radius: 0,
  buttonColor: "#ff4400",
  textColor: "#FFFFFF",
  formHeading: "Email me when available",
  emailPlaceholder: "Enter your email address",
  emailButton: "Email Me",
  smsPlaceholder: "Enter your phone number",
  confirmation: "Awesome! We will send you an alert once the product becomes available for purchase",
  confirmationTextColor: "#000000",
  confirmationBannerColor: "#F1F8F5",
  from: "",
  replyTo: "",
  subject: "{{{Title}}} is back in stock",
  headline: "The {{Title}} is now back in stock!",
  emailButtonText: "Buy Now",
  footer: "",
  logoUrl: "",
  headerText: "",
};

const MAX_LOGO_BYTES = 200 * 1024;

const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "launch", title: "Launch Point Type" },
  { id: "button", title: "Button Customisation" },
  { id: "form", title: "Form Customisation" },
  { id: "email", title: "Email Customisation" },
];

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg className={`swc-chev ${up ? "is-up" : ""}`} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bell() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M10 2a5 5 0 0 0-5 5v3.2L3.6 13a.8.8 0 0 0 .7 1.2h11.4a.8.8 0 0 0 .7-1.2L15 10.2V7a5 5 0 0 0-5-5Zm-2 13.5a2 2 0 0 0 4 0Z" />
    </svg>
  );
}

function Radio({ name, checked, onChange, label, hint, badge, children }: {
  name: string; checked: boolean; onChange: () => void; label?: string; hint?: string; badge?: boolean; children?: ReactNode;
}) {
  return (
    <label className="swc-radio">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="swc-radio-dot" />
      <span className="swc-radio-body">
        {children ?? (
          <>
            <span className="swc-radio-label">
              {label}
              {badge && <em className="swc-pill">Recommended</em>}
            </span>
            <span className="swc-radio-hint">{hint}</span>
          </>
        )}
      </span>
    </label>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="swc-field">
      <label>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** Collapsed dropdown row that reveals an input (Form Customisation) */
function DropRow({ title, heading, value, onChange }: { title: string; heading: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="swc-field">
      <label className="swc-strong">{heading}</label>
      <div className={`swc-drop ${open ? "is-open" : ""}`}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span>{title}</span>
          <Chevron up={open} />
        </button>
        {open && <input className="swc-input" value={value} onChange={(e) => onChange(e.target.value)} />}
      </div>
    </div>
  );
}

export function BackInStockCustomizer({ initial, initialSection, initialChannel, smsEnabled = false, smsIntegrationsUrl = "/app/integrations", saving, saved, saveError, onBack, onSave }: Props) {
  const [s, setS] = useState<BackInStockSettings>({ ...DEFAULTS, ...initial });
  const [open, setOpen] = useState<SectionId | null>(initialSection ?? "launch");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewChannel, setPreviewChannel] = useState<"email" | "sms">(initialChannel ?? (initialSection === "form" ? "sms" : "email"));
  const [smsFormOpen, setSmsFormOpen] = useState(!smsEnabled);
  const [confirmationOpen, setConfirmationOpen] = useState(smsEnabled);
  const [hasChanges, setHasChanges] = useState(false);
  const [logoMode, setLogoMode] = useState<"image" | "text">(
    !initial?.logoUrl && initial?.headerText ? "text" : "image",
  );
  const [logoError, setLogoError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof BackInStockSettings>(k: K, v: BackInStockSettings[K]) => {
    setHasChanges(true);
    setS((p) => ({ ...p, [k]: v }));
  };

  const handleLogoFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setLogoError("Please choose a .png or .jpg image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("Image must be 200 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoError("");
      setHasChanges(true);
      setS((p) => ({
        ...p,
        logoUrl: String(reader.result || ""),
        headerText: "",
      }));
    };
    reader.onerror = () =>
      setLogoError("Could not read that image. Try another file.");
    reader.readAsDataURL(file);
  };

  const next = (id: SectionId) => {
    const i = SECTIONS.findIndex((x) => x.id === id);
    const nextSection = SECTIONS[i + 1]?.id ?? null;
    setOpen(nextSection);
    if (nextSection === "form") {
      setPreviewChannel("sms");
      setSmsFormOpen(!smsEnabled);
      setConfirmationOpen(smsEnabled);
    }
  };

  const previewMode = open === "form" ? "modal" : open === "email" ? "email" : "product";

  const notifyStyle = {
    background: s.buttonColor,
    color: s.textColor,
    borderRadius: s.radius,
    fontSize: s.textSize,
  };

  const NotifyButton = ({ type = s.buttonType, className = "" }: { type?: BackInStockSettings["buttonType"]; className?: string }) => (
    <div className={`swc-notify ${type === "icon" ? "is-icon" : ""} ${className}`} style={notifyStyle}>
      {type !== "text" && <Bell />}
      {type !== "icon" && <span>{s.buttonText}</span>}
    </div>
  );

  const handleHeaderText = (value: string) => {
    setHasChanges(true);
    setS((p) => ({ ...p, headerText: value, logoUrl: "" }));
  };

  const sideClass = s.placement === "right" ? "is-right" : s.placement === "left" ? "is-left" : "";

  return (
    <div className="swc">
      <header className="swc-top">
        <button type="button" className="swc-back" onClick={onBack}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M8 4H4v12h4M8 10h8M11 7l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <h1>Back in stock Alerts</h1>
        {saved && !hasChanges && !saving && !saveError && <span className="swc-save-status" role="status">Saved</span>}
        {saveError && <span className="swc-save-error" role="alert">{saveError}</span>}
        <button type="button" className="swc-save" disabled={saving} onClick={() => {
          setHasChanges(false);
          onSave?.(s);
        }}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </header>

      <div className="swc-body">
        {/* ---------- Left: settings ---------- */}
        <aside className="swc-panel">
          {SECTIONS.map(({ id, title }) => {
            const isOpen = open === id;
            return (
              <section key={id} className="swc-section">
                <button type="button" className={`swc-section-head ${isOpen ? "is-open" : ""}`} aria-expanded={isOpen} onClick={() => {
                  const nextSection = isOpen ? null : id;
                  setOpen(nextSection);
                  if (nextSection === "form") {
                    setPreviewChannel("sms");
                    setSmsFormOpen(!smsEnabled);
                    setConfirmationOpen(smsEnabled);
                  }
                }}>
                  <span>{title}</span>
                  <Chevron up={isOpen} />
                </button>

                {isOpen && id === "launch" && (
                  <div className="swc-section-body">
                    <p className="swc-intro">back in stock Alerts</p>
                    <Radio name="launch" checked={s.launchType === "inline"} onChange={() => set("launchType", "inline")} label="In-Line form" hint="Display the form directly on your product pages under the Sold Out button" />
                    <Radio name="launch" checked={s.launchType === "modal"} onChange={() => set("launchType", "modal")} label="Modal/Pop-up" badge hint="Display a button on your sold out pages, which opens up the form on clicking" />
                    <Field label="Minimum stock to notify" hint="0 means notify as soon as any stock is sellable online.">
                      <input className="swc-input" type="number" min={0} max={999999} step={1} value={s.minimumQuantity} onChange={(e) => set("minimumQuantity", Number(e.target.value))} />
                    </Field>
                    {s.launchType === "modal" && (
                      <div className="swc-sub">
                        <Radio name="place" checked={s.placement === "next"} onChange={() => set("placement", "next")} label="Next to Sold out button" badge hint="The button will be placed near the Sold Out button" />
                        <Radio name="place" checked={s.placement === "right"} onChange={() => set("placement", "right")} label="Right side button" hint="The button will be displayed on the right hand side of the product page" />
                        <Radio name="place" checked={s.placement === "left"} onChange={() => set("placement", "left")} label="Left Side button" hint="The button will be displayed on the left hand side of the product page" />
                      </div>
                    )}
                    <div className="swc-next"><button type="button" onClick={() => next(id)}>Next</button></div>
                  </div>
                )}

                {isOpen && id === "button" && (
                  <div className="swc-section-body">
                    <p className="swc-intro">Customize your button further</p>
                    <div className="swc-field">
                      <label>Button Type</label>
                      <small className="swc-muted">Supporting Content</small>
                    </div>
                    <div className="swc-types">
                      {(["text", "iconText", "icon"] as const).map((t) => (
                        <Radio key={t} name="btype" checked={s.buttonType === t} onChange={() => set("buttonType", t)}>
                          <span className="swc-type-preview"><NotifyButton type={t} /></span>
                        </Radio>
                      ))}
                    </div>
                    <Field label="Button Text">
                      <div className="swc-input-wrap">
                        <input className="swc-input" maxLength={60} value={s.buttonText} onChange={(e) => set("buttonText", e.target.value)} />
                        <span className="swc-count">{s.buttonText.length}/60</span>
                      </div>
                    </Field>
                    <Field label="Button Text Size">
                      <div className="swc-input-wrap">
                        <input className="swc-input" type="number" min={8} max={40} value={s.textSize} onChange={(e) => set("textSize", Number(e.target.value))} />
                        <span className="swc-unit">px</span>
                      </div>
                    </Field>
                    <Field label="Button Edge Radius">
                      <div className="swc-input-wrap">
                        <input className="swc-input" type="number" min={0} max={50} value={s.radius} onChange={(e) => set("radius", Number(e.target.value))} />
                        <span className="swc-unit">px</span>
                      </div>
                    </Field>
                    <div className="swc-two">
                      <Field label="Button Color">
                        <div className="swc-input-wrap">
                          <input className="swc-input" value={s.buttonColor} onChange={(e) => set("buttonColor", e.target.value)} />
                          <input type="color" className="swc-swatch" aria-label="Pick button color" value={/^#[0-9a-f]{6}$/i.test(s.buttonColor) ? s.buttonColor : "#ff4400"} onChange={(e) => set("buttonColor", e.target.value)} />
                        </div>
                      </Field>
                      <Field label="Button Text Color">
                        <div className="swc-input-wrap">
                          <input className="swc-input" value={s.textColor} onChange={(e) => set("textColor", e.target.value)} />
                          <input type="color" className="swc-swatch" aria-label="Pick text color" value={/^#[0-9a-f]{6}$/i.test(s.textColor) ? s.textColor : "#ffffff"} onChange={(e) => set("textColor", e.target.value)} />
                        </div>
                      </Field>
                    </div>
                    <div className="swc-next"><button type="button" onClick={() => next(id)}>Next</button></div>
                  </div>
                )}

                {isOpen && id === "form" && (
                  <div className="swc-section-body">
                    <DropRow heading="Form Heading" title="Edit Your Form heading" value={s.formHeading} onChange={(v) => set("formHeading", v)} />
                    <DropRow heading="Email Form" title="Edit Your Email Form" value={s.emailPlaceholder} onChange={(v) => set("emailPlaceholder", v)} />
                    <div className="swc-field">
                      <label className="swc-strong">SMS Form</label>
                      <div className={`swc-drop ${smsFormOpen ? "is-open" : ""}`}>
                        <button type="button" onClick={() => setSmsFormOpen(!smsFormOpen)} aria-expanded={smsFormOpen}>
                          <span>Edit Your SMS Form</span>
                          <Chevron up={smsFormOpen} />
                        </button>
                        {smsFormOpen && (smsEnabled ? (
                          <div className="swc-sms-editor">
                            <input className="swc-input" value={s.smsPlaceholder} onChange={(e) => set("smsPlaceholder", e.target.value)} aria-label="SMS phone placeholder" />
                          </div>
                        ) : (
                          <div className="swc-sms-warning" role="status">
                            <span className="swc-sms-warning-icon" aria-hidden="true">!</span>
                            <div>
                              <strong>Enable SMS Integrations to enable the SMS UI on your store</strong>
                              <Link to={smsIntegrationsUrl}>Go to Integrations</Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="swc-field">
                      <label className="swc-strong">Confirmation Message</label>
                      <div className={`swc-drop swc-confirmation-drop ${confirmationOpen ? "is-open" : ""}`}>
                        <button type="button" onClick={() => setConfirmationOpen(!confirmationOpen)} aria-expanded={confirmationOpen}>
                          <span>Edit Your Confirmation Message</span>
                          <Chevron up={confirmationOpen} />
                        </button>
                        {confirmationOpen && (
                          <div className="swc-confirmation-editor">
                            <label htmlFor="swc-confirmation">Success Message</label>
                            <textarea id="swc-confirmation" className="swc-input" value={s.confirmation} onChange={(e) => set("confirmation", e.target.value)} />
                            <div className="swc-two">
                              <Field label="Banner Text Color">
                                <div className="swc-color-control">
                                  <input className="swc-input" value={s.confirmationTextColor} onChange={(e) => set("confirmationTextColor", e.target.value)} />
                                  <span className="swc-color-picker"><input type="color" className="swc-swatch" aria-label="Pick banner text color" value={/^#[0-9a-f]{6}$/i.test(s.confirmationTextColor) ? s.confirmationTextColor : "#000000"} onChange={(e) => set("confirmationTextColor", e.target.value)} /></span>
                                </div>
                              </Field>
                              <Field label="Banner Color">
                                <div className="swc-color-control">
                                  <input className="swc-input" value={s.confirmationBannerColor} onChange={(e) => set("confirmationBannerColor", e.target.value)} />
                                  <span className="swc-color-picker"><input type="color" className="swc-swatch" aria-label="Pick banner color" value={/^#[0-9a-f]{6}$/i.test(s.confirmationBannerColor) ? s.confirmationBannerColor : "#f1f8f5"} onChange={(e) => set("confirmationBannerColor", e.target.value)} /></span>
                                </div>
                              </Field>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="swc-next"><button type="button" onClick={() => next(id)}>Next</button></div>
                  </div>
                )}

                {isOpen && id === "email" && (
                  <div className="swc-section-body">
                    <h2 className="swc-group">Email Details</h2>
                    <Field label="From *" hint="Choose something your customers will recognize (ex: store/brand name)">
                      <input className="swc-input" value={s.from} onChange={(e) => set("from", e.target.value)} />
                    </Field>
                    <Field label="Reply to Email id *" hint="Customer responses will be sent to this email address">
                      <input className="swc-input" type="email" value={s.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
                    </Field>
                    <h2 className="swc-group">Email Template</h2>
                    <Field label="Subject">
                      <div className="swc-input-wrap">
                        <input className="swc-input" maxLength={500} value={s.subject} onChange={(e) => set("subject", e.target.value)} />
                        <span className="swc-count">{s.subject.length}/500</span>
                      </div>
                      <button type="button" className="swc-chip" onClick={() => set("subject", `${s.subject} {{Title}}`)}>Insert Product Title</button>
                    </Field>
                    <Field label="Add Logo or Header Text">
                      {logoMode === "image" ? (
                        <div className="swc-drop-zone">
                          {s.logoUrl ? (
                            <div className="swc-logo-preview">
                              <img
                                src={s.logoUrl}
                                alt="Email logo preview"
                              />
                              <button
                                type="button"
                                className="swc-logo-remove"
                                onClick={() => {
                                  setLogoError("");
                                  set("logoUrl", "");
                                }}
                              >
                                Remove logo
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="swc-chip swc-chip-blue"
                              onClick={() => logoInputRef.current?.click()}
                            >
                              Add images
                            </button>
                          )}
                          <small>Accepts .jpg, and .png · up to 200 KB</small>
                        </div>
                      ) : (
                        <input
                          className="swc-input"
                          maxLength={80}
                          placeholder="e.g. Your store name"
                          value={s.headerText}
                          onChange={(e) => handleHeaderText(e.target.value)}
                        />
                      )}
                      {logoError && (
                        <small className="swc-logo-error" role="alert">
                          {logoError}
                        </small>
                      )}
                      <small>
                        {logoMode === "image" ? (
                          <>
                            Do not have logo?{" "}
                            <button
                              type="button"
                              onClick={() => setLogoMode("text")}
                            >
                              Add Header Text Instead
                            </button>
                          </>
                        ) : (
                          <>
                            Want to use a logo?{" "}
                            <button
                              type="button"
                              onClick={() => setLogoMode("image")}
                            >
                              Add Logo Instead
                            </button>
                          </>
                        )}
                      </small>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        hidden
                        onChange={handleLogoFile}
                      />
                    </Field>
                    <Field label="Headline">
                      <div className="swc-input-wrap">
                        <input className="swc-input" maxLength={500} value={s.headline} onChange={(e) => set("headline", e.target.value)} />
                        <span className="swc-count">{s.headline.length}/500</span>
                      </div>
                    </Field>
                    <Field label="Button Text" hint="Want to change the button colors in the Email ?">
                      <input className="swc-input" value={s.emailButtonText} onChange={(e) => set("emailButtonText", e.target.value)} />
                    </Field>
                    <Field label="Email Footer" hint="(e.g.:Business name & address)">
                      <input className="swc-input" value={s.footer} onChange={(e) => set("footer", e.target.value)} />
                    </Field>
                    <div className="swc-next"><button type="button" onClick={() => setOpen(null)}>Done</button></div>
                  </div>
                )}
              </section>
            );
          })}
        </aside>

        {/* ---------- Right: preview ---------- */}
        <main className="swc-preview">
          <div className="swc-tabs" role="tablist">
            {(["desktop", "mobile"] as const).map((d) => (
              <button key={d} type="button" role="tab" aria-selected={device === d} className={device === d ? "is-active" : ""} onClick={() => setDevice(d)}>
                {d === "desktop" ? "Desktop" : "Mobile"}
              </button>
            ))}
          </div>

          <div className="swc-stage">
            {previewMode === "email" ? (
              <div className={`swc-email ${device}`}>
                <div className="swc-email-card">
                  <div className="swc-email-shop">
                    {s.logoUrl ? (
                      <img
                        className="swc-email-logo"
                        src={s.logoUrl}
                        alt={s.headerText || "Store logo"}
                      />
                    ) : s.headerText ? (
                      <span className="swc-email-header-text">
                        {s.headerText}
                      </span>
                    ) : (
                      "{{shop}}"
                    )}
                  </div>
                  <h3>{s.headline}</h3>
                  <div className="swc-email-product">
                    <div className="swc-email-img" />
                    <div>
                      <strong>Product Name</strong>
                      <span>Variant Value</span>
                      <b>$ 0.00</b>
                      <div className="swc-email-btn">{s.emailButtonText}</div>
                    </div>
                  </div>
                </div>
                <div className="swc-email-foot">
                  <p>{s.footer || ""}</p>
                  <u>Unsubscribe</u>
                </div>
              </div>
            ) : (
              <div className={`swc-product ${device} ${sideClass} ${previewMode === "modal" ? "has-modal" : ""}`}>
                <div className="swc-skel swc-skel-img" />
                <div className="swc-product-info">
                  <div className="swc-skel swc-skel-title" />
                  <div className="swc-skel swc-skel-sub" />
                  <div className="swc-spacer" />
                  <div className="swc-soldout">Sold Out</div>
                  {s.launchType === "inline" ? (
                    <div className="swc-inline">
                      <input readOnly placeholder={s.emailPlaceholder} />
                      <div className="swc-inline-btn">{s.emailButton}</div>
                    </div>
                  ) : s.placement === "next" ? (
                    <NotifyButton />
                  ) : (
                    <NotifyButton className="swc-side" />
                  )}
                </div>

                {previewMode === "modal" && (
                  <div className="swc-overlay">
                    <div className="swc-modal">
                      <span className="swc-x">x</span>
                      <h3>{s.formHeading}</h3>
                      <div className="swc-modal-tabs" role="tablist" aria-label="Notification type">
                        <button type="button" role="tab" aria-selected={previewChannel === "email"} className={previewChannel === "email" ? "is-active" : ""} onClick={() => setPreviewChannel("email")}>Email</button>
                        <button type="button" role="tab" aria-selected={previewChannel === "sms"} className={previewChannel === "sms" ? "is-active" : ""} onClick={() => setPreviewChannel("sms")}>SMS</button>
                      </div>
                      {previewChannel === "email" ? (
                        <>
                          <p><i>Get notified via email when this product is back in stock</i></p>
                          <div className="swc-modal-form">
                            <input readOnly placeholder={s.emailPlaceholder} />
                            <div>{s.emailButton}</div>
                          </div>
                          <p className="swc-modal-note"><i>We will send you an email once the product becomes available. Your email address will not be shared with anyone else.</i></p>
                        </>
                      ) : (
                        <>
                          <p><i>Get notified via SMS when this product is back in stock</i></p>
                          {confirmationOpen && (
                            <div className="swc-sms-success" style={{ backgroundColor: s.confirmationBannerColor, color: s.confirmationTextColor }}>
                              <span aria-hidden="true">✓</span>
                              <div>{s.confirmation}</div>
                            </div>
                          )}
                          {!confirmationOpen && <div className="swc-sms-modal-form"><span>+00</span><input readOnly placeholder={s.smsPlaceholder} /><div>Text Me</div></div>}
                          <p className="swc-modal-note"><i>I agree to receive recurring automated marketing text messages (e.g. cart reminders) at the phone number provided. Consent is not a condition to purchase. Message &amp; data rates apply. Message frequency varies. Reply HELP for help and STOP to cancel.</i></p>
                          <p className="swc-sms-terms"><i>View our terms of service and privacy policy.</i></p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}