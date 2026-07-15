import type { MetricKey } from "./format.js";

export type MetricFormula = {
  metric: MetricKey;
  label: string;
  equation: string;
  definition: string;
  direction: "Higher is better" | "Lower is better";
};

export const METRIC_FORMULAS: MetricFormula[] = [
  {
    metric: "visibleStreamTpsEstimate",
    label: "Visible stream TPS",
    equation: "(V − 1) ÷ ((t_last − t_first) ÷ 1000)",
    definition: "An estimate of visible token delivery between the first and last visible text events.",
    direction: "Higher is better",
  },
  {
    metric: "firstVisibleTextMs",
    label: "First visible text",
    equation: "t_first",
    definition: "Milliseconds from turn start to the first visible agent-message delta.",
    direction: "Lower is better",
  },
  {
    metric: "totalLatencyMs",
    label: "Total latency",
    equation: "t_complete",
    definition: "Milliseconds from turn start through the matching turn-completed notification.",
    direction: "Lower is better",
  },
  {
    metric: "visibleE2eTps",
    label: "Visible E2E TPS",
    equation: "V ÷ (t_complete ÷ 1000)",
    definition: "Visible output tokens divided by total turn latency.",
    direction: "Higher is better",
  },
];
