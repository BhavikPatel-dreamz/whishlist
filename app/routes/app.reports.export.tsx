import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireAdminShop } from "../lib/admin-auth.server";
import { loadReport } from "../models/reports.server";
import { reportCsv } from "../lib/reports";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireAdminShop(request);
  const params = new URL(request.url).searchParams;
  const data = await loadReport(shop.id, admin, params);
  const kind = params.get("kind");
  return new Response(reportCsv(data.table.columns, data.table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${data.tab}${kind ? `-${kind}` : ""}-${data.from}-${data.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
