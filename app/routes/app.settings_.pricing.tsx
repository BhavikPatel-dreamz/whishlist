import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { pricingPlansUrl } from "../lib/billing/pricing-plans-url.server";

/** Opens Shopify's hosted plan page so the merchant can compare and confirm a charge. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, redirect } = await authenticate.admin(request);
  return redirect(pricingPlansUrl(session.shop), { target: "_top" });
}
