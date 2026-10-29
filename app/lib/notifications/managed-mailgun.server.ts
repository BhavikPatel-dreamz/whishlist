/**
 * Platform-managed Mailgun credentials (Wishlist Stock Notify side).
 * Merchants on Starter/Growth — and Scale without their own provider —
 * send through these env vars, not their own API keys.
 *
 * Required in hosting env:
 *   MAILGUN_API_KEY         (Private API key from Mailgun → API Security → API Keys)
 *   MAILGUN_DOMAIN          (verified domain, e.g. sandboxXXX.mailgun.org or mg.yourdomain.com)
 *   DEFAULT_SENDER_EMAIL    (must be on MAILGUN_DOMAIN — not a Gmail address)
 * Optional:
 *   MAILGUN_API_BASE_URL    (default https://api.mailgun.net; EU: https://api.eu.mailgun.net)
 *   DEFAULT_SENDER_NAME
 */

/** Strip quotes and accidental `KEY=value` / `KEY='value'` paste mistakes from env. */
export function sanitizeEnvValue(raw: string | undefined, envKey?: string): string {
  let value = (raw || "").trim();
  if (!value) return "";

  // Hosting UIs sometimes store the whole line: DEFAULT_SENDER_EMAIL='x@y.com'
  if (envKey) {
    const prefix = new RegExp(`^${envKey}\\s*=\\s*`, "i");
    value = value.replace(prefix, "").trim();
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

export function managedMailgunApiKey(): string {
  return sanitizeEnvValue(process.env.MAILGUN_API_KEY, "MAILGUN_API_KEY");
}

export function managedMailgunDomain(): string {
  return sanitizeEnvValue(process.env.MAILGUN_DOMAIN, "MAILGUN_DOMAIN");
}

/** US or EU Mailgun API host (no trailing slash). */
export function managedMailgunApiBaseUrl(): string {
  const raw = sanitizeEnvValue(
    process.env.MAILGUN_API_BASE_URL,
    "MAILGUN_API_BASE_URL",
  );
  const base = raw || "https://api.mailgun.net";
  return base.replace(/\/$/, "") || "https://api.mailgun.net";
}

export function managedSenderEmail(): string {
  return (
    sanitizeEnvValue(process.env.DEFAULT_SENDER_EMAIL, "DEFAULT_SENDER_EMAIL") ||
    sanitizeEnvValue(process.env.MAILGUN_FROM_EMAIL, "MAILGUN_FROM_EMAIL")
  );
}

export function managedSenderName(fallback = "Wishlist Stock Notify"): string {
  return (
    sanitizeEnvValue(process.env.DEFAULT_SENDER_NAME, "DEFAULT_SENDER_NAME") ||
    fallback
  );
}

export function managedMailgunConfigured(): boolean {
  return Boolean(
    managedMailgunApiKey() && managedMailgunDomain() && managedSenderEmail(),
  );
}

/** Domain part of an email address, lowercased. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}
