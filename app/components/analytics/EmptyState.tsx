/**
 * EmptyState — shown when a report has no data for the selected range.
 */

import { Card, Text, Button } from "@shopify/polaris";
import { useRevalidator } from "@remix-run/react";

export type EmptyStateProps = {
  title: string;
  description: string;
  refreshLabel?: string;
};

export function EmptyState({
  title,
  description,
  refreshLabel = "Refresh data",
}: EmptyStateProps) {
  const revalidator = useRevalidator();
  return (
    <Card>
      <div>
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
        <Button
          variant="primary"
          onClick={() => revalidator.revalidate()}
        >
          {refreshLabel}
        </Button>
      </div>
    </Card>
  );
}
