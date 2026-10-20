import type { LoaderFunctionArgs } from "@remix-run/node";
import { withProxy } from "../lib/proxy-route.server";

/** Shopify renders this proxy response inside the storefront theme. */
export async function loader({ request }: LoaderFunctionArgs) {
  return withProxy(request, null, () => {
    return new Response(
      '<div id="ws-wishlist-page-root"><noscript>Please enable JavaScript to view your wishlist.</noscript></div>',
      {
        headers: {
          "Content-Type": "application/liquid; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  });
}
