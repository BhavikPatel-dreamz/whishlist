/**
 * KpiCard — a key performance indicator card with value, optional delta vs
 * previous period, and an optional link to a detail report.
 */

import { Link } from "@remix-run/react";
import { Badge, Card, Text, BlockStack } from "@shopify/polaris";
import { formatPercent } from "../../lib/metrics";

export type KpiCardProps = {
  label: string;
  value: number | string;
  delta?: number | null;
  format?: "number" | "percent" | "currency";
  href?: string;
  subtitle?: string;
  badge?: React.ReactNode;
};

function displayValue(
  value: number | string,
  format: KpiCardProps["format"],
): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
    default:
      return value.toLocaleString();
  }
}

export function KpiCard({
  label,
  value,
  delta,
  format = "number",
  href,
  subtitle,
  badge,
}: KpiCardProps) {
  const deltaText =
    delta === null
      || delta === undefined
      ? "No previous-period baseline"
      : `${delta >= 0 ? "+" : ""}${formatPercent(delta)} vs previous period`;

  const badgeTone =
    delta === null || delta === undefined
      ? "info"
      : delta >= 0
        ? "success"
        : "attention";

  const content = (
    <BlockStack>
      <Text as="p" variant="bodySm">
        {label}
      </Text>
      <Text as="p" variant="bodyLg" fontWeight="semibold">
        {displayValue(value, format)}
      </Text>
      {delta !== undefined && delta !== null && (
        <Badge tone={badgeTone}>{deltaText}</Badge>
      )}
      {subtitle && <Text as="p" variant="bodySm">{subtitle}</Text>}
      {badge && <div style={{ marginTop: 8 }}>{badge}</div>}
    </BlockStack>
  );

  if (href) {
    return (
      <Link to={href} style={{ textDecoration: "none", display: "block" }}>
        <Card>{content}</Card>
      </Link>
    );
  }

  return <Card>{content}</Card>;
}
