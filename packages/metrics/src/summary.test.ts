import { createRunFixture, type RunSample, type RunUpload } from "@codexspeed/contracts";
import { describe, expect, it } from "vitest";
import { summarizeRun } from "./index.js";

function createSample(sampleId: string, overrides: Partial<RunSample> = {}): RunSample {
  return {
    ...createRunFixture().samples[0]!,
    sampleId,
    ...overrides,
  };
}

describe("summarizeRun", () => {
  it("summarizes valid measured samples and counts every measured attempt", () => {
    const run = createRunFixture();

    expect(summarizeRun(run)).toEqual({
      runId: run.runId,
      coverage: {
        selectedCells: 1,
        measuredCells: 1,
        unmeasuredCells: 0,
        expectedMeasuredSamples: 1,
        recordedMeasuredSamples: 2,
      },
      reliability: {
        measuredSamples: 2,
        validSamples: 1,
        invalidSamples: 1,
      },
      cells: [
        {
          model: "gpt-5.3-codex",
          effort: "medium",
          coverage: {
            expectedMeasuredSamples: 1,
            recordedMeasuredSamples: 2,
          },
          reliability: {
            measuredSamples: 2,
            validSamples: 1,
            invalidSamples: 1,
          },
          metrics: {
            firstVisibleTextMs: { p50: 1_000, min: 1_000, max: 1_000, n: 1 },
            visibleStreamTpsEstimate: { p50: 49.9, min: 49.9, max: 49.9, n: 1 },
            visibleE2eTps: { p50: 40, min: 40, max: 40, n: 1 },
            generatedE2eTps: { p50: 48, min: 48, max: 48, n: 1 },
            totalLatencyMs: { p50: 12_500, min: 12_500, max: 12_500, n: 1 },
          },
        },
      ],
    });
  });

  it("uses selection order, exact model-effort groups, and selection coverage", () => {
    const run = createRunFixture();
    run.catalog.models[0]!.supportedEfforts = ["low", "medium", "high"];
    run.selection.cells = [
      { model: "gpt-5.3-codex", effort: "high" },
      { model: "gpt-5.3-codex", effort: "medium" },
      { model: "gpt-5.3-codex", effort: "low" },
    ];
    run.selection.measuredRounds = 2;
    run.samples = [
      createSample("01900000-0000-7000-8000-000000000010", {
        effort: "medium",
        firstVisibleTextMs: 2_000,
      }),
      createSample("01900000-0000-7000-8000-000000000011", {
        effort: "high",
        firstVisibleTextMs: 1_000,
      }),
      createSample("01900000-0000-7000-8000-000000000012", {
        effort: "medium",
        toolEventCount: 1,
      }),
    ];

    const summary = summarizeRun(run);

    expect(summary.coverage).toEqual({
      selectedCells: 3,
      measuredCells: 2,
      unmeasuredCells: 1,
      expectedMeasuredSamples: 6,
      recordedMeasuredSamples: 3,
    });
    expect(summary.reliability).toEqual({
      measuredSamples: 3,
      validSamples: 2,
      invalidSamples: 1,
    });
    expect(summary.cells.map(({ model, effort }) => `${model}\u0000${effort}`)).toEqual([
      "gpt-5.3-codex\u0000high",
      "gpt-5.3-codex\u0000medium",
      "gpt-5.3-codex\u0000low",
    ]);
    expect(summary.cells.map((cell) => cell.metrics.firstVisibleTextMs?.p50 ?? null)).toEqual([
      1_000,
      2_000,
      null,
    ]);
    expect(summary.cells.map((cell) => cell.reliability)).toEqual([
      { measuredSamples: 1, validSamples: 1, invalidSamples: 0 },
      { measuredSamples: 2, validSamples: 1, invalidSamples: 1 },
      { measuredSamples: 0, validSamples: 0, invalidSamples: 0 },
    ]);
  });

  it("computes even medians from raw values before rounding", () => {
    const run = createRunFixture();
    run.samples = [
      createSample("01900000-0000-7000-8000-000000000020", {
        firstVisibleTextMs: 0,
        lastVisibleTextMs: 0,
        totalLatencyMs: 1_000.0000005,
      }),
      createSample("01900000-0000-7000-8000-000000000021", {
        firstVisibleTextMs: 0,
        lastVisibleTextMs: 0,
        totalLatencyMs: 1_000.0000015,
      }),
    ];

    expect(summarizeRun(run).cells[0]!.metrics.totalLatencyMs).toEqual({
      p50: 1_000.000001,
      min: 1_000.000001,
      max: 1_000.000002,
      n: 2,
    });
  });

  it("never counts or aggregates warm-up samples", () => {
    const run: RunUpload = createRunFixture();
    run.samples.push(
      createSample("01900000-0000-7000-8000-000000000030", {
        phase: "warmup",
        firstVisibleTextMs: 1,
        lastVisibleTextMs: 2,
        totalLatencyMs: 3,
        outputTokens: 10_000,
        reasoningOutputTokens: 0,
      }),
    );

    const summary = summarizeRun(run);

    expect(summary.reliability).toEqual({
      measuredSamples: 2,
      validSamples: 1,
      invalidSamples: 1,
    });
    expect(summary.cells[0]!.metrics.firstVisibleTextMs).toEqual({
      p50: 1_000,
      min: 1_000,
      max: 1_000,
      n: 1,
    });
  });

  it("rejects measured samples outside the selected matrix", () => {
    const run = createRunFixture();
    run.samples = [
      createSample("01900000-0000-7000-8000-000000000040", {
        effort: "low",
      }),
    ];

    expect(() => summarizeRun(run)).toThrowError(
      "measured sample model-effort pair is outside run selection: gpt-5.3-codex\\0low",
    );
  });
});
