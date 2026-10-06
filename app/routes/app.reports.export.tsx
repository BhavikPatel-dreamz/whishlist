import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requireShop } from "../lib/shop.server";
import { loadReport } from "../models/reports.server";
import { reportCsv } from "../lib/reports";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await requireShop(session.shop);
  const data = await loadReport(
    shop.id,
    admin,
    new URL(request.url).searchParams,
  );
  return new Response(reportCsv(data.table.columns, data.table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${data.tab}-${data.from}-${data.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
