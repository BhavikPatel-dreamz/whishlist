import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ProxyError } from "./proxy.server";
function key() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Missing app secret");
  return createHash("sha256").update(`wishlist-share:${secret}`).digest();
}
export function createShareToken(shopId: string, customerId: string | null, guestToken: string | null = null, listName: string | null = null) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ shopId, customerId, guestToken: customerId ? null : guestToken, listName, expires: Date.now() + 30 * 86400000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function readShareToken(token: string, shopId: string): { customerId: string | null; guestToken: string | null; listName: string | null } {
  try {
    if (!/^[\w-]{40,1024}$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (data.shopId !== shopId || !(data.expires > Date.now())) throw new Error();
    if (data.customerId ? !/^\d+$/.test(data.customerId) : typeof data.guestToken !== "string" || data.guestToken.length < 8 || data.guestToken.length > 64) throw new Error();
    if (data.listName != null && (typeof data.listName !== "string" || data.listName.length > 60)) throw new Error();
    return { customerId: data.customerId || null, guestToken: data.customerId ? null : data.guestToken, listName: data.listName || null };
  } catch { throw new ProxyError(404, "This shared wishlist link is invalid or has expired.", "invalid_share"); }
}
