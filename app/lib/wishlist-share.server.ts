import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ProxyError } from "./proxy.server";
function key() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Missing app secret");
  return createHash("sha256").update(`wishlist-share:${secret}`).digest();
}
export function createShareToken(shopId: string, customerId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ shopId, customerId, expires: Date.now() + 30 * 86400000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function readShareToken(token: string, shopId: string): string {
  try {
    if (!/^[\w-]{40,1024}$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (data.shopId !== shopId || !/^\d+$/.test(data.customerId) || !(data.expires > Date.now())) throw new Error();
    return data.customerId;
  } catch { throw new ProxyError(404, "This shared wishlist link is invalid or has expired.", "invalid_share"); }
}
