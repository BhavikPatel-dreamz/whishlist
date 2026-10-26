/**
 * ReportTable — sortable, paginated table with CSV export.
 * Uses a plain HTML table inside a Polaris Card (Polaris v12 has no DataTable).
 */

import { useSearchParams } from "@remix-run/react";
import { Button, Card, Pagination, Text } from "@shopify/polaris";

export type ReportTableProps<T extends Record<string, unknown>> = {
  title: string;
  description?: string;
  columns: { key: string; label: string }[];
  rows: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  sort?: string | null;
  order?: "asc" | "desc";
  query?: string | null;
  onExport?: () => void;
  emptyMessage?: string;
  rowLink?: (row: T) => string;
  cellRenderer?: (
    key: string,
    value: unknown,
    row: T,
  ) => React.ReactNode;
  rowKey?: (row: T) => string;
};

export function ReportTable<T extends Record<string, unknown>>({
  title,
  description,
  columns,
  rows,
  pagination,
  sort,
  order = "desc",
  query,
  onExport,
  emptyMessage = "No data available for the selected criteria.",
  rowLink,
  cellRenderer,
  rowKey = (row) => String(row[columns[0]?.key ?? "id"]),
}: ReportTableProps<T>) {
  const [searchParams] = useSearchParams();

  const sortIndicator = (key: string) => {
    if (sort !== key) return "";
    return order === "asc" ? " \u2191" : " \u2193";
  };

  const hasPrevious = pagination.page > 1;
  const hasNext = pagination.page < pagination.pageCount;

  const pageURL = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(page));
    return `?${params.toString()}`;
  };
  const sortURL = (key: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("sort", key);
    params.set("order", sort === key && order === "asc" ? "desc" : "asc");
    params.set("page", "1");
    return `?${params.toString()}`;
  };

  const prevURL = hasPrevious ? pageURL(pagination.page - 1) : undefined;
  const nextURL = hasNext ? pageURL(pagination.page + 1) : undefined;

  if (rows.length === 0) {
    return (
      <Card>
        {description && <Text as="p" variant="bodyMd">{description}</Text>}
        <Text as="p" variant="bodyMd">{emptyMessage}</Text>
      </Card>
    );
  }

  return (
    <>
      {description && <Text as="p" variant="bodyMd">{description}</Text>}
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {columns.map((col) => {
                return (
                  <th
                    key={col.key}
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#3c4348",
                      borderBottom: "1px solid #d9dce1",
                    }}
                  >
                    <a
                      href={sortURL(col.key)}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      {col.label}{sortIndicator(col.key)}
                    </a>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const link = rowLink ? rowLink(row) : null;
              return (
                <tr
                  key={key}
                  style={{ borderBottom: "1px solid #f1f2f3" }}
                >
                  {columns.map((col) => {
                    const value = row[col.key];
                    const rendered = cellRenderer
                      ? cellRenderer(col.key, value, row)
                      : String(value ?? "");
                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: "8px 12px",
                          fontSize: "13px",
                          color: "#3c4348",
                        }}
                      >
                        {link && typeof rendered === "string" ? (
                          <a href={link} style={{ color: "#0063d2" }}>
                            {rendered}
                          </a>
                        ) : (
                          rendered
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 12,
        }}
      >
        <Text as="p" variant="bodySm">
          {pagination.total} items
        </Text>
        <Pagination
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          previousURL={prevURL}
          nextURL={nextURL}
        />
        {onExport && (
          <Button variant="tertiary" onClick={onExport}>
            Export CSV
          </Button>
        )}
      </div>
    </>
  );
}
