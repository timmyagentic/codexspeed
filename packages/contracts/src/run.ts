import { z } from "zod";

const MAX_MODELS = 100;
const MAX_SELECTION_CELLS = 200;
const MAX_SAMPLES = 200;

const ComparableEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const CatalogEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/i);
export const RunSeriesIdSchema = ModelIdSchema;
export function modelMatchesSeries(modelId: string, series: string): boolean {
  return modelId === series || modelId.startsWith(`${series}-`);
}
const UtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime({ offset: false, precision: 3 });
const UuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
export const CanonicalSemverSchema = z.string().max(64).regex(SEMVER_PATTERN);
const NonNegativeIntegerSchema = z.number().finite().int().nonnegative().safe();
const PositiveIntegerSchema = z.number().finite().int().positive().safe();
const RelativeTimingSchema = z.number().finite().nonnegative();

const PromptSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    sha256: Sha256Schema,
  })
  .strict();

const EnvironmentSchema = z
  .object({
    osFamily: z.enum(["macos", "linux", "windows"]),
    osVersion: z.string().trim().min(1).max(64),
    architecture: z.enum(["arm64", "x64"]),
    region: z.string().trim().min(1).max(64),
    authChannel: z.literal("chatgpt"),
    serviceTier: z.literal("default"),
  })
  .strict();

const CatalogModelSchema = z
  .object({
    id: ModelIdSchema,
    displayName: z.string().trim().min(1).max(200),
    hidden: z.boolean(),
    defaultEffort: CatalogEffortSchema,
    supportedEfforts: z.array(CatalogEffortSchema).min(1).max(8),
  })
  .strict()
  .superRefine((model, context) => {
    if (!model.supportedEfforts.includes(model.defaultEffort)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultEffort must be supported by the model",
        path: ["defaultEffort"],
      });
    }

    if (
      new Set(model.supportedEfforts).size !== model.supportedEfforts.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supportedEfforts must not contain duplicates",
        path: ["supportedEfforts"],
      });
    }
  });

const CatalogSchema = z
  .object({
    models: z.array(CatalogModelSchema).min(1).max(MAX_MODELS),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = catalog.models.map((model) => model.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "catalog model IDs must be unique",
        path: ["models"],
      });
    }
  });

const SelectionCellSchema = z
  .object({
    model: ModelIdSchema,
    effort: ComparableEffortSchema,
  })
  .strict();

