/**
 * Platform-managed Mailgun credentials (Wishlist Stock Notify side).
 * Merchants on Starter/Growth — and Scale without their own provider —
 * send through these env vars, not their own API keys.
 *
 * Required in hosting env:
 *   MAILGUN_API_KEY
 *   MAILGUN_DOMAIN          (verified sending domain, e.g. mg.example.com)
 *   DEFAULT_SENDER_EMAIL    (address on that domain)
 * Optional:
 *   MAILGUN_API_BASE_URL    (default https://api.mailgun.net; EU: https://api.eu.mailgun.net)
 *   DEFAULT_SENDER_NAME
 */

export function managedMailgunApiKey(): string {
  return (process.env.MAILGUN_API_KEY || "").trim();
}

export function managedMailgunDomain(): string {
  return (process.env.MAILGUN_DOMAIN || "").trim();
}

/** US or EU Mailgun API host (no trailing slash). */
export function managedMailgunApiBaseUrl(): string {
  const raw = (process.env.MAILGUN_API_BASE_URL || "https://api.mailgun.net").trim();
  return raw.replace(/\/$/, "") || "https://api.mailgun.net";
}

export function managedSenderEmail(): string {
  return (
    process.env.DEFAULT_SENDER_EMAIL ||
    process.env.MAILGUN_FROM_EMAIL ||
    ""
  ).trim();
}

export function managedSenderName(fallback = "Wishlist Stock Notify"): string {
  return (process.env.DEFAULT_SENDER_NAME || fallback).trim();
}

export function managedMailgunConfigured(): boolean {
  return Boolean(
    managedMailgunApiKey() && managedMailgunDomain() && managedSenderEmail(),
  );
}
