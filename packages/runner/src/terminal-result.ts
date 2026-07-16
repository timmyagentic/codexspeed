import type { RunUpload } from "@codexspeed/contracts";
import { summarizeRun, type MetricDistribution } from "@codexspeed/metrics";

export type TerminalResult = {
  lines: string[];
  hasValidMeasurements: boolean;
};

function speed(distribution: MetricDistribution | null): string {
  if (distribution === null) return "unavailable";
  return `${distribution.p50.toFixed(1)} tok/s p50 (${distribution.min.toFixed(1)}-${distribution.max.toFixed(1)}, n=${distribution.n})`;
}

function duration(distribution: MetricDistribution | null): string {
  if (distribution === null) return "unavailable";
  return `${(distribution.p50 / 1_000).toFixed(2)} s p50 (${(distribution.min / 1_000).toFixed(2)}-${(distribution.max / 1_000).toFixed(2)}, n=${distribution.n})`;
}

export function formatTerminalResult(
  run: RunUpload,
  artifactPath: string,
): TerminalResult {
  const summary = summarizeRun(run);
  const modelNames = new Map(
    run.catalog.models.map((model) => [model.id, model.displayName]),
  );
  const lines = ["", "Local result"];

  for (const cell of summary.cells) {
    const displayName = modelNames.get(cell.model) ?? cell.model;
    lines.push(
      `Model: ${displayName} (${cell.model})`,
      `Reasoning effort: ${cell.effort}`,
      `Visible stream speed (estimated): ${speed(cell.metrics.visibleStreamTpsEstimate)}`,
      `First visible text: ${duration(cell.metrics.firstVisibleTextMs)}`,
      `Visible end-to-end: ${speed(cell.metrics.visibleE2eTps)}`,
      `Total latency: ${duration(cell.metrics.totalLatencyMs)}`,
    );
  }

  const hasValidMeasurements = summary.reliability.validSamples > 0;
  lines.push(
    `Reliability: ${summary.reliability.validSamples}/${summary.reliability.measuredSamples} measured samples valid`,
  );
  if (!hasValidMeasurements) {
    lines.push("Warning: no valid measured samples were produced.");
  } else if (summary.reliability.invalidSamples > 0) {
    lines.push(
      `Warning: ${summary.reliability.invalidSamples} measured sample${summary.reliability.invalidSamples === 1 ? " was" : "s were"} invalid and excluded.`,
    );
  }
  lines.push(
    `Saved locally: ${artifactPath}`,
    "This result reflects this device, network, account path, and test time.",
    "Nothing was uploaded.",
  );
  return { lines, hasValidMeasurements };
}
