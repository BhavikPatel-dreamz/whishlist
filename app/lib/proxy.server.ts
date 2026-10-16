import crypto from "node:crypto";
import { timingSafeEqual } from "./crypto.server";

/**
 * Verifies the `signature` query parameter Shopify adds to every App Proxy request.
 *
 * Shopify sorts the remaining query params, joins them as `key=value` with no separator,
 * and HMAC-SHA256s the result with the app's shared secret.
 * See https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#calculate-a-digital-signature
 */
export function verifyAppProxySignature(
  url: URL,
  secret = process.env.SHOPIFY_API_SECRET || "",
): boolean {
  const signature = url.searchParams.get("signature");
  if (!signature || !secret) return false;

  const params: Record<string, string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "signature") continue;
    (params[key] ||= []).push(value);
  }

  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key].join(",")}`)
    .join("");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return timingSafeEqual(digest, signature);
}

export class ProxyError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // App Proxy responses are same-origin with the storefront; never let a CDN cache
      // shopper-specific payloads.
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ProxyError) {
    return json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  console.error("[proxy] unhandled error", error);
  return json({ ok: false, code: "server_error", message: "Something went wrong" }, { status: 500 });
}

/** Client IP, trusting Shopify's proxy headers. Used as the rate-limit key. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/** Parses either a JSON body or a form post, so the storefront can use both. */
export async function readBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = await request.json();
      return typeof parsed === "object" && parsed ? (parsed as Record<string, string>) : {};
    } catch {
      throw new ProxyError(400, "Malformed JSON body", "bad_request");
    }
  }
  const form = await request.formData();
  return Object.fromEntries(
    Array.from(form.entries()).map(([k, v]) => [k, String(v)]),
  );
}

/** Shopify sends GIDs in some contexts and numeric ids in others; normalise to numeric. */
export function numericId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(\d+)\s*$/);
  return match ? match[1] : null;
}

export function toGid(kind: "Product" | "ProductVariant" | "InventoryItem", id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/${kind}/${id}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function assertEmail(value: string | undefined): string {
  const email = (value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new ProxyError(422, "Enter a valid email address", "invalid_email");
  }
  return email;
}
