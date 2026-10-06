// import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
// import { useActionData, useLoaderData } from "@remix-run/react";
// import {
//   Page,
//   Text,
//   Card,
//   Button,
//   TextField,
//   Tabs,
//   InlineStack,
//   Divider,
// } from "@shopify/polaris";
// import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
// import { useEffect, useState } from "react";
// import { authenticate } from "../shopify.server";
// import { requireShop } from "../lib/shop.server";
// import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.server";
// import db from "../db.server";

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const { session } = await authenticate.admin(request);
//   const shop = await requireShop(session.shop);

//   return {
//     shop: {
//       emailProvider: shop.emailProvider,
//       hasApiKey: Boolean(shop.apiKey),
//       apiKeyMasked: shop.apiKey ? maskSecret(decryptSecret(shop.apiKey)) : "",
//       senderEmail: shop.senderEmail || "",
//       senderName: shop.senderName || "",
//       emailSubject: shop.emailSubject,
//       emailHeading: shop.emailHeading,
//       emailBody: shop.emailBody,
//       buttonLabel: shop.buttonLabel,
//       stockAlertDeliveryMode: shop.stockAlertDeliveryMode,
//       stockAlertDeliveryTime: shop.stockAlertDeliveryTime,
//       smsEnabled: shop.smsEnabled,
//       hasTwilioToken: Boolean(shop.twilioAuthToken),
//       twilioAccountSid: shop.twilioAccountSid || "",
//       twilioFromNumber: shop.twilioFromNumber || "",
//       wishlistRequiresLogin: shop.wishlistRequiresLogin,
//       doubleOptIn: shop.doubleOptIn,
//       alertsPerVariantCap: shop.alertsPerVariantCap,
//     },
//   };
// };

// export const action = async ({ request }: ActionFunctionArgs) => {
//   const { session } = await authenticate.admin(request);
//   const shop = await requireShop(session.shop);
//   const formData = await request.formData();

//   const emailProvider = String(formData.get("emailProvider") || "resend");
//   const apiKeyRaw = String(formData.get("apiKey") || "").trim();
//   const senderEmail = String(formData.get("senderEmail") || "").trim();
//   const senderName = String(formData.get("senderName") || "").trim();
//   const emailSubject = String(formData.get("emailSubject") || "").trim();
//   const emailHeading = String(formData.get("emailHeading") || "").trim();
//   const emailBody = String(formData.get("emailBody") || "").trim();
//   const buttonLabel = String(formData.get("buttonLabel") || "").trim();
//   const stockAlertDeliveryMode = String(formData.get("stockAlertDeliveryMode") || "immediate");
//   const stockAlertDeliveryTime = String(formData.get("stockAlertDeliveryTime") || "09:00").trim();
//   const smsEnabled = formData.get("smsEnabled") === "on";
//   const twilioAccountSid = String(formData.get("twilioAccountSid") || "").trim();
//   const twilioAuthTokenRaw = String(formData.get("twilioAuthToken") || "").trim();
//   const twilioFromNumber = String(formData.get("twilioFromNumber") || "").trim();
//   const wishlistRequiresLogin = formData.get("wishlistRequiresLogin") === "on";
//   const doubleOptIn = formData.get("doubleOptIn") === "on";
//   const alertsPerVariantCap = parseInt(String(formData.get("alertsPerVariantCap") || "0"), 10);

//   const updateData: Record<string, unknown> = {
//     emailProvider,
//     senderEmail: senderEmail || null,
//     senderName: senderName || null,
//     emailSubject: emailSubject || shop.emailSubject,
//     emailHeading: emailHeading || shop.emailHeading,
//     emailBody: emailBody || shop.emailBody,
//     buttonLabel: buttonLabel || shop.buttonLabel,
//     stockAlertDeliveryMode: stockAlertDeliveryMode === "scheduled" ? "scheduled" : "immediate",
//     stockAlertDeliveryTime: /^\d{2}:\d{2}$/.test(stockAlertDeliveryTime)
//       ? stockAlertDeliveryTime
//       : shop.stockAlertDeliveryTime,
//     smsEnabled,
//     twilioAccountSid: twilioAccountSid || null,
//     twilioFromNumber: twilioFromNumber || null,
//     wishlistRequiresLogin,
//     doubleOptIn,
//     alertsPerVariantCap: isNaN(alertsPerVariantCap) ? 0 : alertsPerVariantCap,
//   };

//   if (apiKeyRaw && apiKeyRaw !== shop.apiKey) {
//     updateData.apiKey = encryptSecret(apiKeyRaw);
//   }

//   if (twilioAuthTokenRaw && twilioAuthTokenRaw !== shop.twilioAuthToken) {
//     updateData.twilioAuthToken = encryptSecret(twilioAuthTokenRaw);
//   }

//   await db.shop.update({ where: { id: shop.id }, data: updateData });

//   return { saved: true };
// };

// type FeatureCard = {
//   id: string;
//   title: string;
//   description: string;
//   enabled: boolean;
//   variant: "wishlist" | "quick" | "later" | "smart" | "boost";
// };

// function FeatureArt({ variant }: { variant: FeatureCard["variant"] }) {
//   if (variant === "wishlist") {
//     return (
//       <svg viewBox="0 0 180 130" width="100%" height="100%" aria-hidden="true">
//         <rect x="18" y="28" width="142" height="72" rx="10" fill="#edf3f5" />
//         <rect x="40" y="18" width="94" height="80" rx="8" fill="#dfeaf0" />
//         <path d="M59 64c0-13 11-24 24-24 10 0 18 6 22 15 4-9 12-15 22-15 13 0 24 11 24 24 0 26-46 35-46 35s-46-9-46-35Z" fill="#7ec1d8" opacity="0.7"/>
//         <path d="M90 82c0-10 8-18 18-18 8 0 15 5 18 12 3-7 10-12 18-12 10 0 18 8 18 18 0 19-36 26-36 26s-36-7-36-26Z" fill="#ef6aa5" />
//       </svg>
//     );
//   }

