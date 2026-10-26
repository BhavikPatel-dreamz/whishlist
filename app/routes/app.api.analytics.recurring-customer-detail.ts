import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";
import { loadRecurringCustomerDetail } from "../models/recurring-customer-detail.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const searchParams = new URL(request.url).searchParams;
  const customerId = searchParams.get("customerId")?.trim();
  if (!customerId || !/^\d+$/.test(customerId)) {
    return json({ error: "Invalid customer id" }, { status: 400 });
  }

  try {
    const range = paramsRange(parseAnalyticsParams(searchParams));
    const detail = await loadRecurringCustomerDetail(
      shop.id,
      admin,
      customerId,
      range,
    );
    return json(detail, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load recurring customer details", error);
    return json({ error: "Unable to load customer details" }, { status: 500 });
  }
}
