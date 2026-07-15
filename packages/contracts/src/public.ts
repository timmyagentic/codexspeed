import { z } from "zod";

import { RunUploadSchema, type RunUpload } from "./run.js";

const MAX_SUMMARY_CELLS = 200;
const MAX_LIST_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 512;

const CountSchema = z.number().finite().int().nonnegative().safe();
const PositiveCountSchema = z.number().finite().int().positive().safe();
const MetricSchema = z.number().finite().nonnegative();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const UtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime({ offset: false, precision: 3 })
  .refine((timestamp) => {
    try {
      return new Date(timestamp).toISOString() === timestamp;
    } catch {
      return false;
    }
  }, "timestamp must be canonical UTC with millisecond precision");

const RunUploadObjectSchema = RunUploadSchema.innerType();
const SelectionCellSchema = RunUploadObjectSchema.shape.selection.innerType().shape.cells.element;

const MetricDistributionSchema = z
  .object({
    p50: MetricSchema,
    min: MetricSchema,
    max: MetricSchema,
    n: PositiveCountSchema,
  })
  .strict();

const ReliabilitySchema = z
  .object({
    measuredSamples: CountSchema,
    validSamples: CountSchema,
    invalidSamples: CountSchema,
  })
  .strict();

const RunCoverageSchema = z
  .object({
    selectedCells: CountSchema,
    measuredCells: CountSchema,
    unmeasuredCells: CountSchema,
    expectedMeasuredSamples: CountSchema,
    recordedMeasuredSamples: CountSchema,
  })
  .strict();

const CellSummarySchema = SelectionCellSchema.extend({
  coverage: z
    .object({
      expectedMeasuredSamples: CountSchema,
      recordedMeasuredSamples: CountSchema,
    })
    .strict(),
  reliability: ReliabilitySchema,
  metrics: z
    .object({
      firstVisibleTextMs: MetricDistributionSchema.nullable(),
      visibleStreamTpsEstimate: MetricDistributionSchema.nullable(),
      visibleE2eTps: MetricDistributionSchema.nullable(),
      generatedE2eTps: MetricDistributionSchema.nullable(),
      totalLatencyMs: MetricDistributionSchema.nullable(),
    })
    .strict(),
}).strict();

export const PublicRunSchema = RunUploadSchema;
export type PublicRun = RunUpload;

export const RunPublicationSchema = z
  .object({
    payloadSha256: Sha256Schema,
    publishedAt: UtcTimestampSchema,
  })
  .strict();
export type RunPublication = z.infer<typeof RunPublicationSchema>;

export const PublicRunSummarySchema = z
  .object({
    runId: RunUploadObjectSchema.shape.runId,
    coverage: RunCoverageSchema,
    reliability: ReliabilitySchema,
    cells: z.array(CellSummarySchema).max(MAX_SUMMARY_CELLS),
  })
  .strict();
export type PublicRunSummary = z.infer<typeof PublicRunSummarySchema>;

export const PublicRunResponseSchema = z
  .object({
    run: PublicRunSchema,
    summary: PublicRunSummarySchema,
    publication: RunPublicationSchema,
  })
  .strict();
export type PublicRunResponse = z.infer<typeof PublicRunResponseSchema>;

export const LatestRunResponseSchema = PublicRunResponseSchema.extend({
  generation: CountSchema,
}).strict();
export type LatestRunResponse = z.infer<typeof LatestRunResponseSchema>;

const RunListIdentitySchema = RunUploadObjectSchema.pick({
  schemaVersion: true,
  runId: true,
  suiteVersion: true,
  protocolVersion: true,
  runnerVersion: true,
  codexCliVersion: true,
  startedAt: true,
  endedAt: true,
  mode: true,
  status: true,
})
  .extend({
    startedAt: UtcTimestampSchema,
    endedAt: UtcTimestampSchema,
  })
  .strict();

export const RunListMetadataSchema = RunListIdentitySchema.extend({
  publication: RunPublicationSchema,
  summary: z
    .object({
      coverage: RunCoverageSchema,
      reliability: ReliabilitySchema,
    })
    .strict(),
}).strict();
export type RunListMetadata = z.infer<typeof RunListMetadataSchema>;

const CursorSchema = z
  .string()
  .min(1)
  .max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);

export const RunListResponseSchema = z
  .object({
    data: z.array(RunListMetadataSchema).max(MAX_LIST_PAGE_SIZE),
    nextCursor: CursorSchema.nullable(),
  })
  .strict();
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
