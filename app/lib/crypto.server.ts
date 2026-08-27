import crypto from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for merchant secrets (email provider keys, Twilio token).
 * Falls back to the Shopify API secret when APP_ENCRYPTION_KEY is not set so local dev works,
 * but production deploys should always set a dedicated 32-byte key.
 */
function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET || "";
  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY (or SHOPIFY_API_SECRET) must be set to store secrets");
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

const PREFIX = "enc.v1.";

export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // value written before encryption was enabled
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(".");
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

/** Masks a secret for display in the admin UI: "sk_live_1234…cdef". */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}${"•".repeat(6)}${value.slice(-4)}`;
}

/** Stable, URL-safe token used for one-click unsubscribe links in emails. */
export function signPayload(payload: string): string {
  const secret = process.env.SHOPIFY_API_SECRET || process.env.APP_ENCRYPTION_KEY || "";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyPayloadSignature(payload: string, signature: string): boolean {
  const expected = signPayload(payload);
  return timingSafeEqual(expected, signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
