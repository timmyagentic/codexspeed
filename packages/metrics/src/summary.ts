import type { RunUpload } from "@codexspeed/contracts";
import {
  DEFAULT_MIN_VISIBLE_TOKENS,
  evaluateSampleRaw,
  roundMetric,
  type SampleEvaluation,
  type SampleMetrics,
} from "./sample.js";

type SelectionCell = RunUpload["selection"]["cells"][number];

export type MetricDistribution = {
  p50: number;
  min: number;
  max: number;
  n: number;
};

export type ReliabilityCounts = {
  measuredSamples: number;
  validSamples: number;
  invalidSamples: number;
};

export type CellSummary = SelectionCell & {
  coverage: {
    expectedMeasuredSamples: number;
    recordedMeasuredSamples: number;
  };
  reliability: ReliabilityCounts;
  metrics: {
    firstVisibleTextMs: MetricDistribution | null;
    visibleStreamTpsEstimate: MetricDistribution | null;
    visibleE2eTps: MetricDistribution | null;
    generatedE2eTps: MetricDistribution | null;
    totalLatencyMs: MetricDistribution | null;
  };
};

export type RunSummary = {
  runId: RunUpload["runId"];
  coverage: {
    selectedCells: number;
    measuredCells: number;
    unmeasuredCells: number;
    expectedMeasuredSamples: number;
    recordedMeasuredSamples: number;
  };
  reliability: ReliabilityCounts;
  cells: CellSummary[];
};

function cellKey(cell: SelectionCell): string {
  return `${cell.model}\u0000${cell.effort}`;
}

function displayCellKey(cell: SelectionCell): string {
  return `${cell.model}\\0${cell.effort}`;
}

function reliability(evaluations: SampleEvaluation[]): ReliabilityCounts {
  const validSamples = evaluations.filter((evaluation) => evaluation.valid).length;

  return {
    measuredSamples: evaluations.length,
    validSamples,
    invalidSamples: evaluations.length - validSamples,
  };
}

function distribution(values: number[]): MetricDistribution | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[midpoint]!
      : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;

  return {
    p50: roundMetric(median),
    min: roundMetric(sorted[0]!),
    max: roundMetric(sorted.at(-1)!),
    n: sorted.length,
  };
}

function metricValues(
  evaluations: SampleEvaluation[],
  select: (metrics: SampleMetrics) => number | null,
): number[] {
  const values: number[] = [];

  for (const evaluation of evaluations) {
    if (!evaluation.valid) {
      continue;
    }

    const value = select(evaluation.metrics);
    if (value !== null) {
      values.push(value);
    }
  }

  return values;
}

export function summarizeRun(run: RunUpload): RunSummary {
  const measuredSamples = run.samples.filter((sample) => sample.phase === "measured");
  const selectedKeys = new Set(run.selection.cells.map(cellKey));
  const offSelectionSample = measuredSamples.find((sample) => !selectedKeys.has(cellKey(sample)));

  if (offSelectionSample !== undefined) {
    throw new RangeError(
      `measured sample model-effort pair is outside run selection: ${displayCellKey(offSelectionSample)}`,
    );
  }

  const measuredEvaluations = measuredSamples.map((sample) => ({
    key: cellKey(sample),
    evaluation: evaluateSampleRaw(sample, DEFAULT_MIN_VISIBLE_TOKENS),
  }));
  const evaluationsByCell = new Map<string, SampleEvaluation[]>();

  for (const cell of run.selection.cells) {
    evaluationsByCell.set(cellKey(cell), []);
  }

  for (const { key, evaluation } of measuredEvaluations) {
    evaluationsByCell.get(key)?.push(evaluation);
  }

  const cells = run.selection.cells.map((cell): CellSummary => {
    const evaluations = evaluationsByCell.get(cellKey(cell))!;

    return {
      ...cell,
      coverage: {
        expectedMeasuredSamples: run.selection.measuredRounds,
        recordedMeasuredSamples: evaluations.length,
      },
      reliability: reliability(evaluations),
      metrics: {
        firstVisibleTextMs: distribution(
          metricValues(evaluations, (metrics) => metrics.firstVisibleTextMs),
        ),
        visibleStreamTpsEstimate: distribution(
          metricValues(evaluations, (metrics) => metrics.visibleStreamTpsEstimate),
        ),
        visibleE2eTps: distribution(
          metricValues(evaluations, (metrics) => metrics.visibleE2eTps),
        ),
        generatedE2eTps: distribution(
          metricValues(evaluations, (metrics) => metrics.generatedE2eTps),
        ),
        totalLatencyMs: distribution(
          metricValues(evaluations, (metrics) => metrics.totalLatencyMs),
        ),
      },
    };
  });
  const measuredCells = cells.filter((cell) => cell.reliability.measuredSamples > 0).length;
  const allEvaluations = measuredEvaluations.map(({ evaluation }) => evaluation);

  return {
    runId: run.runId,
    coverage: {
      selectedCells: run.selection.cells.length,
      measuredCells,
      unmeasuredCells: run.selection.cells.length - measuredCells,
      expectedMeasuredSamples: run.selection.cells.length * run.selection.measuredRounds,
      recordedMeasuredSamples: measuredSamples.length,
    },
    reliability: reliability(allEvaluations),
    cells,
  };
}
