import type { KeyboardEvent } from "react";

import { METRICS, type MetricKey } from "../app/format.js";

const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

type MetricSelectorProps = {
  value: MetricKey;
  onChange: (metric: MetricKey) => void;
};

export function MetricSelector({ value, onChange }: MetricSelectorProps) {
  function selectFromKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % METRIC_KEYS.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + METRIC_KEYS.length) % METRIC_KEYS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = METRIC_KEYS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = METRIC_KEYS[nextIndex];
    if (next === undefined) return;
    onChange(next);
    document.getElementById(`metric-tab-${next}`)?.focus();
  }

  return (
    <div className="metric-selector">
      <div className="metric-tabs" role="tablist" aria-label="Benchmark metric">
        {METRIC_KEYS.map((metric, index) => (
          <button
            key={metric}
            id={`metric-tab-${metric}`}
            type="button"
            role="tab"
            aria-controls="benchmark-matrix-panel"
            aria-selected={value === metric}
            tabIndex={value === metric ? 0 : -1}
            onClick={() => onChange(metric)}
            onKeyDown={(event) => selectFromKey(event, index)}
          >
            {METRICS[metric].label}
          </button>
        ))}
      </div>
      <span className="metric-direction" aria-live="polite">
        {METRICS[value].unit} (
        {METRICS[value].higherIsBetter ? "higher" : "lower"} is better)
      </span>
    </div>
  );
}
