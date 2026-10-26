import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import { loadCustomerValueDetail } from "../models/customer-value-detail.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const searchParams = new URL(request.url).searchParams;
  const segment = searchParams.get("segment");
  if (segment !== "guest" && segment !== "logged-in") {
    return json({ error: "Invalid customer segment" }, { status: 400 });
  }

  try {
    const range = paramsRange(parseAnalyticsParams(searchParams));
    const detail = await loadCustomerValueDetail(
      shop.id,
      admin,
      range,
      segment,
    );
    return json(detail, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load customer value details", error);
    return json({ error: "Unable to load customer details" }, { status: 500 });
  }
}
