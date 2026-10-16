import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  url.pathname = "/app/analytics";
  url.searchParams.set("tab", "overview");
  return redirect(`${url.pathname}${url.search}`);
}

export default function ReportsRedirect() {
  return null;
}
