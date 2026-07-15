import type { RunSample } from "@codexspeed/contracts";

const V1_MINIMUM_VISIBLE_TOKENS = 400;

const REASON_LABELS: Record<string, string> = {
  rerouted: "Rerouted",
  tool_event: "Tool event",
  message_count: "Message count",
  missing_visible_timestamps: "Missing visible timestamps",
  timing_invariant: "Timing invariant",
  token_invariant: "Token invariant",
  validator_failed: "Validator failed",
  too_short: "Too short",
  bad_structure: "Bad structure",
  missing_output: "Missing output",
  turn_failed: "Turn failed",
  protocol_error: "Protocol error",
  timeout: "Timeout",
  missing_token_usage: "Missing token usage",
};

export type PublishedSampleDescription = {
  valid: boolean | null;
  label: string;
};

function hasV1StorableTimings(sample: RunSample, visibleTokens: number): boolean {
  if (
    sample.firstVisibleTextMs === null ||
    sample.lastVisibleTextMs === null ||
    sample.firstVisibleTextMs < 0 ||
    sample.lastVisibleTextMs < sample.firstVisibleTextMs ||
    sample.totalLatencyMs <= 0 ||
    sample.lastVisibleTextMs > sample.totalLatencyMs
  ) {
    return false;
  }
  const duration = sample.lastVisibleTextMs - sample.firstVisibleTextMs;
  const metrics = [
    sample.firstVisibleTextMs,
    visibleTokens < 2 || duration === 0 ? null : (visibleTokens - 1) / (duration / 1_000),
    visibleTokens / (sample.totalLatencyMs / 1_000),
    sample.outputTokens / (sample.totalLatencyMs / 1_000),
    sample.totalLatencyMs,
  ];
  const roundedTotal = Math.round(sample.totalLatencyMs * 1_000_000) / 1_000_000;
  return roundedTotal > 0 && metrics.every((value) => value === null || (Number.isFinite(value) && Number.isFinite(Math.round(value * 1_000_000) / 1_000_000)));
}

function v1Reason(sample: RunSample): string | null {
  const visibleTokens = sample.outputTokens - sample.reasoningOutputTokens;
  if (sample.status !== "completed" || sample.errorCode !== null) return sample.errorCode ?? "turn_failed";
  if (sample.reroutedTo !== null) return "rerouted";
  if (sample.toolEventCount !== 0) return "tool_event";
  if (sample.agentMessageCount !== 1) return "message_count";
  if (sample.firstVisibleTextMs === null || sample.lastVisibleTextMs === null) return "missing_visible_timestamps";
  if (!Number.isSafeInteger(sample.outputTokens) || sample.outputTokens < 0 || !Number.isSafeInteger(sample.reasoningOutputTokens) || sample.reasoningOutputTokens < 0 || sample.reasoningOutputTokens > sample.outputTokens) return "token_invariant";
  if (visibleTokens < V1_MINIMUM_VISIBLE_TOKENS) return "too_short";
  if (!sample.validatorPassed) return sample.validatorReason === "ok" ? "validator_failed" : sample.validatorReason;
  if (!hasV1StorableTimings(sample, visibleTokens)) return "timing_invariant";
  return null;
}

export function describePublishedSample(
  suiteVersion: string,
  sample: RunSample,
): PublishedSampleDescription {
  if (suiteVersion !== "1.0.0") {
    return { valid: null, label: `Validity reason unavailable for suite ${suiteVersion}` };
  }
  const reason = v1Reason(sample);
  if (reason === null) {
    return { valid: true, label: "Valid" };
  }
  const reroute = reason === "rerouted" && sample.reroutedTo !== null ? ` → ${sample.reroutedTo}` : "";
  return { valid: false, label: `${REASON_LABELS[reason] ?? reason}${reroute}` };
}
