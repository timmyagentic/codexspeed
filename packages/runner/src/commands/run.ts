import { randomBytes } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import {
  RunUploadSchema,
  type RunSample,
  type RunUpload,
} from "@codexspeed/contracts";
import {
  AppServerError,
  AppServerTimeoutError,
  type AppServerClient,
} from "../app-server.js";
import { discoverCatalog } from "../catalog.js";
import { BENCHMARK_PROMPT_SHA256 } from "../prompt.js";
import { recordTrial, type TrialResult } from "../recorder.js";
import { buildSchedule, executeSchedule } from "../scheduler.js";
import { RunnerRuntimeError, withIsolatedRuntime, type RuntimeOptions } from "../runtime.js";
import { RUNNER_VERSION } from "../version.js";
import {
  formatPlan,
  schedulerOptions,
  type SuiteCommandOptions,
} from "./plan.js";

const SUITE_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1.0.0";
const PROMPT_ID = "codexspeed-prompt-v1";

export type RunCommandOptions = SuiteCommandOptions & { out: string };

export type RunCommandDependencies = RuntimeOptions & {
  now?: () => Date;
  idFactory?: () => string;
  publicEnvironment?: RunUpload["environment"];
};

function parseVersion(output: { stdout: string; stderr: string }): string {
  const match = /\bcodex(?:-cli)?\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/i.exec(
    `${output.stdout}\n${output.stderr}`,
  );
  if (match?.[1] === undefined) throw new RunnerRuntimeError("Codex CLI version is unavailable");
  return match[1];
}

function canonicalTimestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RunnerRuntimeError("clock is invalid");
  return date.toISOString();
}

export function createUuidV7(now = Date.now(), randomness: Uint8Array = randomBytes(16)): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RunnerRuntimeError("clock is outside the UUIDv7 range");
  }
  if (randomness.byteLength !== 16) {
    throw new RunnerRuntimeError("UUIDv7 randomness must contain 16 bytes");
  }
  const bytes = Buffer.from(randomness);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultPublicEnvironment(): RunUpload["environment"] {
  const osFamily =
    platform() === "darwin"
      ? "macos"
      : platform() === "linux"
        ? "linux"
        : platform() === "win32"
          ? "windows"
          : null;
  const architecture = arch() === "arm64" ? "arm64" : arch() === "x64" ? "x64" : null;
  if (osFamily === null || architecture === null) {
    throw new RunnerRuntimeError("platform is unsupported");
  }
  const osVersion = release().replace(/[^0-9A-Za-z._-]/g, "_").slice(0, 64) || "unknown";
  return {
    osFamily,
    osVersion,
    architecture,
    region: "unknown",
    authChannel: "chatgpt",
    serviceTier: "default",
  };
}

function sanitizedEnvironment(
  environment: RunUpload["environment"] | undefined,
): RunUpload["environment"] {
  const source = environment ?? defaultPublicEnvironment();
  return {
    osFamily: source.osFamily,
    osVersion: source.osVersion,
    architecture: source.architecture,
    region: source.region,
    authChannel: "chatgpt",
    serviceTier: "default",
  };
}

function failedTrial(error: AppServerError): TrialResult {
  return {
    status: "failed",
    firstVisibleTextMs: null,
    lastVisibleTextMs: null,
    totalLatencyMs: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    agentMessageCount: 0,
    toolEventCount: 0,
    reroutedTo: null,
    validatorPassed: false,
    validatorReason: "missing_output",
    errorCode: error instanceof AppServerTimeoutError ? "timeout" : "protocol_error",
  };
}

async function closeClient(client: AppServerClient | null): Promise<void> {
  if (client !== null) await client.close();
}

export async function runBenchmark(
  options: RunCommandOptions,
  dependencies: RunCommandDependencies,
  writeLine: (line: string) => void,
): Promise<RunUpload> {
  const now = dependencies.now ?? (() => new Date());
  const idFactory = dependencies.idFactory ?? (() => createUuidV7());

  return withIsolatedRuntime(dependencies, async (runtime) => {
    const startedAt = canonicalTimestamp(now());
    const codexCliVersion = parseVersion(await runtime.runCodex(["--version"]));
    let client: AppServerClient | null = await runtime.connect();
    let artifact: Awaited<ReturnType<typeof open>> | null = null;
    let keepArtifact = false;

    try {
      const catalog = await discoverCatalog(client);
      const schedule = schedulerOptions(options);
      const builtSchedule = buildSchedule(catalog, schedule);
      for (const line of formatPlan(builtSchedule)) writeLine(line);
      const runId = idFactory();

      artifact = await open(options.out, "wx", 0o600).catch(() => {
        throw new RunnerRuntimeError("artifact output is unavailable");
      });

      const samples = await executeSchedule(builtSchedule, async (entry, index) => {
        writeLine(
          `Starting turn ${index + 1}/${builtSchedule.entries.length}: ${entry.phase} ${entry.model} / ${entry.effort} (round ${entry.round}); remaining ${builtSchedule.entries.length - index}`,
        );

        let result: TrialResult;
        try {
          client ??= await runtime.connect();
          result = await recordTrial(client, {
            model: entry.model,
            effort: entry.effort,
            workspacePath: runtime.workspacePath,
          });
        } catch (error) {
          if (!(error instanceof AppServerError)) throw error;
          result = failedTrial(error);
        }

        if (result.errorCode === "timeout" || result.errorCode === "protocol_error") {
          await closeClient(client);
          client = null;
        }
        writeLine(
          `Finished turn ${index + 1}/${builtSchedule.entries.length}: ${result.status}; remaining ${builtSchedule.entries.length - index - 1}`,
        );
        return {
          sampleId: idFactory(),
          model: entry.model,
          effort: entry.effort,
          phase: entry.phase,
          round: entry.round,
          attempt: entry.attempt,
          ...result,
        } satisfies RunSample;
      });

      const run = RunUploadSchema.parse({
        schemaVersion: 1,
        runId,
        suiteVersion: SUITE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        runnerVersion: RUNNER_VERSION,
        codexCliVersion,
        startedAt,
        endedAt: canonicalTimestamp(now()),
        mode: builtSchedule.mode,
        seed: builtSchedule.seed,
        status: "completed",
        prompt: {
          id: PROMPT_ID,
          sha256: BENCHMARK_PROMPT_SHA256,
        },
        environment: sanitizedEnvironment(dependencies.publicEnvironment),
        catalog,
        selection: {
          cells: builtSchedule.cells,
          warmupPerModel: builtSchedule.warmupPerModel,
          measuredRounds: builtSchedule.measuredRounds,
          maxTurns: builtSchedule.maxTurns,
        },
        samples,
      });
      await artifact.writeFile(JSON.stringify(run), "utf8");
      keepArtifact = true;
      return run;
    } finally {
      await closeClient(client);
      await artifact?.close();
      if (!keepArtifact && artifact !== null) await rm(options.out, { force: true });
    }
  });
}