//   if (variant === "quick") {
//     return (
//       <svg viewBox="0 0 180 130" width="100%" height="100%" aria-hidden="true">
//         <rect x="26" y="80" width="120" height="18" rx="5" fill="#edf3f5" />
//         <path d="M64 74c0-14 12-24 28-24 10 0 18 5 23 13 5-8 13-13 23-13 15 0 27 12 27 27v13H64V74Z" fill="#d8edf5" />
//         <path d="M66 66c0-13 10-23 23-23 11 0 20 7 23 16 3-9 12-16 23-16 15 0 26 11 26 26v8H66v-11Z" fill="#8bc9d8" opacity="0.8"/>
//         <path d="M90 54c0 10 8 18 18 18s18-8 18-18" stroke="#2d7d90" strokeWidth="2" fill="none" strokeLinecap="round"/>
//         <path d="M41 75c5-17 20-28 38-28m-34 26 12 8m-23 8 15-2m65 1 24 4" stroke="#8e9aa5" strokeWidth="2" strokeLinecap="round"/>
//       </svg>
//     );
//   }

//   if (variant === "later") {
//     return (
//       <svg viewBox="0 0 180 130" width="100%" height="100%" aria-hidden="true">
//         <rect x="20" y="28" width="94" height="72" rx="10" fill="#edf3f5" />
//         <rect x="66" y="38" width="90" height="72" rx="10" fill="#fff" opacity="0.9"/>
//         <path d="M96 73c0-11 9-20 20-20 8 0 15 4 18 10 3-6 10-10 17-10 11 0 20 9 20 20 0 20-35 27-35 27S96 93 96 73Z" fill="#8ac6d8" opacity="0.9"/>
//         <path d="M41 46v16h18" stroke="#4a525d" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
//         <path d="M64 52h34" stroke="#9aa8b3" strokeWidth="2" strokeLinecap="round"/>
//         <path d="M64 66h36" stroke="#9aa8b3" strokeWidth="2" strokeLinecap="round"/>
//         <path d="M64 80h30" stroke="#9aa8b3" strokeWidth="2" strokeLinecap="round"/>
//       </svg>
//     );
//   }

//   if (variant === "smart") {
//     return (
//       <svg viewBox="0 0 180 130" width="100%" height="100%" aria-hidden="true">
//         <rect x="18" y="28" width="142" height="72" rx="10" fill="#e9f1f5" />
//         <path d="M62 63c0-16 12-28 28-28 10 0 18 5 23 14 5-9 13-14 23-14 16 0 29 13 29 29v18H62V63Z" fill="#8fc7dc" opacity="0.8"/>
//         <path d="M87 77c0-12 9-21 21-21s21 9 21 21" stroke="#2d6f8a" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
//         <circle cx="108" cy="74" r="15" fill="#ef6aa5"/>
//       </svg>
//     );
//   }

//   return (
//     <svg viewBox="0 0 180 130" width="100%" height="100%" aria-hidden="true">
//       <rect x="16" y="24" width="144" height="84" rx="10" fill="#edf5f7" />
//       <path d="M58 64c0-16 12-28 27-28 10 0 18 5 23 14 5-9 13-14 23-14 16 0 29 13 29 29v17H58V64Z" fill="#94cfe1" opacity="0.9"/>
//       <path d="M101 80c0-8 6-14 14-14s14 6 14 14v9H101v-9Z" fill="#ef6aa5"/>
//       <rect x="48" y="88" width="58" height="12" rx="5" fill="#dfeaf0" />
//       <rect x="76" y="45" width="8" height="18" rx="4" fill="#8ab9c9" />
//       <rect x="68" y="53" width="24" height="8" rx="3" fill="#8ab9c9" />
//     </svg>
//   );
// }

// export default function Settings() {
//   useLoaderData<typeof loader>();
//   const actionData = useActionData<typeof action>();
//   const shopify = useAppBridge();
//   const [search, setSearch] = useState("");
//   const [selectedTab, setSelectedTab] = useState(0);
//   const [isSettingsOpen, setIsSettingsOpen] = useState(false);
//   const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
//   const [activeModalTab, setActiveModalTab] = useState("Basics");
//   const [draft, setDraft] = useState({
//     theme: "Dawn (Live Theme)",
//     enableQuickSave: true,
//     enableCollectionSave: true,
//     productSelector: ".card.card--standard a.full-unstyled-link, .card.card--standard a.full-unstyled-link",
//     buttonSelector: "div#ProductGridContainer .card.card--standard, .product-grid .card.card--standard",
//     iconType: "heart",
//     iconColor: "#000000",
//     pageType: "Side Drawer",
//     pagingTitle: "My Wishlist",
//     allowShare: true,
//     launchFrom: "Header",
//     position: "Bottom Left",
//     showWishlistCount: true,
//     saveLaterTitle: "Do you want to save this product for later?",
//     saveLaterPrimary: "Save For Later",
//     saveLaterSecondary: "No, thanks",
//   });

//   useEffect(() => {
//     if (actionData?.saved) {
//       shopify.toast.show("Settings saved");
//     }
//   }, [actionData, shopify]);

//   const modalTabs = [
//     "Basics",
//     "Product Page",
//     "Collections",
//     "Wishlist Page",
//     "Launch Point",
//     "Cart",
//   ] as const;

//   const filterOptions = [
//     { id: "all", content: "All" },
//     { id: "enabled", content: "Enabled" },
//     { id: "disabled", content: "Disabled" },
//   ] as const;

//   const features: FeatureCard[] = [
//     {
//       id: "wishlist-button",
//       title: "Wishlist button",
//       description: "Shoppers can save products from product details page",
//       enabled: true,
//       variant: "wishlist",
//     },
//     {
//       id: "quick-save",
//       title: "Quick save",
//       description: "Shoppers can add items to wishlist from collections",
//       enabled: true,
//       variant: "quick",
//     },
//     {
//       id: "save-later",
//       title: "Save for later",
//       description: "Prompt to save items when shoppers remove them from cart",
//       enabled: true,
//       variant: "later",
//     },
//     {
//       id: "smart-save",
//       title: "Smart save",
//       description: "Auto-wishlist products visited thrice or more by the shopper",
//       enabled: true,
//       variant: "smart",
//     },
//     {
//       id: "boost-engagement",
//       title: "Boost wishlist engagement",
//       description:
//         "Show subtle, non-intrusive tooltips and toasts that guide new shoppers on how and why to use their wishlist",
//       enabled: false,
//       variant: "boost",
//     },
//   ];

//   const selectedFeature =
//     features.find((feature) => feature.id === selectedFeatureId) ?? features[0];

