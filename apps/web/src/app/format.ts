export const METRICS = {
  visibleStreamTpsEstimate: {
    label: "Visible stream TPS",
    unit: "tok/s",
    higherIsBetter: true,
  },
  firstVisibleTextMs: {
    label: "First visible text",
    unit: "ms",
    higherIsBetter: false,
  },
  totalLatencyMs: {
    label: "Total latency",
    unit: "s",
    higherIsBetter: false,
  },
  visibleE2eTps: {
    label: "Visible E2E TPS",
    unit: "tok/s",
    higherIsBetter: true,
  },
} as const;

export type MetricKey = keyof typeof METRICS;

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatMetric(metric: MetricKey, value: number): string {
  if (metric === "firstVisibleTextMs") {
    return `${integer.format(value)} ms`;
  }
  if (metric === "totalLatencyMs") {
    return `${decimal.format(value / 1_000)} s`;
  }
  return `${decimal.format(value)} tok/s`;
}

export function formatMetricNumber(metric: MetricKey, value: number): string {
  if (metric === "firstVisibleTextMs") {
    return integer.format(value);
  }
  if (metric === "totalLatencyMs") {
    return decimal.format(value / 1_000);
  }
  return decimal.format(value);
}

export function metricHeat(
  metric: MetricKey,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (minimum === maximum) {
    return 0.5;
  }
  const normalized = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return METRICS[metric].higherIsBetter ? normalized : 1 - normalized;
}

export function relativeDifference(
  metric: MetricKey,
  valueA: number,
  valueB: number,
): number | null {
  if (valueB === 0) {
    return null;
  }
  const delta = METRICS[metric].higherIsBetter ? valueA - valueB : valueB - valueA;
  return (delta / valueB) * 100;
}

export function formatUtc(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "—";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function formatEffort(effort: string): string {
  if (effort === "xhigh") {
    return "XHigh";
  }
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function formatRunScope(
  mode: "smoke" | "full" | "series",
  series: string | null | undefined,
): string {
  switch (mode) {
    case "smoke":
      return "Smoke run";
    case "full":
      return "Full run";
    case "series":
      return series === null || series === undefined
        ? "Series run"
        : `${series.toUpperCase()} Series run`;
  }
}
