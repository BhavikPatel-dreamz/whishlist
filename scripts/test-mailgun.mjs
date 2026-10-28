#!/usr/bin/env node
/**
 * One-off Mailgun connectivity test using .env (does not print secrets).
 * Usage: node scripts/test-mailgun.mjs [to-email]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`.env not found at ${filePath}`);
  for (const line of fs.readFileSync(filePath, "utf8").split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile(envPath);

const apiKey = (process.env.MAILGUN_API_KEY || "").trim();
const domain = (process.env.MAILGUN_DOMAIN || "").trim();
const fromEmail = (
  process.env.DEFAULT_SENDER_EMAIL ||
  process.env.MAILGUN_FROM_EMAIL ||
  ""
).trim();
const fromName = (process.env.DEFAULT_SENDER_NAME || "Wishlist Stock Notify").trim();
const baseUrl = (
  process.env.MAILGUN_API_BASE_URL || "https://api.mailgun.net"
)
  .trim()
  .replace(/\/$/, "");

console.log("Config check:");
console.log(
  "  MAILGUN_API_KEY:",
  apiKey ? `set (${apiKey.length} chars, ${apiKey.slice(0, 8)}…)` : "MISSING",
);
console.log("  MAILGUN_DOMAIN:", domain || "MISSING");
console.log("  DEFAULT_SENDER_EMAIL:", fromEmail || "MISSING");
console.log("  DEFAULT_SENDER_NAME:", fromName || "(empty)");
console.log("  MAILGUN_API_BASE_URL:", baseUrl);

if (!apiKey || !domain || !fromEmail) {
  console.error("\nMissing required Mailgun env vars. Aborting.");
  process.exit(1);
}

const to =
  process.argv[2] ||
  process.env.MAILGUN_TEST_TO ||
  fromEmail;

const auth = Buffer.from(`api:${apiKey}`).toString("base64");
const form = new URLSearchParams({
  from: `${fromName} <${fromEmail}>`,
  to,
  subject: "Wishlist Stock Notify — Mailgun test",
  text: "This is a test email from Wishlist Stock Notify platform Mailgun settings.",
  html: "<p>This is a <strong>test email</strong> from Wishlist Stock Notify platform Mailgun settings.</p>",
});

console.log(`\nSending test message to ${to} via ${baseUrl} domain ${domain}…`);

const response = await fetch(
  `${baseUrl}/v3/${encodeURIComponent(domain)}/messages`,
  {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  },
);

const bodyText = await response.text();
let bodyJson;
try {
  bodyJson = JSON.parse(bodyText);
} catch {
  bodyJson = null;
}

if (!response.ok) {
  console.error("FAIL HTTP", response.status);
  console.error(bodyJson || bodyText.slice(0, 500));
  process.exit(1);
}

console.log("OK");
console.log("  id:", bodyJson?.id || "(none)");
console.log("  message:", bodyJson?.message || bodyText.slice(0, 200));
process.exit(0);