//   const filteredFeatures = features.filter((feature) => {
//     const matchesSearch = feature.title
//       .toLowerCase()
//       .includes(search.trim().toLowerCase());
//     const matchesFilter =
//       filterOptions[selectedTab].id === "all"
//         ? true
//         : filterOptions[selectedTab].id === "enabled"
//           ? feature.enabled
//           : !feature.enabled;

//     return matchesSearch && matchesFilter;
//   });

//   const updateDraft = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
//     setDraft((current) => ({ ...current, [key]: value }));
//   };

//   const closeSettings = () => {
//     setIsSettingsOpen(false);
//     setSelectedFeatureId(null);
//   };

//   const saveSettings = () => {
//     setIsSettingsOpen(false);
//     shopify.toast.show(`${selectedFeature.title} settings saved`);
//   };

//   const renderModalContent = () => {
//     switch (activeModalTab) {
//       case "Basics":
//         return (
//           <>
//             <section className="ws-modal-section">
//               <h3>Theme Selection</h3>
//               <label className="ws-field">
//                 <span>Theme</span>
//                 <select value={draft.theme} onChange={(event) => updateDraft("theme", event.target.value)}>
//                   <option>Dawn (Live Theme)</option>
//                   <option>Custom</option>
//                 </select>
//               </label>
//               <label className="ws-checkbox-row">
//                 <input
//                   type="checkbox"
//                   checked={draft.enableQuickSave}
//                   onChange={(event) => updateDraft("enableQuickSave", event.target.checked)}
//                 />
//                 Enable Quick Save Button
//               </label>
//               <label className="ws-checkbox-row">
//                 <input
//                   type="checkbox"
//                   checked={draft.enableCollectionSave}
//                   onChange={(event) => updateDraft("enableCollectionSave", event.target.checked)}
//                 />
//                 Enable Quick Save Button on Collections Pages
//               </label>
//             </section>

//             <div className="ws-modal-divider" />

//             <section className="ws-modal-section">
//               <h3>Theme Integration</h3>

//               <label className="ws-field">
//                 <span>Product URL Selector</span>
//                 <textarea
//                   value={draft.productSelector}
//                   onChange={(event) => updateDraft("productSelector", event.target.value)}
//                 />
//               </label>

//               <label className="ws-field">
//                 <span>Button Container Selector</span>
//                 <textarea
//                   value={draft.buttonSelector}
//                   onChange={(event) => updateDraft("buttonSelector", event.target.value)}
//                 />
//               </label>

//               <div className="ws-field-set">
//                 <span>Icon Type</span>
//                 <div className="ws-option-row">
//                   {[
//                     { value: "heart", label: "Heart" },
//                     { value: "star", label: "Star" },
//                     { value: "bookmark", label: "Bookmark" },
//                   ].map((option) => (
//                     <button
//                       key={option.value}
//                       type="button"
//                       className={`ws-option-button ${draft.iconType === option.value ? "selected" : ""}`}
//                       onClick={() => updateDraft("iconType", option.value)}
//                     >
//                       {option.label}
//                     </button>
//                   ))}
//                 </div>
//               </div>

//               <label className="ws-field">
//                 <span>Icon Color</span>
//                 <input
//                   type="color"
//                   value={draft.iconColor}
//                   onChange={(event) => updateDraft("iconColor", event.target.value)}
//                 />
//               </label>
//             </section>
//           </>
//         );

//       case "Product Page":
//         return (
//           <section className="ws-modal-section">
//             <h3>Where should the Wishlist launch from?</h3>
//             <div className="ws-radio-stack">
//               {[
//                 "Header",
//                 "Floating Button",
//                 "Navigation Menu",
//               ].map((option) => (
//                 <label key={option} className="ws-radio-row">
//                   <input
//                     type="radio"
//                     name="launchFrom"
//                     checked={draft.launchFrom === option}
//                     onChange={() => updateDraft("launchFrom", option)}
//                   />
//                   {option}
//                 </label>
//               ))}
//             </div>

//             <div className="ws-modal-divider" />

//             <h3>Position</h3>
//             <div className="ws-radio-stack">
//               {[
//                 "Left",
//                 "Right",
//                 "Bottom Left",
//                 "Bottom Right",
//               ].map((option) => (
//                 <label key={option} className="ws-radio-row">
//                   <input
//                     type="radio"
//                     name="position"
//                     checked={draft.position === option}
//                     onChange={() => updateDraft("position", option)}
//                   />
//                   {option}
//                 </label>
//               ))}
//             </div>

//             <div className="ws-modal-divider" />

//             <h3>Other Settings</h3>
//             <label className="ws-checkbox-row">
//               <input
//                 type="checkbox"
//                 checked={draft.showWishlistCount}
//                 onChange={(event) => updateDraft("showWishlistCount", event.target.checked)}
//               />
//               Show Wishlist Count
//             </label>
//           </section>
//         );

//       case "Collections":
//         return (
//           <section className="ws-modal-section">
//             <h3>Appearance</h3>
//             <div className="ws-radio-stack">
//               {[
//                 "Slide Drawer",
//                 "Separate Page",
//                 "Pop-up Modal",
//               ].map((option) => (
//                 <label key={option} className="ws-radio-row">
//                   <input
//                     type="radio"
//                     name="pageType"
//                     checked={draft.pageType === option}
//                     onChange={() => updateDraft("pageType", option)}
//                   />
//                   {option}
//                 </label>
//               ))}
//             </div>

//             <label className="ws-field">
//               <span>Page Title</span>
//               <input
//                 type="text"
//                 value={draft.pagingTitle}
//                 onChange={(event) => updateDraft("pagingTitle", event.target.value)}
//               />
//             </label>

//             <div className="ws-modal-divider" />

//             <h3>Other Settings</h3>
//             <label className="ws-checkbox-row">
//               <input
//                 type="checkbox"
//                 checked={draft.allowShare}
//                 onChange={(event) => updateDraft("allowShare", event.target.checked)}
//               />
//               Allow shoppers to share wishlist
//             </label>
//           </section>
//         );

//       case "Wishlist Page":
//         return (
//           <section className="ws-modal-section">
//             <h3>Save for later pop-up</h3>
//             <label className="ws-field">
//               <span>Pop-up title</span>
//               <input
//                 type="text"
//                 value={draft.saveLaterTitle}
//                 onChange={(event) => updateDraft("saveLaterTitle", event.target.value)}
//               />
//             </label>

