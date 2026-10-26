/**
 * FunnelChart — renders funnel stages as horizontal bars with counts,
 * rates from previous stage, and drop-off rates.
 */

import { Card, Text } from "@shopify/polaris";

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  rateFromPrevious: number;
  dropOff: number;
  dropOffRate: number;
};

export type FunnelChartProps = {
  title: string;
  stages: FunnelStage[];
  subtitle?: string;
};

export function FunnelChart({
  title,
  stages,
  subtitle,
}: FunnelChartProps) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Card>
      <div style={{ padding: 16 }}>
        {title && (
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {title}
          </Text>
        )}
        {subtitle && <Text as="p" variant="bodySm">{subtitle}</Text>}
        {stages.map((stage, index) => {
          const width = Math.max(
            (stage.count / max) * 100,
            stage.count > 0 ? 4 : 0,
          );
          const isFirst = index === 0;
          return (
            <div
              key={stage.key}
              style={{ marginBottom: 16 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 150,
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#3c4348",
                    display: "inline-block",
                  }}
                >
                  {stage.label}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 20,
                    background: "#f1f2f3",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${width}%`,
                      background: isFirst ? "#0063d2" : "#d9e6f5",
                      borderRadius: 10,
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 50,
                    fontSize: "13px",
                    textAlign: "right",
                    color: "#3c4348",
                    display: "inline-block",
                  }}
                >
                  {stage.count.toLocaleString()}
                </span>
              </div>
              {!isFirst && (
                <Text as="p" variant="bodyXs" tone="subdued">
                  {Math.round(stage.rateFromPrevious * 100)}% from previous ·
                  {Math.round(stage.dropOffRate * 100)}% drop-off ({stage.dropOff.toLocaleString()})
                </Text>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
