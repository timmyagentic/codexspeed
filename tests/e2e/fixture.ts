import { RunUploadSchema, type RunUpload } from "@codexspeed/contracts";

const sample = (
  sampleId: string,
  model: string,
  effort: "low" | "medium" | "high",
  values: {
    round?: number;
    firstVisibleTextMs: number;
    lastVisibleTextMs: number;
    totalLatencyMs: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    toolEventCount?: number;
  },
): RunUpload["samples"][number] => ({
  sampleId,
  model,
  effort,
  phase: "measured",
  round: values.round ?? 1,
  attempt: 1,
  status: "completed",
  firstVisibleTextMs: values.firstVisibleTextMs,
  lastVisibleTextMs: values.lastVisibleTextMs,
  totalLatencyMs: values.totalLatencyMs,
  outputTokens: values.outputTokens,
  reasoningOutputTokens: values.reasoningOutputTokens,
  agentMessageCount: 1,
  toolEventCount: values.toolEventCount ?? 0,
  reroutedTo: null,
  validatorPassed: true,
  validatorReason: "ok",
  errorCode: null,
});

export const E2E_RUN = RunUploadSchema.parse({
  schemaVersion: 1,
  runId: "01900000-0000-7000-8000-000000000100",
  suiteVersion: "1.0.0",
  protocolVersion: "1.0.0",
  runnerVersion: "0.1.0",
  codexCliVersion: "0.144.1",
  startedAt: "2026-07-16T09:00:00.000Z",
  endedAt: "2026-07-16T09:05:00.000Z",
  mode: "smoke",
  seed: 73,
  status: "partial",
  prompt: {
    id: "codexspeed-prompt-v1",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  environment: {
    osFamily: "macos",
    osVersion: "15.5",
    architecture: "arm64",
    region: "east-asia",
    authChannel: "chatgpt",
    serviceTier: "default",
  },
  catalog: {
    models: [
      {
        id: "model-atlas",
        displayName: "Model Atlas",
        hidden: false,
        defaultEffort: "medium",
        supportedEfforts: ["low", "medium", "high", "ultra"],
      },
      {
        id: "model-boreal",
        displayName: "Model Boreal",
        hidden: false,
        defaultEffort: "high",
        supportedEfforts: ["medium", "high"],
      },
    ],
  },
  selection: {
    cells: [
      { model: "model-atlas", effort: "low" },
      { model: "model-atlas", effort: "medium" },
      { model: "model-atlas", effort: "high" },
      { model: "model-boreal", effort: "medium" },
      { model: "model-boreal", effort: "high" },
    ],
    warmupPerModel: 0,
    measuredRounds: 2,
    maxTurns: 12,
  },
  samples: [
    sample("01900000-0000-7000-8000-000000000101", "model-atlas", "low", {
      firstVisibleTextMs: 500,
      lastVisibleTextMs: 5_500,
      totalLatencyMs: 7_000,
      outputTokens: 500,
      reasoningOutputTokens: 50,
    }),
    sample("01900000-0000-7000-8000-000000000102", "model-atlas", "low", {
      round: 2,
      firstVisibleTextMs: 700,
      lastVisibleTextMs: 6_700,
      totalLatencyMs: 8_000,
      outputTokens: 620,
      reasoningOutputTokens: 120,
    }),
    sample("01900000-0000-7000-8000-000000000104", "model-atlas", "high", {
      firstVisibleTextMs: 1_000,
      lastVisibleTextMs: 9_000,
      totalLatencyMs: 11_000,
      outputTokens: 800,
      reasoningOutputTokens: 200,
    }),
    sample("01900000-0000-7000-8000-000000000105", "model-atlas", "high", {
      round: 2,
      firstVisibleTextMs: 1_200,
      lastVisibleTextMs: 10_200,
      totalLatencyMs: 12_500,
      outputTokens: 850,
      reasoningOutputTokens: 200,
    }),
    sample("01900000-0000-7000-8000-000000000106", "model-boreal", "medium", {
      firstVisibleTextMs: 900,
      lastVisibleTextMs: 6_900,
      totalLatencyMs: 8_500,
      outputTokens: 600,
      reasoningOutputTokens: 100,
      toolEventCount: 1,
    }),
    sample("01900000-0000-7000-8000-000000000107", "model-boreal", "high", {
      firstVisibleTextMs: 2_000,
      lastVisibleTextMs: 2_000,
      totalLatencyMs: 6_000,
      outputTokens: 500,
      reasoningOutputTokens: 50,
    }),
  ],
});

export const E2E_BODY = new TextEncoder().encode(JSON.stringify(E2E_RUN));