//             <label className="ws-field">
//               <span>Primary button text</span>
//               <input
//                 type="text"
//                 value={draft.saveLaterPrimary}
//                 onChange={(event) => updateDraft("saveLaterPrimary", event.target.value)}
//               />
//             </label>

//             <label className="ws-field">
//               <span>Secondary button text</span>
//               <input
//                 type="text"
//                 value={draft.saveLaterSecondary}
//                 onChange={(event) => updateDraft("saveLaterSecondary", event.target.value)}
//               />
//             </label>

//             <label className="ws-checkbox-row">
//               <input type="checkbox" checked />
//               Always show the pop-up
//             </label>
//           </section>
//         );

//       case "Launch Point":
//         return (
//           <section className="ws-modal-section">
//             <h3>Where should the Wishlist launch from?</h3>
//             <div className="ws-radio-stack">
//               {[
//                 "Header",
//                 "Floating Button",
//                 "Navigation Menu",
//               ].map((option) => (
//                 <label key={option} className="ws-radio-row">
//                   <input
//                     type="radio"
//                     name="launchFromModal"
//                     checked={draft.launchFrom === option}
//                     onChange={() => updateDraft("launchFrom", option)}
//                   />
//                   {option}
//                 </label>
//               ))}
//             </div>

//             <div className="ws-modal-divider" />

//             <label className="ws-checkbox-row">
//               <input
//                 type="checkbox"
//                 checked={draft.showWishlistCount}
//                 onChange={(event) => updateDraft("showWishlistCount", event.target.checked)}
//               />
//               Show Wishlist Count
//             </label>
//           </section>
//         );

//       case "Cart":
//         return (
//           <section className="ws-modal-section">
//             <h3>Save for later pop-up</h3>
//             <label className="ws-field">
//               <span>Pop-up title</span>
//               <input
//                 type="text"
//                 value={draft.saveLaterTitle}
//                 onChange={(event) => updateDraft("saveLaterTitle", event.target.value)}
//               />
//             </label>
//             <label className="ws-field">
//               <span>Primary button text</span>
//               <input
//                 type="text"
//                 value={draft.saveLaterPrimary}
//                 onChange={(event) => updateDraft("saveLaterPrimary", event.target.value)}
//               />
//             </label>
//             <label className="ws-field">
//               <span>Secondary button text</span>
//               <input
//                 type="text"
//                 value={draft.saveLaterSecondary}
//                 onChange={(event) => updateDraft("saveLaterSecondary", event.target.value)}
//               />
//             </label>
//           </section>
//         );

//       default:
//         return null;
//     }
//   };

//   const renderPreview = () => {
//     return (
//       <div className="ws-preview-shell">
//         <div className="ws-preview-header">Mock Preview</div>
//         <div className="ws-preview-window">
//           <div className="ws-preview-nav">
//             <span>HOME</span>
//             <span>SHOP</span>
//             <span>CATALOGUES</span>
//             <div className="ws-preview-cart-actions">
//               <button type="button" aria-label="cart" className="ws-preview-icon-button" />
//               <button type="button" aria-label="wish list" className="ws-preview-icon-button ws-preview-heart" />
//             </div>
//           </div>

//           <div className="ws-preview-grid">
//             {Array.from({ length: activeModalTab === "Cart" ? 2 : 4 }).map((_, index) => (
//               <div key={index} className="ws-preview-card">
//                 <div className="ws-preview-card-image" />
//                 <button type="button" className="ws-preview-card-button">
//                   + Add to Cart
//                 </button>
//               </div>
//             ))}
//           </div>

//           {(activeModalTab === "Wishlist Page" || activeModalTab === "Cart") && (
//             <div className="ws-preview-save-popup">
//               <div className="ws-popup-header">{draft.saveLaterTitle}</div>
//               <div className="ws-popup-actions">
//                 <button type="button" className="ws-popup-secondary">{draft.saveLaterSecondary}</button>
//                 <button type="button" className="ws-popup-primary">{draft.saveLaterPrimary}</button>
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     );
//   };

//   return (
//     <Page fullWidth>
//       <TitleBar title="" />
//       <div className="ws-config-page">
//         <div className="ws-config-topbar">
//           <button type="button" className="ws-config-back" aria-label="Go back">
//             ‹
//           </button>
//           <div className="ws-config-breadcrumb">
//             <span>Configurations</span>
//             <span className="ws-config-separator">/</span>
//             <strong>Features</strong>
//           </div>
//         </div>

//         <div className="ws-config-subtitle-wrap">
//           <Text as="p" variant="bodySm" tone="subdued">
//             Manage and configure Wishlist Plus capabilities
//           </Text>
//         </div>

//         <div className="ws-config-search-wrap">
//           <TextField
//             label="Search features"
//             value={search}
//             onChange={setSearch}
//             placeholder="Search..."
//             autoComplete="off"
//             aria-label="Search features"
//           />
//         </div>

//         <div className="ws-config-toolbar">
//           <Tabs
//             tabs={filterOptions.map((tab) => ({
//               id: tab.id,
//               content: tab.content,
//               accessibilityLabel: `${tab.content} features`,
//             }))}
//             selected={selectedTab}
//             onSelect={(selectedIndex) => setSelectedTab(selectedIndex)}
//           />
//           <Text as="span" variant="bodySm" tone="subdued">
//             Showing {filteredFeatures.length} of {features.length}
//           </Text>
//         </div>

//         <Card>
//           <div className="ws-config-panel-content">
//             <Text as="h2" variant="headingMd">
//               Help Shoppers Save Favorites
//             </Text>

