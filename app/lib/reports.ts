export const reportTabs = [
  ["products", "Product Report"],
  ["activity", "Wishlist Activity"],
  ["shared", "Shared Wishlists"],
  ["alerts", "Sent Alert Details"],
  ["purchases", "Purchases"],
] as const;
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
    (requested === "shoppers" || reportTabs.some(([key]) => key === requested))
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
export function reportCsv(columns: string[], rows: ReportRow[]) {
  const cell = (value: string | number) => {
    let text = String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
      text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [columns, ...rows.map((row) => row.cells)]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
