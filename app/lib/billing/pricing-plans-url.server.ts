/**
 * Shopify-hosted plan page. Monthly and annual prices are configured in the
 * Partner Dashboard (Shopify App Pricing). The merchant confirms the charge there.
 * https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
 */
export function pricingPlansUrl(shopDomain: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/i, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "wishlist-stock";
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}