//             <div className="ws-config-grid">
//               {filteredFeatures.length ? (
//                 filteredFeatures.map((feature) => (
//                   <div key={feature.id} className="ws-feature-card-shell">
//                     <Card>
//                       <div className="ws-feature-visual">
//                         <FeatureArt variant={feature.variant} />
//                       </div>
//                       <div className="ws-feature-copy">
//                         <Text as="h3" variant="headingSm">
//                           {feature.title}
//                         </Text>
//                         <Text as="p" variant="bodySm" tone="subdued">
//                           {feature.description}
//                         </Text>
//                       </div>
//                       <Divider />
//                       <div className="ws-feature-actions-row">
//                         <InlineStack align="space-between" blockAlign="center">
//                           <div className={`ws-feature-status ${feature.enabled ? "enabled" : "disabled"}`}>
//                             <span className="ws-feature-status-dot" aria-hidden="true" />
//                             {feature.enabled ? "Enabled" : "Disabled"}
//                           </div>
//                           <Button
//                             size="slim"
//                             variant="tertiary"
//                             onClick={() => {
//                               setSelectedFeatureId(feature.id);
//                               setActiveModalTab("Basics");
//                               setIsSettingsOpen(true);
//                             }}
//                           >
//                             Settings
//                           </Button>
//                         </InlineStack>
//                       </div>
//                     </Card>
//                   </div>
//                 ))
//               ) : (
//                 <div className="ws-feature-empty-shell">
//                   <Card>
//                     <div className="ws-empty-state">
//                       <Text as="p" variant="bodyMd" tone="subdued">
//                         No matching features found.
//                       </Text>
//                     </div>
//                   </Card>
//                 </div>
//               )}
//             </div>
//           </div>
//         </Card>
//       </div>

//       {isSettingsOpen && (
//         <div className="ws-settings-backdrop" onClick={closeSettings}>
//           <div
//             className="ws-settings-modal"
//             role="dialog"
//             aria-modal="true"
//             onClick={(event) => event.stopPropagation()}
//           >
//             <div className="ws-settings-header">
//               <div className="ws-settings-brand" aria-label="Customize Wishlist Plus">
//                 <span className="ws-settings-brand-mark">♡</span>
//                 <span>Customize Wishlist Plus</span>
//               </div>
//               <button
//                 type="button"
//                 className="ws-settings-close"
//                 aria-label="Close modal"
//                 onClick={closeSettings}
//               >
//                 ×
//               </button>
//             </div>

//             <div className="ws-settings-tabs">
//               {modalTabs.map((tab) => (
//                 <button
//                   key={tab}
//                   type="button"
//                   className={`ws-settings-tab ${activeModalTab === tab ? "active" : ""}`}
//                   onClick={() => setActiveModalTab(tab)}
//                 >
//                   {tab}
//                 </button>
//               ))}
//             </div>

//             <div className="ws-settings-content">
//               <div className="ws-settings-form-panel">{renderModalContent()}</div>
//               <div className="ws-settings-preview-panel">{renderPreview()}</div>
//             </div>

