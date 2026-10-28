/**
 * `authenticate.webhook` rejects invalid HMACs by throwing a Response (401).
 * Catch blocks must rethrow those — returning 200/500 fails App Store
 * "Verifies webhooks with HMAC signatures".
 */
export function rethrowWebhookAuthResponse(error: unknown): asserts error is Exclude<
  unknown,
  Response
> {
  if (error instanceof Response) throw error;
}
