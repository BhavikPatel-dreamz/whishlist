/**
 * ReportViewer — renders pre-fetched report data with KPI cards, a series
 * chart, a funnel, and a data table. Data is passed in from the server loader
 * (not fetched client-side) so the admin GraphQL client never needs to be
 * serialized across the network.
 */

import {
  Card,
  Button,
  InlineStack,
  Grid,
  Text,
  BlockStack,
  TextField,
} from "@shopify/polaris";
import { Form, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { KpiCard } from "./KpiCard";
import { ReportTable } from "./ReportTable";
import { EmptyState } from "./EmptyState";
import { isReportSlug, REPORT_CSV_ROW_KEYS } from "../../lib/report-contract";
import { downloadCsv } from "../../lib/download.client";

export type ReportViewerProps = {
  slug: string;
  title: string;
  shopId: string;
  report: any;
  from: string;
  to: string;
  compare?: boolean;
};

export function ReportViewer({
  slug,
  title,
  shopId,
  report,
  from,
  to,
  compare = false,
}: ReportViewerProps) {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);
  const data = report;
  if (!data) {
    return (
      <EmptyState
        title="Unable to load report"
        description="No data available."
        refreshLabel="Retry"
      />
    );
  }

  const summary = data.summary ?? {};
  const rows = data.rows ?? [];
  const pagination = data.pagination ?? {
    page: 1,
    pageSize: 25,
    total: 0,
    pageCount: 1,
  };
  const formParams = Array.from(searchParams.entries()).filter(
    ([key]) => key !== "q" && key !== "page" && key !== "format",
  );

  // Determine which summary metrics to show as KPI cards (first 6 numeric metrics).
  const kpiMetrics = Object.entries(summary)
    .filter(([_, v]) => typeof v === "number")
    .slice(0, 6);

  return (
    <BlockStack>
      <Text as="p" variant="bodyMd" fontWeight="semibold">
        {title}
      </Text>
      {kpiMetrics.length > 0 && (
        <Grid>
          {kpiMetrics.map(([key, value]) => (
            <Grid.Cell key={key}>
              <KpiCard
                label={
                  key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (s) => s.toUpperCase())
                }
                value={value as number}
                format="number"
                delta={compare ? data.delta?.[key] : undefined}
              />
            </Grid.Cell>
          ))}
        </Grid>
      )}
      {data.series && data.series.length > 0 && (
        <Card>
          <Text as="p" variant="bodySm" fontWeight="semibold">
            Trend
          </Text>
          <ReportTable
            title="Trend series"
            columns={Object.keys(data.series[0]).map((key) => ({
              key,
              label: key,
            }))}
            rows={data.series}
            pagination={{
              page: 1,
              pageSize: 100,
              total: data.series.length,
              pageCount: 1,
            }}
          />
        </Card>
      )}
      {rows.length > 0 ? (
        <BlockStack>
          <Form method="get" action={`/app/analytics/report/${slug}`}>
            {formParams.map(([key, value]) => (
              <input key={`${key}-${value}`} type="hidden" name={key} value={value} />
            ))}
            <InlineStack gap="200" blockAlign="end" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Search reports"
                  name="q"
                  value={query}
                  onChange={setQuery}
                  autoComplete="off"
                />
              </div>
              <Button submit>Search</Button>
            </InlineStack>
          </Form>
          <ReportTable
            title=""
            columns={
              isReportSlug(slug) && data.columns
                ? data.columns.map((label: string, index: number) => ({
                    key: REPORT_CSV_ROW_KEYS[slug][index],
                    label,
                  }))
                : []
            }
            rows={rows as any}
            pagination={pagination}
            sort={searchParams.get("sort")}
            order={searchParams.get("order") === "asc" ? "asc" : "desc"}
            onExport={() => {
              const url = new URL(
                window.location.origin + `/app/api/reports/${slug}`,
              );
              new URLSearchParams(searchParams).forEach((value, key) => {
                url.searchParams.set(key, value);
              });
              url.searchParams.set("from", from);
              url.searchParams.set("to", to);
              url.searchParams.set("format", "csv");
              void downloadCsv(
                url.toString(),
                `${slug}-${from}_${to}.csv`,
              );
            }}
          />
        </BlockStack>
      ) : (
        <EmptyState
          title="No data"
          description="No results for the selected date range."
          refreshLabel="Refresh"
        />
      )}
    </BlockStack>
  );
}