//             <div className="ws-settings-footer">
//               <Button variant="tertiary" onClick={closeSettings}>
//                 Cancel
//               </Button>
//               <Button variant="primary" onClick={saveSettings}>
//                 Save
//               </Button>
//             </div>
//           </div>
//         </div>
//       )}
//     </Page>
//   );
// }

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useFetcher, useLoaderData } from "@remix-run/react";
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
  Popover,
  Badge,
  Link,
  RangeSlider,
} from "@shopify/polaris";
import { EditIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.server";
import db from "../db.server";

/* Replace with your real help-centre URLs */
const TUTORIAL_URL = "https://example.com/docs/advanced-button";
const SELECTOR_HELP_URL = "https://example.com/docs/find-css-selectors";
const HELP_DOCS_URL = "https://example.com/docs";

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
  smartSave: boolean;
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
  socialCount: boolean;
  circularBg: boolean;
  collHtml: string;
  collCss: string;
  // Wishlist page
  pageType: "drawer" | "page" | "modal";
  pageTitle: string;
  allowShare: boolean;
  // Launch point
  launchFrom: "header" | "floating" | "menu";
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
  smartSave: true,
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
  socialCount: false,
  circularBg: true,
  collHtml: buildCollHtml("heart"),
  collCss: buildCollCss({ collIconColor: "#000000", collThickness: 1.7, collPosition: "top-left", circularBg: true }),
  pageType: "page",
  pageTitle: "My Wishlist",
  allowShare: true,
  launchFrom: "floating",
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
  const { session } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const uiConfig = await db.uIConfig.findUnique({ where: { shopId: shop.id } });

  return {
    shopDomain: session.shop,
    wishlistConfig: (uiConfig?.productCardConfig as Partial<WishlistConfig> | null) ?? null,
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

  if (formData.get("intent") === "saveWishlistConfig") {
    let config: unknown;
    try {
      config = JSON.parse(String(formData.get("config") || "{}"));
    } catch {
      return { saved: false, kind: "wishlistConfig" as const };
    }

    await db.uIConfig.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        extensionActive: "wishlist",
        productCardConfig: config as any,
        themeSettings: {},
      },
      update: {
        extensionActive: "wishlist",
        productCardConfig: config as any,
      },
    });

    return { saved: true, kind: "wishlistConfig" as const };
  }

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
    stockAlertDeliveryTime: /^\d{2}:\d{2}$/.test(stockAlertDeliveryTime) ? stockAlertDeliveryTime : shop.stockAlertDeliveryTime,
    smsEnabled,
    twilioAccountSid: twilioAccountSid || null,
    twilioFromNumber: twilioFromNumber || null,
    wishlistRequiresLogin,
    doubleOptIn,
    alertsPerVariantCap: isNaN(alertsPerVariantCap) ? 0 : alertsPerVariantCap,
  };

  if (apiKeyRaw && apiKeyRaw !== shop.apiKey) updateData.apiKey = encryptSecret(apiKeyRaw);
  if (twilioAuthTokenRaw && twilioAuthTokenRaw !== shop.twilioAuthToken) {
    updateData.twilioAuthToken = encryptSecret(twilioAuthTokenRaw);
  }

  await db.shop.update({ where: { id: shop.id }, data: updateData });
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
  const [open, setOpen] = useState(false);
  const picker = (
    <div style={{ padding: 12, width: 200 }}>
      <BlockStack gap="200">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", height: 80, border: 0, padding: 0, background: "none" }}
          aria-label={`${label} picker`}
        />
        <TextField label="Hex" labelHidden value={value} onChange={onChange} autoComplete="off" />
      </BlockStack>
    </div>
  );
  const activator = (
    <button type="button" className={variant === "field" ? "wl-color-field" : "wl-color-btn"} onClick={() => setOpen((o) => !o)}>
      <span className="wl-swatch" style={{ background: value }} />
      <span>{value}</span>
      {variant === "dropdown" && <span className="wl-caret">⌄</span>}
    </button>
  );
  return (
    <Popover active={open} onClose={() => setOpen(false)} activator={activator}>
      {picker}
    </Popover>
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

  const [search, setSearch] = useState("");
  const [selectedTab, setSelectedTab] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<ModalTab>("Basics");

  const [saved, setSaved] = useState<WishlistConfig>({ ...DEFAULT_CONFIG, ...(loaderData.wishlistConfig ?? {}) });
  const [cfg, setCfg] = useState<WishlistConfig>(saved);

  const [ppView, setPpView] = useState<"basic" | "advanced">("advanced");
  const [infoOpen, setInfoOpen] = useState(true);
  const [textTab, setTextTab] = useState<"before" | "after">("before");
  const [codeTab, setCodeTab] = useState<"htmlBefore" | "htmlAfter" | "css">("htmlBefore");
  const [collPreview, setCollPreview] = useState<"mock" | "code">("mock");
  const [collCodeTab, setCollCodeTab] = useState<"collHtml" | "collCss">("collHtml");
  const [editing, setEditing] = useState(false);

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
        setIsOpen(false);
        shopify.toast.show("Settings saved");
      } else {
        shopify.toast.show("Could not save settings", { isError: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const features: FeatureCard[] = [
    { id: "wishlist-button", title: "Wishlist button", description: "Shoppers can save products from product details page", enabled: true, variant: "wishlist", tab: "Product Page" },
    { id: "quick-save", title: "Quick save", description: "Shoppers can add items to wishlist from collections", enabled: saved.quickSaveEnabled, variant: "quick", tab: "Collections" },
    { id: "save-later", title: "Save for later", description: "Prompt to save items when shoppers remove them from cart", enabled: saved.saveLaterMode !== "disabled", variant: "later", tab: "Cart" },
    { id: "smart-save", title: "Smart save", description: "Auto-wishlist products visited thrice or more by the shopper", enabled: saved.smartSave, variant: "smart", tab: "Product Page" },
    { id: "boost-engagement", title: "Boost wishlist engagement", description: "Show subtle, non-intrusive tooltips and toasts that guide new shoppers on how and why to use their wishlist", enabled: false, variant: "boost", tab: "Basics" },
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
    setPpView(saved.activeMode);
    setTab(f.tab);
    setEditing(false);
    setCollPreview("mock");
    setIsOpen(true);
  };

  const closeSettings = () => setIsOpen(false);

  const saveSettings = () => {
    const payload: WishlistConfig = tab === "Product Page" ? { ...cfg, activeMode: ppView } : cfg;
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
        <Button pressed={ppView === "basic"} onClick={() => setPpView("basic")}>
          Basic Button
        </Button>
        <Button pressed={ppView === "advanced"} onClick={() => setPpView("advanced")}>
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
          <Select label="Theme" options={["Dawn (Live Theme)", "Custom"]} value={cfg.theme} onChange={(v) => set("theme", v)} />
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
      <Section title="Theme Selection">
        <div style={{ maxWidth: 260 }}>
          <Select label="Theme" labelHidden options={["Dawn (Live Theme)", "Custom"]} value={cfg.theme} onChange={(v) => set("theme", v)} />
        </div>
        <Checkbox
          label="Enable Quick Save Button"
          helpText="Enable Quick Save Button on Collections Pages"
          checked={cfg.quickSaveEnabled}
          onChange={(v) => set("quickSaveEnabled", v)}
        />
      </Section>
      <Divider />
      <Section title="Theme Integration">
        <div style={{ maxWidth: 420 }}>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h4" variant="headingSm">
                Product URL Selector
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                CSS selector to find product links on collection pages.{" "}
                <Link url={SELECTOR_HELP_URL} external>
                  How to find CSS selectors?
                </Link>
              </Text>
              <TextField label="Product URL Selector" labelHidden value={cfg.collProductSelector} onChange={(v) => set("collProductSelector", v)} autoComplete="off" />
              <Text as="p" variant="bodyXs" tone="subdued">
                Default: {DEFAULT_CONFIG.collProductSelector}
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="h4" variant="headingSm">
                Button Container Selector
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                CSS selector for where to attach the wishlist button.{" "}
                <Link url={SELECTOR_HELP_URL} external>
                  How to find CSS selectors?
                </Link>
              </Text>
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
        <Checkbox label="Show Social Count" helpText="Display the number of times a product has been wishlisted" checked={cfg.socialCount} onChange={(v) => set("socialCount", v)} />
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
              { value: "modal", label: "Pop-up Modal" },
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
      <Section title="Other Settings">
        <Checkbox label="Allow shoppers to Share Wishlist" checked={cfg.allowShare} onChange={(v) => set("allowShare", v)} />
      </Section>
      <Divider />
      <Section title="Advanced Customizations">
        <Text as="p" variant="bodySm">
          Adjust colors, position, and more for your Wishlist page, notifications, and pop-ups in our App Embed in the Theme Editor.
        </Text>
        <InlineStack gap="200">
          <Button size="slim" url={HELP_DOCS_URL} external>
            Read help docs
          </Button>
          <Button size="slim" url={`https://${loaderData.shopDomain}/admin/themes/current/editor?context=apps`} target="_blank">
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
      <Divider />
      <FieldRow label="Position">
        <div className="wl-grid-2" style={{ maxWidth: 260 }}>
          {(
            [
              ["left", "Left"],
              ["right", "Right"],
              ["bottom-left", "Bottom Left"],
              ["bottom-right", "Bottom Right"],
            ] as const
          ).map(([v, l]) => (
            <RadioButton key={v} id={`fp-${v}`} name="floatingPosition" label={l} disabled={cfg.launchFrom !== "floating"} checked={cfg.floatingPosition === v} onChange={() => set("floatingPosition", v)} />
          ))}
        </div>
      </FieldRow>
      <Divider />
      <Section title="Other Settings">
        <Checkbox label="Show Wishlist Count" checked={cfg.showCount} onChange={(v) => set("showCount", v)} />
      </Section>
    </BlockStack>
  );

  const renderCart = () => {
    const popup = cfg.saveLaterMode === "popup";
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

        <div className="wl-option-card muted">
          <InlineStack align="space-between" blockAlign="center">
            <RadioButton id="sl-inline" name="saveLaterMode" label="Inline cart-line-item link" checked={false} disabled onChange={() => {}} />
            <Badge tone="attention">Coming soon</Badge>
          </InlineStack>
        </div>

        <div className={`wl-option-card ${cfg.saveLaterMode === "disabled" ? "selected" : ""}`}>
          <RadioButton id="sl-off" name="saveLaterMode" label="Disable Save for Later" checked={cfg.saveLaterMode === "disabled"} onChange={() => set("saveLaterMode", "disabled")} />
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
    const type: BtnType = basic ? cfg.basicType : "icon-text";
    const style: BtnStyle = basic ? cfg.basicStyle : "solid";
    const onImage = basic && cfg.basicPlacement === "on-image";

    const btn = (
      <div style={solidBtn(style)}>
        {type !== "text" && <WIcon type={cfg.icon} size={18} />}
        {type !== "icon" && <span>{cfg.labelBefore}</span>}
      </div>
    );
    const cart = <div className="wl-ph" style={{ height: 44, width: "100%" }} />;
    const pos = basic && !onImage ? cfg.basicPosition : "below";

    let actions: React.ReactNode;
    if (onImage) actions = cart;
    else if (pos === "above") actions = <>{btn}{cart}</>;
    else if (pos === "left") actions = <div className="wl-inline-row">{btn}{cart}</div>;
    else if (pos === "right") actions = <div className="wl-inline-row">{cart}{btn}</div>;
    else actions = <>{cart}{btn}</>;

    return (
      <div className="wl-product">
        <div className="wl-ph wl-product-img" style={{ position: "relative" }}>
          {onImage && (
            <span className="wl-quick" style={{ top: 10, right: 10, color: cfg.primaryColor }}>
              <WIcon type={cfg.icon} size={16} />
            </span>
          )}
        </div>
        <div className="wl-product-info">
          <div className="wl-ph" style={{ height: 24 }} />
          <div className="wl-ph" style={{ height: 24, width: "65%" }} />
          <div style={{ height: 16 }} />
          <div className="wl-ph-line" />
          <div className="wl-ph-line" />
          <div className="wl-ph-line" style={{ width: "70%" }} />
          <div style={{ height: 16 }} />
          {actions}
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
          {cfg.socialCount && (
            <Text as="p" variant="bodyXs" tone="subdued">
              ♥ 24
            </Text>
          )}
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
        {cfg.pageType === "modal" && (
          <div className="wl-overlay-wrap center">
            <div className="wl-modalbox">
              {head}
              {grid(3, 3)}
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
          <Button icon={EditIcon} variant="tertiary" accessibilityLabel={editing ? "Stop editing" : "Edit code"} pressed={editing} onClick={() => setEditing((e) => !e)} />
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
      return renderCodeEditor(
        [
          { id: "htmlBefore", label: "HTML (Before Click)" },
          { id: "htmlAfter", label: "HTML (After Click)" },
          { id: "css", label: "CSS" },
        ],
        codeTab,
        setCodeTab,
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

  return (
    <Page fullWidth>
      <TitleBar title="" />
      <style>{CSS}</style>

      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" tone="subdued">
            Configurations
          </Text>
          <Text as="span" tone="subdued">
            /
          </Text>
          <Text as="span" fontWeight="semibold">
            Features
          </Text>
        </InlineStack>

        <Text as="p" variant="bodySm" tone="subdued">
          Manage and configure Wishlist Plus capabilities
        </Text>

        <TextField label="Search features" labelHidden value={search} onChange={setSearch} placeholder="Search..." autoComplete="off" clearButton onClearButtonClick={() => setSearch("")} />

        <InlineStack align="space-between" blockAlign="center">
          <Tabs tabs={filterOptions.map((t) => ({ id: t.id, content: t.content, accessibilityLabel: `${t.content} features` }))} selected={selectedTab} onSelect={setSelectedTab} />
          <Text as="span" variant="bodySm" tone="subdued">
            Showing {filtered.length} of {features.length}
          </Text>
        </InlineStack>

        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Help Shoppers Save Favorites
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
      </BlockStack>

      {isOpen && (
        <div className="wl-backdrop" onClick={closeSettings}>
          <div className="wl-modal" role="dialog" aria-modal="true" aria-label="Customize Wishlist Plus" onClick={(e) => e.stopPropagation()}>
            <div className="wl-modal-head">
              <InlineStack gap="200" blockAlign="center">
                <span className="wl-brand">♥</span>
                <Text as="span" variant="headingSm">
                  Customize Wishlist Plus
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
.wl-feature-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.wl-feature-visual{height:150px;border:1px solid var(--p-color-border);border-radius:8px;overflow:hidden;background:#fff}
.wl-status{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500}
.wl-status.on{color:#0c5132}.wl-status.off{color:#6d7175}
.wl-status-dot{width:8px;height:8px;border-radius:50%;background:currentColor}

.wl-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:520;display:flex;padding:12px}
.wl-modal{background:linear-gradient(135deg,#ebe7f4,#dce8f5);border-radius:12px;display:flex;flex-direction:column;width:100%;overflow:hidden}
.wl-modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#f1f1f1;border-bottom:1px solid #e1e1e1}
.wl-brand{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;background:#0f2a3a;color:#fff;font-size:12px}
.wl-close{border:0;background:none;font-size:22px;cursor:pointer;line-height:1}
.wl-modal-tabs{display:flex;gap:4px;padding:28px 36px 14px;overflow:auto}
.wl-modal-tabs button{border:0;background:none;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;color:#303030;white-space:nowrap}
.wl-modal-tabs button.active{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12);font-weight:600}
.wl-modal-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(360px,5fr) 6fr;gap:30px;margin:0 36px;padding:20px 20px 0;background:#fff;border-radius:12px 12px 0 0;overflow:hidden}
.wl-form{overflow:auto;padding:0 12px 24px 0}
.wl-preview{overflow:auto;padding-bottom:24px}
.wl-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 36px;background:#fff;border-top:1px solid #e1e1e1;margin:0 36px}

.wl-field-row{display:grid;grid-template-columns:150px 1fr;gap:16px;align-items:center;padding:2px 0}
.wl-color-btn,.wl-color-field{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid #8a8a8a;border-radius:8px;background:#fff;cursor:pointer;font-size:13px}
.wl-color-btn{min-width:146px;justify-content:flex-start}
.wl-color-btn .wl-caret{margin-left:auto}
.wl-color-field{width:100%}
.wl-swatch{width:16px;height:16px;border-radius:3px;border:1px solid #ccc}
.wl-color-btn .wl-swatch{border-radius:50%}
.wl-icon-options{display:flex;gap:10px;flex-wrap:wrap}
.wl-icon-option{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:#f4f4f4;font-size:13px;cursor:pointer}
.wl-icon-option.selected{background:#e8f2ff}
.wl-radio-stack{display:flex;flex-direction:column;gap:12px}
.wl-radio-inline{display:flex;gap:16px;flex-wrap:wrap}
.wl-radio-list{display:flex;flex-direction:column}
.wl-radio-item{padding:12px 0;border-bottom:1px solid #ebebeb}
.wl-radio-item:last-child{border-bottom:0}
.wl-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
fieldset{border:0;padding:0;margin:0;min-width:0}
.wl-disabled{opacity:.5;pointer-events:none}
.wl-pills{display:inline-flex;gap:4px;background:#f4f4f4;border-radius:8px;padding:2px}
.wl-pills button{border:0;background:none;padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:#616161}
.wl-pills button.active{background:#fff;color:#303030;font-weight:600;box-shadow:0 1px 1px rgba(0,0,0,.1)}

.wl-option-card{border:1px solid #d6d6d6;border-radius:10px;padding:12px 14px}
.wl-option-card.selected{border-color:#2c6ecb;background:#f6f7f9;box-shadow:0 0 0 1px #2c6ecb inset}
.wl-option-card.muted{opacity:.7}
.wl-option-fields{margin-top:10px}

.wl-preview-card{border:1px solid #d6d6d6;border-radius:10px;min-height:520px;background:#fff}
.wl-preview-top{padding:12px 20px;border-bottom:1px solid #ebebeb}
.wl-preview-top span{font-size:11px;background:#f1f1f1;border-radius:6px;padding:2px 8px;color:#616161}
.wl-preview-stage{padding:32px 40px;position:relative}
.wl-ph{background:#e3e3e3;border-radius:6px}
.wl-ph-line{height:8px;border-radius:4px;background:#e3e3e3;margin-bottom:8px}
.wl-product{display:grid;grid-template-columns:1.45fr 1fr;gap:16px;align-items:start;padding-top:24px}
.wl-product-img{aspect-ratio:1.09}
.wl-product-info{display:flex;flex-direction:column;gap:8px;padding-top:36px}
.wl-inline-row{display:flex;gap:8px}
.wl-quick{position:absolute;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.wl-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.wl-tile{border:1px solid #d6d6d6;border-radius:8px;padding:14px}
.wl-nav{display:flex;gap:18px;font-size:13px;padding-bottom:14px;margin-bottom:18px;border-bottom:1px solid #eee;align-items:center}
.wl-nav-actions{margin-left:auto;display:inline-flex;gap:8px}
.wl-nav-circle{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e3e3e3;font-size:12px}
.wl-nav-circle.dark{background:#ececec}
.wl-badge{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:#f00;color:#fff;font-size:10px;display:grid;place-items:center;padding:0 4px}
.wl-float{position:absolute;display:grid;place-items:center;width:52px;height:44px}
.wl-whead{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:6px 8px 16px;border-bottom:1px solid #eee;margin-bottom:18px}
.wl-share{display:inline-flex;gap:8px;align-items:center;font-size:12px}
.wl-wgrid{display:grid;gap:16px 40px;padding:0 40px}
.wl-add{font-size:11px;margin-top:6px}
.wl-overlay-wrap{position:relative;min-height:380px;background:rgba(0,0,0,.05);border-radius:6px;display:flex;justify-content:flex-end}
.wl-overlay-wrap.center{justify-content:center;align-items:center}
.wl-drawer{width:60%;background:#fff;padding:12px;box-shadow:-4px 0 12px rgba(0,0,0,.1)}
.wl-drawer .wl-wgrid{padding:0;gap:12px}
.wl-modalbox{width:80%;background:#fff;padding:12px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.wl-modalbox .wl-wgrid{padding:0;gap:12px}
.wl-cartdrawer{margin-left:auto;width:230px;min-height:430px;background:#f6f6f6;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:16px;display:flex;flex-direction:column;gap:14px}
.wl-cart-title{font-weight:600;color:#3d4a9a}
.wl-cart-line{display:flex;gap:10px}
.wl-remove{font-size:9px;text-decoration:underline;color:#3d4a9a;margin-top:30px}
.wl-popup{position:absolute;left:0;top:150px;width:75%;display:flex;background:#fff;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.2);overflow:hidden}
.wl-popup-img{width:104px;background:#f2f2f2;display:grid;place-items:center;font-size:32px;opacity:.4}
.wl-popup-body{padding:14px 14px 18px;flex:1}
.wl-popup-pri,.wl-popup-sec{padding:9px 14px;font-size:12px;border:1px solid #111}
.wl-popup-sec{background:#fff;color:#111}

.wl-editor{border:1px solid #d6d6d6;border-radius:10px;display:flex;flex-direction:column;height:100%;min-height:520px;overflow:hidden;background:#fff}
.wl-editor-head{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-bottom:1px solid #ebebeb}
.wl-editor-tabs{display:flex;gap:4px}
.wl-editor-tabs button{border:0;background:none;padding:8px 10px;font-size:12px;cursor:pointer;color:#303030;border-radius:6px}
.wl-editor-tabs button.active{background:#e8f2ff;color:#005bd3;font-weight:600}
.wl-editor-note{background:#fff7e0;border-bottom:1px solid #f1d98a;padding:8px 12px;font-size:11px;color:#6b4e00}
.wl-editor-body{display:flex;flex:1;min-height:0;font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace}
.wl-editor-gutter{padding:8px;text-align:right;color:#9a9a9a;background:#fafafa;user-select:none}
.wl-editor-text{flex:1;border:0;outline:0;resize:none;padding:8px;font:inherit;color:#1f4f9a;background:#fff;white-space:pre;overflow:auto}
.wl-editor-text[readonly]{cursor:default}
@media (max-width:900px){.wl-modal-body{grid-template-columns:1fr;overflow:auto}.wl-modal-tabs{padding:16px}.wl-modal-body,.wl-modal-foot{margin:0 12px}.wl-field-row{grid-template-columns:1fr}}
`;
