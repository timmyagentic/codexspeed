import { createRunFixture, type RunSample } from "@codexspeed/contracts";
import { describe, expect, it } from "vitest";
import { evaluateSample } from "./index.js";

function createSample(): RunSample {
  return { ...createRunFixture().samples[0]! };
}

describe("evaluateSample", () => {
  it("calculates the canonical visible and generated token metrics", () => {
    const result = evaluateSample(createSample(), 400);

    expect(result).toMatchObject({
      valid: true,
      invalidReason: null,
      visibleTokens: 500,
      metrics: {
        firstVisibleTextMs: 1_000,
        visibleStreamTpsEstimate: 49.9,
        visibleE2eTps: 40,
        generatedE2eTps: 48,
        totalLatencyMs: 12_500,
      },
    });
  });

  it("rounds stored metrics to six decimal places", () => {
    const sample = createSample();
    Object.assign(sample, {
      firstVisibleTextMs: 1_000.1234567,
      lastVisibleTextMs: 3_300.1234567,
      totalLatencyMs: 7_000,
      outputTokens: 11,
      reasoningOutputTokens: 1,
    });

    expect(evaluateSample(sample, 0)).toMatchObject({
      valid: true,
      metrics: {
        firstVisibleTextMs: 1_000.123457,
        visibleStreamTpsEstimate: 3.913043,
        visibleE2eTps: 1.428571,
        generatedE2eTps: 1.571429,
        totalLatencyMs: 7_000,
      },
    });
  });

  it.each([
    { visibleTokens: 1, firstVisibleTextMs: 1_000, lastVisibleTextMs: 2_000 },
    { visibleTokens: 2, firstVisibleTextMs: 1_000, lastVisibleTextMs: 1_000 },
  ])(
    "makes the stream estimate unavailable for $visibleTokens tokens from $firstVisibleTextMs to $lastVisibleTextMs",
    ({ visibleTokens, firstVisibleTextMs, lastVisibleTextMs }) => {
      const sample = createSample();
      Object.assign(sample, {
        firstVisibleTextMs,
        lastVisibleTextMs,
        outputTokens: visibleTokens,
        reasoningOutputTokens: 0,
      });

      expect(evaluateSample(sample, 0)).toMatchObject({
        valid: true,
        visibleTokens,
        metrics: { visibleStreamTpsEstimate: null },
      });
    },
  );

  it("uses stable invalid-reason precedence", () => {
    const sample = createSample();
    Object.assign(sample, {
      status: "failed",
      errorCode: "timeout",
      reroutedTo: "fallback-model",
      toolEventCount: 1,
      agentMessageCount: 2,
      firstVisibleTextMs: null,
      lastVisibleTextMs: null,
      outputTokens: 99,
      reasoningOutputTokens: 100,
      validatorPassed: false,
      validatorReason: "bad_structure",
    });

    expect(evaluateSample(sample, 400).invalidReason).toBe("timeout");

    Object.assign(sample, { status: "completed", errorCode: null });
    expect(evaluateSample(sample, 400).invalidReason).toBe("rerouted");

    sample.reroutedTo = null;
    expect(evaluateSample(sample, 400).invalidReason).toBe("tool_event");

    sample.toolEventCount = 0;
    expect(evaluateSample(sample, 400).invalidReason).toBe("message_count");

    sample.agentMessageCount = 1;
    expect(evaluateSample(sample, 400).invalidReason).toBe("missing_visible_timestamps");

    Object.assign(sample, { firstVisibleTextMs: 1_000, lastVisibleTextMs: 11_000 });
    expect(evaluateSample(sample, 400).invalidReason).toBe("token_invariant");

    Object.assign(sample, { outputTokens: 499, reasoningOutputTokens: 100 });
    expect(evaluateSample(sample, 400).invalidReason).toBe("too_short");

    sample.outputTokens = 600;
    expect(evaluateSample(sample, 400).invalidReason).toBe("bad_structure");
  });

  it("uses a stable fallback when a failed turn or validator has no specific reason", () => {
    const failed = createSample();
    Object.assign(failed, { status: "failed", errorCode: null });

    const validator = createSample();
    Object.assign(validator, { validatorPassed: false, validatorReason: "ok" });

    expect(evaluateSample(failed, 400).invalidReason).toBe("turn_failed");
    expect(evaluateSample(validator, 400).invalidReason).toBe("validator_failed");
  });

  it("rejects zero total latency instead of emitting non-finite rates", () => {
    const sample = createSample();
    Object.assign(sample, {
      firstVisibleTextMs: 0,
      lastVisibleTextMs: 0,
      totalLatencyMs: 0,
    });

    expect(evaluateSample(sample, 400)).toMatchObject({
      valid: false,
      invalidReason: "timing_invariant",
      metrics: null,
    });
  });

  it.each([
    {
      name: "subnormal latency",
      firstVisibleTextMs: 0,
      lastVisibleTextMs: Number.MIN_VALUE,
      totalLatencyMs: Number.MIN_VALUE,
    },
    {
      name: "timing that overflows six-decimal rounding",
      firstVisibleTextMs: 0,
      lastVisibleTextMs: 1,
      totalLatencyMs: Number.MAX_VALUE,
    },
  ])("rejects $name instead of emitting non-finite stored metrics", ({ name: _name, ...timings }) => {
    const sample = createSample();
    Object.assign(sample, timings);

    expect(evaluateSample(sample, 400)).toMatchObject({
      valid: false,
      invalidReason: "timing_invariant",
      metrics: null,
    });
  });
});
