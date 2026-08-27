/**
 * Tiny mustache-style renderer for merchant-editable subject lines and copy.
 * Supported tokens: {{ product_title }}, {{ variant_title }}, {{ shop_name }},
 * {{ price }}, {{ product_url }}, {{ checkout_url }}, {{ customer_email }}.
 */
export type TemplateVars = Record<string, string | undefined>;

export function render(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BackInStockEmailInput = {
  heading: string;
  body: string;
  buttonLabel: string;
  productTitle: string;
  variantTitle?: string | null;
  imageUrl?: string | null;
  price?: string | null;
  actionUrl: string;
  shopName: string;
  unsubscribeUrl: string;
};

/** Inlined-CSS transactional email; renders acceptably in Gmail, Outlook and Apple Mail. */
export function backInStockHtml(input: BackInStockEmailInput): string {
  const e = escapeHtml;
  const variantLine =
    input.variantTitle && input.variantTitle !== "Default Title"
      ? `<p style="margin:4px 0 0;font-size:14px;color:#6b7177;">${e(input.variantTitle)}</p>`
      : "";
  const priceLine = input.price
    ? `<p style="margin:8px 0 0;font-size:16px;font-weight:600;color:#1a1a1a;">${e(input.price)}</p>`
    : "";
  const image = input.imageUrl
    ? `<img src="${e(input.imageUrl)}" width="220" alt="${e(input.productTitle)}"
         style="display:block;border:0;border-radius:12px;max-width:220px;height:auto;margin:0 auto 20px;" />`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${e(input.heading)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;padding:32px;border-collapse:collapse;">
        <tr><td align="center">
          ${image}
          <h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;">${e(input.heading)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4f54;">${e(input.body)}</p>
          <p style="margin:0;font-size:18px;font-weight:600;">${e(input.productTitle)}</p>
          ${variantLine}
          ${priceLine}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;border-collapse:collapse;">
            <tr><td style="border-radius:10px;background:#1a1a1a;">
              <a href="${e(input.actionUrl)}"
                 style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                 ${e(input.buttonLabel)}</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8c9196;">
            You asked ${e(input.shopName)} to tell you when this item came back.<br />
            <a href="${e(input.unsubscribeUrl)}" style="color:#8c9196;">Unsubscribe from this alert</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function backInStockText(input: BackInStockEmailInput): string {
  return [
    input.heading,
    "",
    input.body,
    "",
    `${input.productTitle}${input.variantTitle && input.variantTitle !== "Default Title" ? ` — ${input.variantTitle}` : ""}`,
    input.price || "",
    "",
    `${input.buttonLabel}: ${input.actionUrl}`,
    "",
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/* ---------- Confirmation email (double opt-in) ---------- */

export type ConfirmationEmailInput = {
  shopName: string;
  productTitle: string;
  variantTitle?: string | null;
  confirmUrl: string;
  unsubscribeUrl: string;
};

export function confirmationEmailHtml(input: ConfirmationEmailInput): string {
  const e = escapeHtml;
  const variantLine =
    input.variantTitle && input.variantTitle !== "Default Title"
      ? `<p style="margin:4px 0 0;font-size:14px;color:#6b7177;">${e(input.variantTitle)}</p>`
      : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Confirm your back-in-stock alert</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;padding:32px;border-collapse:collapse;">
        <tr><td align="center">
          <h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;">Confirm your alert</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4f54;">
            You asked <strong>${e(input.shopName)}</strong> to notify you when this item is back in stock.
          </p>
          <p style="margin:0 0 4px;font-size:16px;font-weight:600;">${e(input.productTitle)}</p>
          ${variantLine}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;border-collapse:collapse;">
            <tr><td style="border-radius:10px;background:#16a34a;">
              <a href="${e(input.confirmUrl)}"
                 style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                 Yes, notify me</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8c9196;">
            If you didn't request this, you can safely ignore this email.<br />
            <a href="${e(input.unsubscribeUrl)}" style="color:#8c9196;">Cancel this alert</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function confirmationEmailText(input: ConfirmationEmailInput): string {
  return [
    `Confirm your alert — ${input.productTitle}`,
    "",
    `You asked ${input.shopName} to notify you when this item is back in stock.`,
    "",
    `Confirm: ${input.confirmUrl}`,
    "",
    `Cancel: ${input.unsubscribeUrl}`,
  ].join("\n");
}
