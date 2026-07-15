import { describe, expect, it } from "vitest";
import { createRunFixture, RunUploadSchema, type RunUpload } from "./index.js";

type InvalidRunCase = {
  name: string;
  mutate: (run: RunUpload) => void;
};

const invalidRunCases: InvalidRunCase[] = [
  {
    name: "a non-UUID run ID",
    mutate: (run) => {
      run.runId = "not-a-uuid";
    },
  },
  {
    name: "a UUID that is not version 7",
    mutate: (run) => {
      run.runId = "550e8400-e29b-41d4-a716-446655440000";
    },
  },
  {
    name: "an invalid sample UUID",
    mutate: (run) => {
      run.samples[0]!.sampleId = "not-a-uuid";
    },
  },
  {
    name: "an end date before the start date",
    mutate: (run) => {
      run.endedAt = "2026-07-16T07:59:59.999Z";
    },
  },
  {
    name: "a first visible timing after the last visible timing",
    mutate: (run) => {
      run.samples[0]!.firstVisibleTextMs = 11_001;
    },
  },
  {
    name: "a last visible timing after total latency",
    mutate: (run) => {
      run.samples[0]!.lastVisibleTextMs = 12_501;
    },
  },
  {
    name: "reasoning output tokens above total output tokens",
    mutate: (run) => {
      run.samples[0]!.reasoningOutputTokens = 601;
    },
  },
  {
    name: "a sample model absent from the catalog",
    mutate: (run) => {
      run.samples[0]!.model = "unknown-model";
    },
  },
  {
    name: "a selected model absent from the catalog",
    mutate: (run) => {
      run.selection.cells[0]!.model = "unknown-model";
    },
  },
  {
    name: "a selected effort unsupported by its catalog model",
    mutate: (run) => {
      run.selection.cells[0]!.effort = "xhigh";
    },
  },
  {
    name: "more than 200 samples",
    mutate: (run) => {
      const sample = run.samples[0]!;
      run.samples = Array.from({ length: 201 }, (_, index) => ({
        ...sample,
        sampleId: `01900000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`,
      }));
    },
  },
  {
    name: "a non-finite run number",
    mutate: (run) => {
      run.seed = Number.NaN;
    },
  },
  {
    name: "a non-finite sample number",
    mutate: (run) => {
      run.samples[0]!.totalLatencyMs = Number.POSITIVE_INFINITY;
    },
  },
];

const prohibitedStrings = [
  ["an API-key-shaped value", ["s", "k-", "demo"].join("")],
  ["a bearer credential", ["Bear", "er ", "example-token"].join("")],
  ["a JWT-shaped value", ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", "signature"].join(".")],
  ["a private-key marker", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
  ["a credential assignment", ["OPENAI_API_KEY", "=", "example-secret"].join("")],
  ["a bare credential assignment", ["TOKEN", "=", "example-secret"].join("")],
  ["a compound credential assignment", ["AWS_SECRET_ACCESS_KEY", "=", "example-secret"].join("")],
] as const;

describe("RunUploadSchema", () => {
  it("accepts the canonical fixture and rejects unknown data", () => {
    expect(RunUploadSchema.parse(createRunFixture()).schemaVersion).toBe(1);
    expect(() => RunUploadSchema.parse({ ...createRunFixture(), accessToken: "secret" })).toThrow();
  });

  it("contains one valid-looking and one deliberately invalid measured sample", () => {
    const fixture = createRunFixture();

    expect(fixture.samples).toHaveLength(2);
    expect(fixture.samples.map((sample) => sample.phase)).toEqual(["measured", "measured"]);
    expect(fixture.samples[0]).toMatchObject({
      outputTokens: 600,
      reasoningOutputTokens: 100,
      toolEventCount: 0,
      validatorPassed: true,
    });
    expect(fixture.samples[1]).toMatchObject({ toolEventCount: 1 });
  });

  for (const { name, mutate } of invalidRunCases) {
    it(`rejects ${name}`, () => {
      const run = createRunFixture();
      mutate(run);

      expect(() => RunUploadSchema.parse(run)).toThrow();
    });
  }

  for (const [name, value] of prohibitedStrings) {
    it(`rejects ${name} anywhere in the document`, () => {
      const run = createRunFixture();
      run.catalog.models[0]!.displayName = value;

      expect(() => RunUploadSchema.parse(run)).toThrow();
    });
  }

  it("rejects unknown properties in every nested object boundary", () => {
    const mutations: Array<(run: RunUpload) => void> = [
      (run) => Object.assign(run.prompt, { text: "not public" }),
      (run) => Object.assign(run.environment, { hostname: "private" }),
      (run) => Object.assign(run.catalog, { rawResponse: {} }),
      (run) => Object.assign(run.catalog.models[0]!, { rawModel: {} }),
      (run) => Object.assign(run.selection, { flags: {} }),
      (run) => Object.assign(run.selection.cells[0]!, { serviceTier: "fast" }),
      (run) => Object.assign(run.samples[0]!, { exceptionText: "private" }),
    ];

    for (const mutate of mutations) {
      const run = createRunFixture();
      mutate(run);
      expect(() => RunUploadSchema.parse(run)).toThrow();
    }
  });

  it("bounds every array in the contract", () => {
    const catalog = createRunFixture();
    const model = catalog.catalog.models[0]!;
    catalog.catalog.models = Array.from({ length: 101 }, (_, index) => ({
      ...model,
      id: `model-${index}`,
    }));

    const supportedEfforts = createRunFixture();
    supportedEfforts.catalog.models[0]!.supportedEfforts = Array.from({ length: 8 }, () => "medium");

    const selection = createRunFixture();
    const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
    selection.catalog.models = Array.from({ length: 29 }, (_, index) => ({
      ...model,
      id: `model-${index}`,
      defaultEffort: "medium" as const,
      supportedEfforts: [...efforts],
    }));
    selection.selection.cells = selection.catalog.models
      .flatMap((catalogModel) => efforts.map((effort) => ({ model: catalogModel.id, effort })))
      .slice(0, 201);

    expect(() => RunUploadSchema.parse(catalog)).toThrow();
    expect(() => RunUploadSchema.parse(supportedEfforts)).toThrow();
    expect(() => RunUploadSchema.parse(selection)).toThrow();
  });
});
