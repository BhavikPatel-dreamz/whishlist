import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import { loadProductDetail } from "../models/product-detail.server";

/**
 * Product drill-down for analytics product rows and metric breakdowns.
 * Loaded on demand by the full-page product details route.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const productId = params.productId?.trim();
  if (!productId) {
    return json({ error: "Missing product id" }, { status: 400 });
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const range = paramsRange(parseAnalyticsParams(searchParams));
    const variantId = searchParams.get("variantId")?.trim() || undefined;
    const detail = await loadProductDetail(
      shop.id,
      admin,
      productId,
      range,
      variantId,
    );
    return json(detail, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load product analytics detail", error);
    return json({ error: "Unable to load product details" }, { status: 500 });
  }
}
