export const wishlistReportTabs = [
  ["products", "Product Report"],
  ["shared", "Shared Wishlists"],
  ["wishlist-orders", "Wishlist Orders"],
] as const;

export const stockReportTabs = [
  ["stock", "Stock List"],
  ["alerts", "Sent Alert Details"],
  ["purchases", "Purchases"],
] as const;

/** Every tab key `reportTab()` accepts, across both sections. */
export const reportTabs: ReadonlyArray<readonly [string, string]> = [
  ...wishlistReportTabs,
  ...stockReportTabs,
];
export type ReportRow = {
  id: string;
  image?: string | null;
  cells: (string | number)[];
};
export type ReportTable = {
  title: string;
  description: string;
  label: string;
  columns: string[];
  rows: ReportRow[];
  note: string;
  imageColumn?: boolean;
};

export function reportTab(params: URLSearchParams) {
  const requested = params.get("tab");
  if (
    requested &&
    (requested === "overview" ||
      requested === "shoppers" ||
      requested === "stock" ||
      reportTabs.some(([key]) => key === requested))
  )
    return requested;
  return params.get("kind") === "shoppers" ? "shoppers" : "products";
}
export function filterReport(rows: ReportRow[], params: URLSearchParams) {
  const query = (params.get("q") || "").trim().toLowerCase();
  const filtered = rows.filter((row) =>
    row.cells.some((cell) => String(cell).toLowerCase().includes(query)),
  );
  const sort = params.get("sort") || "default";
  if (sort === "title-asc" || sort === "title-desc")
    filtered.sort(
      (a, b) =>
        String(a.cells[0]).localeCompare(String(b.cells[0]), undefined, {
          numeric: true,
        }) * (sort === "title-desc" ? -1 : 1),
    );
  return filtered;
}
export function toCsv(rows: Array<Array<string | number>>): string {
  const cell = (value: string | number) => {
    let text = String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
      text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function reportCsv(columns: string[], rows: ReportRow[]) {
  return toCsv([columns, ...rows.map((row) => row.cells)]);
}
