/** Absolute origin of this app (SHOPIFY_APP_URL) with any trailing slash removed. */
export function appOrigin(): string {
  return (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
}
