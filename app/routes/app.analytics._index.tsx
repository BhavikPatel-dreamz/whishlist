import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const polarisUrl = new URL("/app/analytics/polaris", url.origin);
  for (const key of ["from", "to", "compare"]) {
    const value = url.searchParams.get(key);
    if (value) polarisUrl.searchParams.set(key, value);
  }
  return redirect(polarisUrl.toString());
}

export default function AnalyticsIndex() {
  return null;
}