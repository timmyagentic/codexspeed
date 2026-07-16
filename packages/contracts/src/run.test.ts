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
    name: "a UTC timestamp with extra fractional digits",
    mutate: (run) => {
      run.startedAt = "2026-07-16T08:00:00.0000Z";
    },
  },
  {
    name: "a UTC timestamp without canonical millisecond precision",
    mutate: (run) => {
      run.startedAt = "2026-07-16T08:00:00Z";
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
  [
    "a JWT-shaped value",
    ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", "signature"].join("."),
  ],
  ["a private-key marker", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
  [
    "a credential assignment",
    ["OPENAI_API_KEY", "=", "example-secret"].join(""),
  ],
  ["a bare credential assignment", ["TOKEN", "=", "example-secret"].join("")],
  [
    "a compound credential assignment",
    ["AWS_SECRET_ACCESS_KEY", "=", "example-secret"].join(""),
  ],
  [
    "a camel-case access-token assignment",
    ["access", "Token", "=", "example-secret"].join(""),
  ],
  [
    "a camel-case API-key assignment",
    ["api", "Key", ":", "example-secret"].join(""),
  ],
  [
    "a camel-case auth-token assignment",
    ["auth", "Token", " = ", "example-secret"].join(""),
  ],
  [
    "a prefixed camel-case access-token assignment",
    ["openai", "Access", "Token", "=", "example-secret"].join(""),
  ],
  [
    "a refresh-token assignment",
    ["refresh", "Token", "=", "example-secret"].join(""),
  ],
  [
    "a session-token assignment",
    ["session", "Token", "=", "example-secret"].join(""),
  ],
  [
    "a prefixed camel-case API-key assignment",
    ["publisher", "Api", "Key", "=", "example-secret"].join(""),
  ],
  [
    "a prefixed camel-case secret assignment",
    ["worker", "Client", "Secret", "=", "example-secret"].join(""),
  ],
  [
    "a camel-case password assignment",
    ["database", "Password", "=", "example-secret"].join(""),
  ],
] as const;

const allowedAssignmentLikeStrings = [
  "accessTokenization=benchmark",
  "apiKeynote=release",
  "authTokenizer=enabled",
  "monkey=benchmark",
  "hockey=benchmark",
] as const;

const catalogEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

const seriesComparableEfforts = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

function createSeriesRunFixture(): RunUpload {
  const run = createRunFixture();
  Object.assign(run, { mode: "series" });
  Object.assign(run.selection, { series: "gpt-5.6" });
  run.catalog.models = ["sol", "terra", "luna"].map((suffix) => ({
    id: `gpt-5.6-${suffix}`,
    displayName: `GPT-5.6 ${suffix}`,
    hidden: false,
    defaultEffort: "medium" as const,
    supportedEfforts: [...seriesComparableEfforts, "ultra" as const],
  }));
  run.selection.cells = run.catalog.models.flatMap((model) =>
    seriesComparableEfforts.map((effort) => ({ model: model.id, effort })),
  );
  run.selection.warmupPerModel = 1;
  run.selection.measuredRounds = 3;
  run.selection.maxTurns = 48;
  run.samples = [];
  return run;
}

describe("RunUploadSchema", () => {
  it("accepts the canonical fixture and rejects unknown data", () => {
    expect(RunUploadSchema.parse(createRunFixture()).schemaVersion).toBe(1);
    expect(() =>
      RunUploadSchema.parse({ ...createRunFixture(), accessToken: "secret" }),
    ).toThrow();
  });

  it.each(["0.1.0", "1.0.0", "12.34.56-beta.1", "12.34.56+build.7"])(
    "accepts canonical semantic runner version %s",
    (runnerVersion) => {
      const run = createRunFixture();
      run.runnerVersion = runnerVersion;

      expect(RunUploadSchema.parse(run).runnerVersion).toBe(runnerVersion);
    },
  );

  it.each([
    "v0.1.0",
    "01.2.3",
    "1.02.3",
    "1.2",
    "1.2.3.4",
    "1.2.3-01",
    "latest",
  ])("rejects non-canonical runner version %s", (runnerVersion) => {
    const run = createRunFixture();
    run.runnerVersion = runnerVersion;

    expect(() => RunUploadSchema.parse(run)).toThrow();
  });

  it("contains one valid-looking and one deliberately invalid measured sample", () => {
    const fixture = createRunFixture();

    expect(fixture.samples).toHaveLength(2);
    expect(fixture.samples.map((sample) => sample.phase)).toEqual([
      "measured",
      "measured",
    ]);
    expect(fixture.samples[0]).toMatchObject({
      outputTokens: 600,
      reasoningOutputTokens: 100,
      toolEventCount: 0,
      validatorPassed: true,
    });
    expect(fixture.samples[1]).toMatchObject({ toolEventCount: 1 });
  });

  it("accepts a complete standard series run and keeps legacy smoke runs valid", () => {
    const seriesRun = createSeriesRunFixture();
    const legacyFullRun = createRunFixture();
    legacyFullRun.mode = "full";

    expect(RunUploadSchema.parse(seriesRun)).toMatchObject({
      mode: "series",
      selection: {
        series: "gpt-5.6",
        warmupPerModel: 1,
        measuredRounds: 3,
        cells: expect.arrayContaining([
          { model: "gpt-5.6-sol", effort: "low" },
          { model: "gpt-5.6-terra", effort: "max" },
          { model: "gpt-5.6-luna", effort: "xhigh" },
        ]),
      },
    });
    expect(RunUploadSchema.parse(createRunFixture()).mode).toBe("smoke");
    expect(RunUploadSchema.parse(legacyFullRun).mode).toBe("full");
  });

  it("includes an exact model ID match in a complete series matrix", () => {
    const run = createSeriesRunFixture();
    run.catalog.models.push({
      id: "gpt-5.6",
      displayName: "GPT-5.6",
      hidden: false,
      defaultEffort: "medium",
      supportedEfforts: [...seriesComparableEfforts],
    });
    run.selection.cells.push(
      ...seriesComparableEfforts.map((effort) => ({
        model: "gpt-5.6",
        effort,
      })),
    );

    expect(RunUploadSchema.parse(run).selection.cells).toHaveLength(20);
  });

  it("rejects a series with no visible comparable catalog cells", () => {
    const run = createSeriesRunFixture();
    run.catalog.models.forEach((model) => {
      model.hidden = true;
    });

    const result = RunUploadSchema.safeParse(run);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected series validation to fail");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "series must resolve to at least one comparable catalog cell",
        }),
      ]),
    );
  });

  it.each([
    {
      name: "series mode without a series identifier",
      mutate: (run: RunUpload) => {
        Object.assign(run, { mode: "series" });
        delete (run.selection as typeof run.selection & { series?: string })
          .series;
      },
    },
    {
      name: "a series identifier on smoke mode",
      mutate: (run: RunUpload) => {
        Object.assign(run, { mode: "smoke" });
      },
    },
    {
      name: "a series identifier on full mode",
      mutate: (run: RunUpload) => {
        Object.assign(run, { mode: "full" });
      },
    },
    {
      name: "a non-standard series warm-up count",
      mutate: (run: RunUpload) => {
        run.selection.warmupPerModel = 0;
      },
    },
    {
      name: "a non-standard series measured-round count",
      mutate: (run: RunUpload) => {
        run.selection.measuredRounds = 2;
      },
    },
    {
      name: "an omitted comparable effort",
      mutate: (run: RunUpload) => {
        run.selection.cells = run.selection.cells.filter(
          (cell) => !(cell.model === "gpt-5.6-sol" && cell.effort === "max"),
        );
      },
    },
    {
      name: "an omitted visible series model",
      mutate: (run: RunUpload) => {
        run.selection.cells = run.selection.cells.filter(
          (cell) => cell.model !== "gpt-5.6-luna",
        );
      },
    },
    {
      name: "a model outside the hyphen-bounded series prefix",
      mutate: (run: RunUpload) => {
        run.catalog.models.push({
          id: "gpt-5.60-orbit",
          displayName: "GPT-5.60 Orbit",
          hidden: false,
          defaultEffort: "medium",
          supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
        });
        run.selection.cells.push({ model: "gpt-5.60-orbit", effort: "low" });
      },
    },
    {
      name: "a hidden series model",
      mutate: (run: RunUpload) => {
        run.catalog.models.push({
          id: "gpt-5.6-hidden",
          displayName: "GPT-5.6 Hidden",
          hidden: true,
          defaultEffort: "medium",
          supportedEfforts: ["medium"],
        });
        run.selection.cells.push({ model: "gpt-5.6-hidden", effort: "medium" });
      },
    },
    {
      name: "Ultra in a series matrix",
      mutate: (run: RunUpload) => {
        Object.assign(run.selection.cells[0]!, { effort: "ultra" });
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const run = createSeriesRunFixture();
    mutate(run);

    expect(() => RunUploadSchema.parse(run)).toThrow();
  });

  it("accepts ultra as an exact catalog-supported effort", () => {
    const run = createRunFixture();
    run.catalog.models[0]!.defaultEffort = "ultra";
    run.catalog.models[0]!.supportedEfforts = [...catalogEfforts];

    expect(RunUploadSchema.parse(run).catalog.models[0]).toMatchObject({
      defaultEffort: "ultra",
      supportedEfforts: catalogEfforts,
    });
  });

  it("rejects ultra in the selected comparable matrix", () => {
    const run = createRunFixture();
    Object.assign(run.selection.cells[0]!, { effort: "ultra" });

    expect(() => RunUploadSchema.parse(run)).toThrow();
  });

  it("rejects ultra in a recorded sample", () => {
    const run = createRunFixture();
    Object.assign(run.samples[0]!, { effort: "ultra" });

    expect(() => RunUploadSchema.parse(run)).toThrow();
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

  for (const value of allowedAssignmentLikeStrings) {
    it(`accepts a non-credential assignment-like string: ${value}`, () => {
      const run = createRunFixture();
      run.catalog.models[0]!.displayName = value;

      expect(RunUploadSchema.parse(run).catalog.models[0]!.displayName).toBe(
        value,
      );
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
    supportedEfforts.catalog.models[0]!.supportedEfforts = Array.from(
      { length: 9 },
      () => "medium",
    );

    const selection = createRunFixture();
    const efforts = [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] as const;
    selection.catalog.models = Array.from({ length: 29 }, (_, index) => ({
      ...model,
      id: `model-${index}`,
      defaultEffort: "medium" as const,
      supportedEfforts: [...efforts],
    }));
    selection.selection.cells = selection.catalog.models
      .flatMap((catalogModel) =>
        efforts.map((effort) => ({ model: catalogModel.id, effort })),
      )
      .slice(0, 201);

    expect(() => RunUploadSchema.parse(catalog)).toThrow();
    expect(() => RunUploadSchema.parse(supportedEfforts)).toThrow();
    expect(() => RunUploadSchema.parse(selection)).toThrow();
  });
});
