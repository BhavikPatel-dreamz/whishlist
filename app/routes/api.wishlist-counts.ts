import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateProxyRequest } from "../lib/proxy-auth.server";
import { clientIp, errorResponse, json } from "../lib/proxy.server";
import { rateLimit } from "../lib/rate-limit.server";
import db from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const ctx = await authenticateProxyRequest(request);
    await rateLimit({ key: `wishlist-counts:${ctx.shopDomain}:${clientIp(request)}`, limit: 120, windowSeconds: 60, shopId: ctx.shop.id });
    const ids = [...new Set((ctx.url.searchParams.get("ids") || "").split(","))];
    if (ids.length > 100 || ids.some((id) => !/^\d+$/.test(id))) {
      return json({ ok: false, message: "Provide up to 100 numeric product IDs." }, { status: 400 });
    }
    const rows = await db.wishlistItem.groupBy({
      by: ["productId"],
      where: { shopId: ctx.shop.id, productId: { in: ids } },
      _count: { _all: true },
    });
    const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    rows.forEach((row) => { counts[row.productId] = row._count._all; });
    return json({ ok: true, counts });
  } catch (error) {
    return errorResponse(error);
  }
}
