import { describe, expect, it } from "vitest";
import {
  createRunFixture,
  LatestRunResponseSchema,
  PublicRunResponseSchema,
  RunListMetadataSchema,
  RunListResponseSchema,
  type PublicRunResponse,
  type RunListMetadata,
} from "./index.js";

function createPublicRunResponse(): PublicRunResponse {
  const run = createRunFixture();

  return {
    run,
    summary: {
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
    },
    publication: {
      payloadSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      publishedAt: "2026-07-16T08:02:00.000Z",
    },
  };
}

function createRunListMetadata(): RunListMetadata {
  const { publication, run, summary } = createPublicRunResponse();

  return {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    suiteVersion: run.suiteVersion,
    protocolVersion: run.protocolVersion,
    runnerVersion: run.runnerVersion,
    codexCliVersion: run.codexCliVersion,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    mode: run.mode,
    status: run.status,
    publication,
    summary: {
      coverage: summary.coverage,
      reliability: summary.reliability,
    },
  };
}

describe("PublicRunResponseSchema", () => {
  it("parses the exact public run response", () => {
    const response = createPublicRunResponse();

    expect(PublicRunResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects unknown properties at every public summary boundary", () => {
    const mutations: Array<(response: PublicRunResponse) => void> = [
      (response) => Object.assign(response, { generation: 1 }),
      (response) => Object.assign(response.publication, { source: "runner" }),
      (response) => Object.assign(response.summary, { score: 100 }),
      (response) => Object.assign(response.summary.coverage, { total: 2 }),
      (response) => Object.assign(response.summary.reliability, { ratio: 0.5 }),
      (response) => Object.assign(response.summary.cells[0]!, { rank: 1 }),
      (response) => Object.assign(response.summary.cells[0]!.coverage, { missing: 0 }),
      (response) => Object.assign(response.summary.cells[0]!.metrics, { average: 50 }),
      (response) =>
        Object.assign(response.summary.cells[0]!.metrics.totalLatencyMs!, { mean: 12_500 }),
    ];

    for (const mutate of mutations) {
      const response = createPublicRunResponse();
      mutate(response);
      expect(() => PublicRunResponseSchema.parse(response)).toThrow();
    }
  });

  it("rejects non-finite metrics and invalid summary counts", () => {
    const invalidValues = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53] as const;

    for (const value of invalidValues) {
      const response = createPublicRunResponse();
      response.summary.coverage.selectedCells = value;
      expect(() => PublicRunResponseSchema.parse(response)).toThrow();
    }

    const nonFiniteMetric = createPublicRunResponse();
    nonFiniteMetric.summary.cells[0]!.metrics.generatedE2eTps!.p50 = Number.NaN;
    expect(() => PublicRunResponseSchema.parse(nonFiniteMetric)).toThrow();

    const negativeMetric = createPublicRunResponse();
    negativeMetric.summary.cells[0]!.metrics.firstVisibleTextMs!.min = -1;
    expect(() => PublicRunResponseSchema.parse(negativeMetric)).toThrow();

    const emptyDistribution = createPublicRunResponse();
    emptyDistribution.summary.cells[0]!.metrics.totalLatencyMs!.n = 0;
    expect(() => PublicRunResponseSchema.parse(emptyDistribution)).toThrow();
  });
});

describe("LatestRunResponseSchema", () => {
  it("adds a finite non-negative integer generation", () => {
    const response = { ...createPublicRunResponse(), generation: 7 };

    expect(LatestRunResponseSchema.parse(response)).toEqual(response);
  });

  for (const generation of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 2 ** 53]) {
    it(`rejects generation ${String(generation)}`, () => {
      expect(() =>
        LatestRunResponseSchema.parse({ ...createPublicRunResponse(), generation }),
      ).toThrow();
    });
  }
});

describe("RunListMetadataSchema", () => {
  it("parses the exact list metadata projection", () => {
    const metadata = createRunListMetadata();

    expect(RunListMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  it("rejects unknown data, malformed hashes, and non-canonical timestamps", () => {
    const unknown = createRunListMetadata();
    Object.assign(unknown, { seed: 42 });
    expect(() => RunListMetadataSchema.parse(unknown)).toThrow();

    const badHash = createRunListMetadata();
    badHash.publication.payloadSha256 = "ABCDEF".repeat(10) + "ABCD";
    expect(() => RunListMetadataSchema.parse(badHash)).toThrow();

    const badPublishedAt = createRunListMetadata();
    badPublishedAt.publication.publishedAt = "2026-07-16T08:02:00Z";
    expect(() => RunListMetadataSchema.parse(badPublishedAt)).toThrow();

    const badStartedAt = createRunListMetadata();
    badStartedAt.startedAt = "2026-02-30T08:00:00.000Z";
    expect(() => RunListMetadataSchema.parse(badStartedAt)).toThrow();
  });
});

describe("RunListResponseSchema", () => {
  it("accepts a bounded cursor or null", () => {
    const metadata = createRunListMetadata();

    expect(RunListResponseSchema.parse({ data: [metadata], nextCursor: "WyJjdXJzb3IiXQ" })).toEqual(
      { data: [metadata], nextCursor: "WyJjdXJzb3IiXQ" },
    );
    expect(RunListResponseSchema.parse({ data: [], nextCursor: null })).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it("rejects missing, empty, malformed, oversized, and unknown cursor data", () => {
    const invalidResponses = [
      { data: [] },
      { data: [], nextCursor: "" },
      { data: [], nextCursor: "not+base64url" },
      { data: [], nextCursor: "a".repeat(513) },
      { data: [], nextCursor: null, extra: true },
    ];

    for (const response of invalidResponses) {
      expect(() => RunListResponseSchema.parse(response)).toThrow();
    }
  });

  it("rejects more than one maximum API page", () => {
    const metadata = createRunListMetadata();

    expect(() =>
      RunListResponseSchema.parse({ data: Array.from({ length: 51 }, () => metadata), nextCursor: null }),
    ).toThrow();
  });
});
