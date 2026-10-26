/**
 * RevenueBadge — labels revenue as Direct or Estimated so merchants know
 * whether it's proven (attribution click) or inferred (saved item purchased).
 */

import { Badge } from "@shopify/polaris";
import { REVENUE_LABEL, type RevenueLabel } from "../../lib/metrics";

export type RevenueBadgeProps = {
  label: RevenueLabel;
};

export function RevenueBadge({ label }: RevenueBadgeProps) {
  const config: Record<RevenueLabel, { tone: string; text: string }> = {
    [REVENUE_LABEL.direct]: { tone: "success", text: "Direct" },
    [REVENUE_LABEL.estimated]: { tone: "attention", text: "Estimated" },
    [REVENUE_LABEL.mixed]: { tone: "info", text: "Direct + Estimated" },
  };
  const c = config[label];
  return (
    <Badge tone={c.tone as "success" | "attention" | "info"}>
      {`${c.text} revenue`}
    </Badge>
  );
}
