import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { RecurringCustomerDetailPage } from "../components/analytics/RecurringCustomerDetailDrawer";
import classicAnalyticsStyles from "../components/analytics/ClassicAnalytics.css?url";
import { requireAdminShop } from "../lib/admin-auth.server";
import { paramsRange, parseAnalyticsParams } from "../lib/analytics-params";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminShop(request);
  const customerId = params.customerId?.trim();
  if (!customerId || !/^[0-9]+$/.test(customerId)) {
    throw new Response("Invalid customer id", { status: 400 });
  }

  const url = new URL(request.url);
  const range = paramsRange(parseAnalyticsParams(url.searchParams));
  const returnToParam = url.searchParams.get("returnTo") ?? "";
  let returnTo = "/app";
  try {
    const target = new URL(returnToParam, url.origin);
    if (
      target.origin === url.origin &&
      (target.pathname === "/app" || target.pathname.startsWith("/app/"))
    ) {
      returnTo = `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    returnTo = "/app";
  }

  return json({ customerId, from: range.from, to: range.to, returnTo });
}

export const links = () => [{ rel: "stylesheet", href: classicAnalyticsStyles }];

export default function AnalyticsCustomer() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <RecurringCustomerDetailPage
      customerId={data.customerId}
      from={data.from}
      to={data.to}
      onBack={() => navigate(data.returnTo)}
    />
  );
}
