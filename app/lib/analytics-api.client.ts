/**
 * Client-side fetch helper for the analytics report API endpoints.
 * Used by Polaris UI pages to load report data via JSON.
 */

export type ReportFetchParams = {
  from?: string;
  to?: string;
  compare?: boolean;
  groupBy?: "day" | "week" | "month";
  productId?: string;
  status?: string;
  channel?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: "asc" | "desc";
  format?: "json" | "csv";
};

export async function fetchReport(
  admin: any,
  shopId: string,
  slug: string,
  params: ReportFetchParams = {},
): Promise<any> {
  const search = new URLSearchParams();
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.compare) search.set("compare", "true");
  if (params.groupBy) search.set("groupBy", params.groupBy);
  if (params.productId) search.set("productId", params.productId);
  if (params.status) search.set("status", params.status);
  if (params.channel) search.set("channel", params.channel);
  if (params.q) search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.format) search.set("format", params.format);

  const response = await fetch(`/app/api/reports/${slug}?${search}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load report ${slug}: ${response.statusText}`);
  }

  return response.json();
}
