import { Link } from "@remix-run/react";
import type { ReactNode } from "react";

type Step = { label: string; value: number; href?: string };

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <figure className="ws-chart-card">
      <figcaption>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal bar series (alert funnel, top products)                  */
/* ------------------------------------------------------------------ */
export function BarSeriesChart({
  title,
  subtitle,
  steps,
  accentLast = false,
}: {
  title: string;
  subtitle?: string;
  steps: Step[];
  accentLast?: boolean;
}) {
  const max = Math.max(1, ...steps.map((step) => step.value));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ul className="ws-chart-bars">
        {steps.map((step, index) => {
          const width = `${Math.max((step.value / max) * 100, step.value > 0 ? 4 : 0)}%`;
          const bar = (
            <>
              <span className="ws-chart-bar-label">{step.label}</span>
              <span
                className={`ws-chart-bar-track${
                  accentLast && index === steps.length - 1
                    ? " ws-chart-bar-track-accent"
                    : ""
                }`}
                aria-hidden="true"
              >
                <span
                  className="ws-chart-bar-fill"
                  style={{ width }}
                />
              </span>
              <span className="ws-chart-bar-value">
                {step.value.toLocaleString()}
              </span>
            </>
          );
          return (
            <li key={step.label}>
              {step.href ? (
                <Link className="ws-chart-bar" to={step.href}>
                  {bar}
                </Link>
              ) : (
                <span className="ws-chart-bar">{bar}</span>
              )}
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* Single-value donut (rates)                                          */
/* ------------------------------------------------------------------ */
export function DonutChart({
  label,
  value,
  total,
  hint,
}: {
  label: string;
  value: number;
  total: number;
  hint?: string;
}) {
  const rate = total > 0 ? Math.min(value / total, 1) : 0;
  const percent = Math.round(rate * 1000) / 10;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <figure className="ws-chart-donut" aria-label={`${label}: ${percent}%`}>
      <svg viewBox="0 0 80 80" role="img" aria-hidden="true">
        <circle className="ws-donut-track" cx="40" cy="40" r={radius} />
        <circle
          className="ws-donut-value"
          cx="40"
          cy="40"
          r={radius}
          strokeDasharray={`${rate * circumference} ${circumference}`}
          transform="rotate(-90 40 40)"
        />
        <text className="ws-donut-text" x="40" y="45" textAnchor="middle">
          {percent}%
        </text>
      </svg>
      <figcaption>
        <strong>{label}</strong>
        <span>
          {value.toLocaleString()} of {total.toLocaleString()}
          {hint ? ` · ${hint}` : ""}
        </span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-segment donut (inventory)                                     */
/* ------------------------------------------------------------------ */
export function SegmentedDonut({
  title,
  segments,
}: {
  title: string;
  segments: { label: string; value: number; tone: string }[];
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = segments.map((segment) => {
    const length = total > 0 ? (segment.value / total) * circumference : 0;
    const arc = (
      <circle
        key={segment.label}
        className={`ws-donut-segment ${segment.tone}`}
        cx="40"
        cy="40"
        r={radius}
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 40 40)"
      />
    );
    offset += length;
    return arc;
  });
  return (
    <ChartCard title={title}>
      <div className="ws-chart-donut-row">
        <svg viewBox="0 0 80 80" role="img" aria-label={title}>
          <circle className="ws-donut-track" cx="40" cy="40" r={radius} />
          {arcs}
          <text className="ws-donut-text" x="40" y="45" textAnchor="middle">
            {total.toLocaleString()}
          </text>
        </svg>
        <ul className="ws-chart-legend">
          {segments.map((segment) => (
            <li key={segment.label}>
              <span className={`ws-chart-swatch ${segment.tone}`} />
              <span className="ws-chart-legend-label">{segment.label}</span>
              <span className="ws-chart-legend-value">
                {segment.value.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
