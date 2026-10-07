import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { errorResponse } from "../lib/proxy.server";

/** Shopify renders this proxy response inside the storefront theme. */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await authenticateProxyRequest(request);
    return new Response(
      '<div id="ws-wishlist-page-root"><noscript>Please enable JavaScript to view your wishlist.</noscript></div>',
      {
        headers: {
          "Content-Type": "application/liquid; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
