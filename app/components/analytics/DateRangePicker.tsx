/**
 * DateRangePicker — shared Polaris component for all analytics reports.
 * Supports from/to dates, compare-to-previous-period toggle.
 */

import { useSearchParams } from "@remix-run/react";
import {
  Card,
  Checkbox,
  FormLayout,
  Select,
  TextField,
  BlockStack,
  Button,
} from "@shopify/polaris";
import { useState, useEffect } from "react";

export type DateRangePickerProps = {
  from: string;
  to: string;
  compare: boolean;
  onChange: (params: URLSearchParams) => void;
  disabled?: boolean;
};

export function DateRangePicker({
  from,
  to,
  compare,
  onChange,
  disabled = false,
}: DateRangePickerProps) {
  const [searchParams] = useSearchParams();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);
  const [localCompare, setLocalCompare] = useState(compare);
  const today = new Date().toISOString().slice(0, 10);
  const dayCount = Math.round(
    (Date.parse(`${localTo}T00:00:00Z`) - Date.parse(`${localFrom}T00:00:00Z`)) /
      86400000,
  ) + 1;
  const presetValue = localTo === today && [7, 14, 30, 90].includes(dayCount)
    ? String(dayCount)
    : "custom";

  // Keep local inputs in sync when the URL changes (e.g. after Remix navigation).
  useEffect(() => {
    setLocalFrom(from);
    setLocalTo(to);
    setLocalCompare(compare);
  }, [from, to, compare]);

  const submit = () => {
    const next = new URLSearchParams(searchParams);
    next.set("from", localFrom);
    next.set("to", localTo);
    next.set("compare", localCompare ? "true" : "false");
    onChange(next);
  };

  return (
    <Card>
      <FormLayout>
        <FormLayout.Group>
          <BlockStack>
            <Select
              label="Date range"
              options={[
                { label: "Custom range", value: "custom" },
                { label: "Last 7 days", value: "7" },
                { label: "Last 14 days", value: "14" },
                { label: "Last 30 days", value: "30" },
                { label: "Last 90 days", value: "90" },
              ]}
              value={presetValue}
              onChange={(value) => {
                const days = Number(value);
                if (!Number.isFinite(days) || days < 1) return;
                const start = new Date(
                  Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000,
                ).toISOString().slice(0, 10);
                setLocalFrom(start);
                setLocalTo(today);
              }}
              disabled={disabled}
            />
            <TextField
              label="From (UTC)"
              type="date"
              value={localFrom}
              onChange={setLocalFrom}
              autoComplete="off"
              max={localTo || undefined}
              disabled={disabled}
            />
            <TextField
              label="To (UTC)"
              type="date"
              value={localTo}
              onChange={setLocalTo}
              autoComplete="off"
              min={localFrom || undefined}
              max={new Date().toISOString().slice(0, 10)}
              disabled={disabled}
            />
            <Checkbox
              label="Compare to previous period"
              checked={localCompare}
              onChange={checked => setLocalCompare(checked)}
              disabled={disabled}
            />
            <Button variant="primary" onClick={submit} disabled={disabled}>
              Apply
            </Button>
          </BlockStack>
        </FormLayout.Group>
      </FormLayout>
    </Card>
  );
}
