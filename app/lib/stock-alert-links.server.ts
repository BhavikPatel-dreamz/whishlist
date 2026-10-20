import { verifyPayloadSignature } from "./crypto.server";

/**
 * Shared guard for signed stock-alert links (confirm / unsubscribe / click):
 * the id is in the path or query string and must carry a valid signature.
 */
export function requireSignedAlertLink(
  id: string,
  signature: string | null | undefined,
  invalidMessage: string,
): void {
  if (!id || !verifyPayloadSignature(id, signature || "")) {
    throw new Response(invalidMessage, { status: 400 });
  }
}
