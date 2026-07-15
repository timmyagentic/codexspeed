import type { RunSample } from "@codexspeed/contracts";

export const DEFAULT_MIN_VISIBLE_TOKENS = 400;

export type SampleInvalidReason =
  | NonNullable<RunSample["errorCode"]>
  | Exclude<RunSample["validatorReason"], "ok">
  | "rerouted"
  | "tool_event"
  | "message_count"
  | "missing_visible_timestamps"
  | "timing_invariant"
  | "token_invariant"
  | "validator_failed";

export type SampleMetrics = {
  firstVisibleTextMs: number;
  visibleStreamTpsEstimate: number | null;
  visibleE2eTps: number;
  generatedE2eTps: number;
  totalLatencyMs: number;
};

export type SampleEvaluation =
  | {
      valid: true;
      invalidReason: null;
      visibleTokens: number;
      metrics: SampleMetrics;
    }
  | {
      valid: false;
      invalidReason: SampleInvalidReason;
      visibleTokens: number;
      metrics: null;
    };

function invalidEvaluation(
  invalidReason: SampleInvalidReason,
  visibleTokens: number,
): SampleEvaluation {
  return {
    valid: false,
    invalidReason,
    visibleTokens,
    metrics: null,
  };
}

function hasValidTokenInvariant(sample: RunSample): boolean {
  return (
    Number.isSafeInteger(sample.outputTokens) &&
    sample.outputTokens >= 0 &&
    Number.isSafeInteger(sample.reasoningOutputTokens) &&
    sample.reasoningOutputTokens >= 0 &&
    sample.reasoningOutputTokens <= sample.outputTokens
  );
}

function hasValidTimingInvariant(sample: RunSample): boolean {
  return (
    sample.firstVisibleTextMs !== null &&
    Number.isFinite(sample.firstVisibleTextMs) &&
    sample.firstVisibleTextMs >= 0 &&
    sample.lastVisibleTextMs !== null &&
    Number.isFinite(sample.lastVisibleTextMs) &&
    sample.lastVisibleTextMs >= sample.firstVisibleTextMs &&
    Number.isFinite(sample.totalLatencyMs) &&
    sample.totalLatencyMs > 0 &&
    sample.lastVisibleTextMs <= sample.totalLatencyMs
  );
}

function hasStorableMetrics(metrics: SampleMetrics): boolean {
  const values = [
    metrics.firstVisibleTextMs,
    metrics.visibleStreamTpsEstimate,
    metrics.visibleE2eTps,
    metrics.generatedE2eTps,
    metrics.totalLatencyMs,
  ];

  return (
    roundMetric(metrics.totalLatencyMs) > 0 &&
    values.every(
      (value) => value === null || (Number.isFinite(value) && Number.isFinite(roundMetric(value))),
    )
  );
}

/** Internal unrounded evaluation used by aggregation. */
export function evaluateSampleRaw(sample: RunSample, minVisibleTokens: number): SampleEvaluation {
  const visibleTokens = sample.outputTokens - sample.reasoningOutputTokens;

  if (sample.status !== "completed" || sample.errorCode !== null) {
    return invalidEvaluation(sample.errorCode ?? "turn_failed", visibleTokens);
  }

  if (sample.reroutedTo !== null) {
    return invalidEvaluation("rerouted", visibleTokens);
  }

  if (sample.toolEventCount !== 0) {
    return invalidEvaluation("tool_event", visibleTokens);
  }

  if (sample.agentMessageCount !== 1) {
    return invalidEvaluation("message_count", visibleTokens);
  }

  if (sample.firstVisibleTextMs === null || sample.lastVisibleTextMs === null) {
    return invalidEvaluation("missing_visible_timestamps", visibleTokens);
  }

  if (!hasValidTokenInvariant(sample)) {
    return invalidEvaluation("token_invariant", visibleTokens);
  }

  if (visibleTokens < minVisibleTokens) {
    return invalidEvaluation("too_short", visibleTokens);
  }

  if (!sample.validatorPassed) {
    return invalidEvaluation(
      sample.validatorReason === "ok" ? "validator_failed" : sample.validatorReason,
      visibleTokens,
    );
  }

  if (!hasValidTimingInvariant(sample)) {
    return invalidEvaluation("timing_invariant", visibleTokens);
  }

  const streamDurationMs = sample.lastVisibleTextMs - sample.firstVisibleTextMs;
  const metrics: SampleMetrics = {
    firstVisibleTextMs: sample.firstVisibleTextMs,
    visibleStreamTpsEstimate:
      visibleTokens < 2 || streamDurationMs === 0
        ? null
        : (visibleTokens - 1) / (streamDurationMs / 1_000),
    visibleE2eTps: visibleTokens / (sample.totalLatencyMs / 1_000),
    generatedE2eTps: sample.outputTokens / (sample.totalLatencyMs / 1_000),
    totalLatencyMs: sample.totalLatencyMs,
  };

  if (!hasStorableMetrics(metrics)) {
    return invalidEvaluation("timing_invariant", visibleTokens);
  }

  return {
    valid: true,
    invalidReason: null,
    visibleTokens,
    metrics,
  };
}

export function roundMetric(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundMetrics(metrics: SampleMetrics): SampleMetrics {
  return {
    firstVisibleTextMs: roundMetric(metrics.firstVisibleTextMs),
    visibleStreamTpsEstimate:
      metrics.visibleStreamTpsEstimate === null
        ? null
        : roundMetric(metrics.visibleStreamTpsEstimate),
    visibleE2eTps: roundMetric(metrics.visibleE2eTps),
    generatedE2eTps: roundMetric(metrics.generatedE2eTps),
    totalLatencyMs: roundMetric(metrics.totalLatencyMs),
  };
}

export function evaluateSample(sample: RunSample, minVisibleTokens: number): SampleEvaluation {
  const evaluation = evaluateSampleRaw(sample, minVisibleTokens);

  if (!evaluation.valid) {
    return evaluation;
  }

  return {
    ...evaluation,
    metrics: roundMetrics(evaluation.metrics),
  };
}