const SelectionSchema = z
  .object({
    cells: z.array(SelectionCellSchema).min(1).max(MAX_SELECTION_CELLS),
    warmupPerModel: z.number().finite().int().nonnegative().max(10),
    measuredRounds: z.number().finite().int().positive().max(100),
    maxTurns: z.number().finite().int().positive().max(MAX_SAMPLES),
    series: RunSeriesIdSchema.optional(),
  })
  .strict()
  .superRefine((selection, context) => {
    const keys = selection.cells.map(
      (cell) => `${cell.model}\u0000${cell.effort}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selected model and effort pairs must be unique",
        path: ["cells"],
      });
    }
  });

export const RunSampleSchema = z
  .object({
    sampleId: UuidV7Schema,
    model: ModelIdSchema,
    effort: ComparableEffortSchema,
    phase: z.enum(["warmup", "measured"]),
    round: NonNegativeIntegerSchema,
    attempt: PositiveIntegerSchema,
    status: z.enum(["completed", "failed"]),
    firstVisibleTextMs: RelativeTimingSchema.nullable(),
    lastVisibleTextMs: RelativeTimingSchema.nullable(),
    totalLatencyMs: RelativeTimingSchema,
    outputTokens: NonNegativeIntegerSchema,
    reasoningOutputTokens: NonNegativeIntegerSchema,
    agentMessageCount: NonNegativeIntegerSchema,
    toolEventCount: NonNegativeIntegerSchema,
    reroutedTo: ModelIdSchema.nullable(),
    validatorPassed: z.boolean(),
    validatorReason: z.enum([
      "ok",
      "too_short",
      "bad_structure",
      "missing_output",
    ]),
    errorCode: z
      .enum(["turn_failed", "protocol_error", "timeout", "missing_token_usage"])
      .nullable(),
  })
  .strict()
  .superRefine((sample, context) => {
    const hasFirstTiming = sample.firstVisibleTextMs !== null;
    const hasLastTiming = sample.lastVisibleTextMs !== null;

    if (hasFirstTiming !== hasLastTiming) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "visible text timings must either both be present or both be null",
        path: [hasFirstTiming ? "lastVisibleTextMs" : "firstVisibleTextMs"],
      });
    }

    if (
      sample.firstVisibleTextMs !== null &&
      sample.lastVisibleTextMs !== null &&
      sample.firstVisibleTextMs > sample.lastVisibleTextMs
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "firstVisibleTextMs must not exceed lastVisibleTextMs",
        path: ["firstVisibleTextMs"],
      });
    }

    if (
      sample.lastVisibleTextMs !== null &&
      sample.lastVisibleTextMs > sample.totalLatencyMs
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "lastVisibleTextMs must not exceed totalLatencyMs",
        path: ["lastVisibleTextMs"],
      });
    }

    if (sample.reasoningOutputTokens > sample.outputTokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reasoningOutputTokens must not exceed outputTokens",
        path: ["reasoningOutputTokens"],
      });
    }
  });

const RunUploadObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: UuidV7Schema,
    suiteVersion: z.string().trim().min(1).max(64),
    protocolVersion: z.string().trim().min(1).max(64),
    runnerVersion: CanonicalSemverSchema,
    codexCliVersion: z.string().trim().min(1).max(64),
    startedAt: UtcTimestampSchema,
    endedAt: UtcTimestampSchema,
    mode: z.enum(["full", "smoke", "series"]),
    seed: NonNegativeIntegerSchema,
    status: z.enum(["completed", "partial", "failed"]),
    prompt: PromptSchema,
    environment: EnvironmentSchema,
    catalog: CatalogSchema,
    selection: SelectionSchema,
    samples: z.array(RunSampleSchema).max(MAX_SAMPLES),
  })
  .strict();

type Path = Array<string | number>;

const prohibitedStringPatterns = [
  /(?:^|[^a-z0-9])sk-[a-z0-9_-]+/i,
  /\bbearer\s+[a-z0-9._~+/-]+/i,
  /\beyJ[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+\b/i,
  new RegExp(
    ["-----BEGIN ", "(?:[A-Z0-9]+ )?", "PRIVATE KEY-----"].join(""),
    "i",
  ),
  /(?:^|[\s;,{])(?:[a-z0-9]+[_-])*(?:api[_-]?key|key|token|secret|password)\s*[:=]\s*\S+/i,
  /(?:^|[\s;,{])(?:accessToken|authToken|apiKey|clientSecret|privateKey)\s*[:=]\s*\S+/i,
  /(?:^|[^A-Za-z0-9])[a-z][A-Za-z0-9]*(?:Token|Key|Secret|Password)\s*[:=]\s*\S+/,
];

function visitStrings(
  value: unknown,
  path: Path,
  visit: (text: string, path: Path) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitStrings(item, [...path, index], visit));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visitStrings(item, [...path, key], visit);
    }
  }
}

export const RunUploadSchema = RunUploadObjectSchema.superRefine(
  (run, context) => {
    if (Date.parse(run.startedAt) > Date.parse(run.endedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startedAt must not be later than endedAt",
        path: ["endedAt"],
      });
    }

    const catalogById = new Map(
      run.catalog.models.map((model) => [model.id, model]),
    );

    const series = run.selection.series;
    if ((run.mode === "series") !== (series !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "series mode and selection.series must be present together",
        path: series === undefined ? ["selection", "series"] : ["mode"],
      });
    }

    if (series !== undefined) {
      if (run.selection.warmupPerModel !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "series runs require one warm-up per model",
          path: ["selection", "warmupPerModel"],
        });
      }
      if (run.selection.measuredRounds !== 3) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "series runs require three measured rounds",
          path: ["selection", "measuredRounds"],
        });
      }

      const comparableEfforts = new Set<string>(ComparableEffortSchema.options);
      const seriesModels = run.catalog.models
        .filter(
          (model) => !model.hidden && modelMatchesSeries(model.id, series),
        )
        .map((model) => ({
          model,
          efforts: model.supportedEfforts.filter((effort) =>
            comparableEfforts.has(effort),
          ),
        }))
        .filter(({ efforts }) => efforts.length > 0);
      const expectedCellKeys = new Set(
        seriesModels.flatMap(({ model, efforts }) =>
          efforts.map((effort) => `${model.id}\u0000${effort}`),
        ),
      );
      const selectedCellKeys = new Set(
        run.selection.cells.map((cell) => `${cell.model}\u0000${cell.effort}`),
      );

      if (expectedCellKeys.size === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "series must resolve to at least one comparable catalog cell",
          path: ["selection", "series"],
        });
      }
      for (const expectedCellKey of expectedCellKeys) {
        if (!selectedCellKeys.has(expectedCellKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "series selection must include every comparable catalog cell",
            path: ["selection", "cells"],
          });
          break;
        }
      }
      run.selection.cells.forEach((cell, index) => {
        const key = `${cell.model}\u0000${cell.effort}`;
        if (!expectedCellKeys.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "series selection must contain only comparable series cells",
            path: ["selection", "cells", index],
          });
        }
      });

      const expectedSampleKeys = new Set<string>();
      for (const { model, efforts } of seriesModels) {
        const warmupEffort = comparableEfforts.has(model.defaultEffort)
          ? model.defaultEffort
          : efforts[0]!;
        expectedSampleKeys.add(
          `warmup\u0000${model.id}\u0000${warmupEffort}\u00000`,
        );
        for (const effort of efforts) {
          for (let round = 1; round <= 3; round += 1) {
            expectedSampleKeys.add(
              `measured\u0000${model.id}\u0000${effort}\u0000${round}`,
            );
          }
        }
      }

      if (run.selection.maxTurns < expectedSampleKeys.size) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "series maxTurns must cover the standard schedule",
          path: ["selection", "maxTurns"],
        });
      }

      const recordedSampleKeys = new Set<string>();
      run.samples.forEach((sample, index) => {
        const key = `${sample.phase}\u0000${sample.model}\u0000${sample.effort}\u0000${sample.round}`;
        if (sample.attempt !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "series samples must use attempt one",
            path: ["samples", index, "attempt"],
          });
        }
        if (!expectedSampleKeys.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "series sample does not belong to the standard schedule",
            path: ["samples", index],
          });
        }
        if (recordedSampleKeys.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "series samples must not repeat a planned schedule slot",
            path: ["samples", index],
          });
        }
        recordedSampleKeys.add(key);
      });

      if (
        run.status === "completed" &&
        (recordedSampleKeys.size !== expectedSampleKeys.size ||
          [...expectedSampleKeys].some((key) => !recordedSampleKeys.has(key)))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "completed series runs must contain every planned sample",
          path: ["samples"],
        });
      }
    }

    run.selection.cells.forEach((cell, index) => {
      const model = catalogById.get(cell.model);
      if (model === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "selected model must exist in the catalog",
          path: ["selection", "cells", index, "model"],
        });
      } else if (!model.supportedEfforts.includes(cell.effort)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "selected effort must be supported by the catalog model",
          path: ["selection", "cells", index, "effort"],
        });
      }
    });

    run.samples.forEach((sample, index) => {
      const model = catalogById.get(sample.model);
      if (model === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sample model must exist in the catalog",
          path: ["samples", index, "model"],
        });
      } else if (!model.supportedEfforts.includes(sample.effort)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sample effort must be supported by the catalog model",
          path: ["samples", index, "effort"],
        });
      }

      if (sample.reroutedTo !== null && !catalogById.has(sample.reroutedTo)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "rerouted model must exist in the catalog",
          path: ["samples", index, "reroutedTo"],
        });
      }
    });

    if (run.samples.length > run.selection.maxTurns) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sample count must not exceed selection.maxTurns",
        path: ["samples"],
      });
    }

    const sampleIds = run.samples.map((sample) => sample.sampleId);
    if (new Set(sampleIds).size !== sampleIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sample IDs must be unique",
        path: ["samples"],
      });
    }

    visitStrings(run, [], (text, path) => {
      if (prohibitedStringPatterns.some((pattern) => pattern.test(text))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "run documents must not contain credential-shaped strings",
          path,
        });
      }
    });
  },
);

export type RunSample = z.infer<typeof RunSampleSchema>;
export type RunUpload = z.infer<typeof RunUploadSchema>;
