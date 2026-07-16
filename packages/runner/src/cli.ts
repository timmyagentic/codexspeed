#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { RunSeriesIdSchema } from "@codexspeed/contracts";
import { runDoctor } from "./commands/doctor.js";
import { MeasureCommandError, runMeasure } from "./commands/measure.js";
import { runPlan } from "./commands/plan.js";
import { runBenchmark, type RunCommandDependencies } from "./commands/run.js";
import {
  runPublish,
  type PublishCommandDependencies,
} from "./commands/publish.js";
import { AppServerError } from "./app-server.js";
import { RunnerRuntimeError, type RuntimeOptions } from "./runtime.js";
import { PublisherError } from "./publisher.js";
import { RUNNER_VERSION } from "./version.js";

export type CliIo = {
  stdout(line: string): void;
  stderr(line: string): void;
};

export type CliDependencies = RuntimeOptions &
  RunCommandDependencies &
  PublishCommandDependencies & {
    io?: CliIo;
    readInput?: (question: string) => Promise<string | null>;
  };

type ComparableEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type ParsedSuiteOptions = {
  maxTurns: number;
  rounds: number;
  seed: number;
  warmup: boolean;
  models: string[];
  efforts: ComparableEffort[];
  series?: string;
  out?: string;
};

type ParsedMeasureOptions = {
  model?: string;
  effort?: ComparableEffort;
  rounds: number;
  out?: string;
  acceptTurns?: number;
};

type ParsedCommand =
  | { name: "help" }
  | { name: "version" }
  | { name: "measure"; options: ParsedMeasureOptions }
  | { name: "doctor" }
  | { name: "plan"; options: ParsedSuiteOptions }
  | { name: "run"; options: ParsedSuiteOptions & { out: string } }
  | {
      name: "publish";
      options: { file: string; endpoint?: string; allowHttpLocalhost: boolean };
    };

class CliUsageError extends Error {}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

const HELP_LINES = [
  `CodexSpeed ${RUNNER_VERSION}`,
  "",
  "Usage:",
  "  codexspeed             Start the guided local speed test",
  "  codexspeed measure     Test this device and network",
  "  codexspeed doctor      Check Codex without a model turn",
  "  codexspeed plan        Print an advanced bounded schedule",
  "  codexspeed run         Run an advanced benchmark",
  "  codexspeed publish     Publish with the owner's signing key",
  "",
  "Measure options:",
  "  --model ID             Choose a visible Codex model",
  "  --effort VALUE         Choose a supported reasoning effort",
  "  --rounds N             Measured rounds, 1-10 (default: 3)",
  "  --out FILE             Save to this local JSON file",
  "  --accept-turns N        Non-interactive exact-turn confirmation",
  "",
  "The guided test runs locally and never uploads a result automatically.",
];

const COMPARABLE_EFFORTS = new Set<ComparableEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function integerOption(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new CliUsageError(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliUsageError(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return parsed;
}

function parseSuiteOptions(
  arguments_: readonly string[],
  command: "plan" | "run",
): ParsedSuiteOptions {
  let maxTurns: number | undefined;
  let rounds = 3;
  let seed = 0;
  let warmup = true;
  let out: string | undefined;
  let series: string | undefined;
  const models: string[] = [];
  const efforts: ComparableEffort[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]!;
    const value = arguments_[index + 1];
    switch (option) {
      case "--max-turns":
        maxTurns = integerOption(value, "--max-turns", 1, 200);
        index += 1;
        break;
      case "--rounds":
        rounds = integerOption(value, "--rounds", 1, 100);
        index += 1;
        break;
      case "--seed": {
        if (value === undefined || !/^\d+$/.test(value)) {
          throw new CliUsageError("--seed must be an unsigned 32-bit integer");
        }
        const parsed = Number(value);
        if (
          !Number.isSafeInteger(parsed) ||
          parsed < 0 ||
          parsed > 0xffff_ffff
        ) {
          throw new CliUsageError("--seed must be an unsigned 32-bit integer");
        }
        seed = parsed;
        index += 1;
        break;
      }
      case "--model":
        if (value === undefined || value.length === 0)
          throw new CliUsageError("--model needs a value");
        models.push(value);
        index += 1;
        break;
      case "--effort":
        if (
          value === undefined ||
          !COMPARABLE_EFFORTS.has(value as ComparableEffort)
        ) {
          throw new CliUsageError("--effort must be comparable");
        }
        efforts.push(value as ComparableEffort);
        index += 1;
        break;
      case "--series": {
        if (series !== undefined) {
          throw new CliUsageError("--series may be used once");
        }
        const parsed = RunSeriesIdSchema.safeParse(value);
        if (!parsed.success) {
          throw new CliUsageError("--series needs one valid identifier");
        }
        series = parsed.data;
        index += 1;
        break;
      }
      case "--no-warmup":
        warmup = false;
        break;
      case "--out":
        if (value === undefined || value.length === 0)
          throw new CliUsageError("--out needs a value");
        out = value;
        index += 1;
        break;
      default:
        throw new CliUsageError(`unknown option: ${option}`);
    }
  }

  if (maxTurns === undefined)
    throw new CliUsageError("--max-turns is required");
  if (command === "run" && out === undefined)
    throw new CliUsageError("--out is required");
  if (command === "plan" && out !== undefined)
    throw new CliUsageError("--out is only valid for run");
  if (series !== undefined) {
    if (models.length > 0 || efforts.length > 0) {
      throw new CliUsageError(
        "--series cannot be combined with --model or --effort",
      );
    }
    if (rounds !== 3) {
      throw new CliUsageError("--series requires --rounds 3");
    }
    if (!warmup) {
      throw new CliUsageError("--series requires warm-up");
    }
  }
  return {
    maxTurns,
    rounds,
    seed,
    warmup,
    models,
    efforts,
    ...(series === undefined ? {} : { series }),
    ...(out === undefined ? {} : { out }),
  };
}

function parseMeasureOptions(
  arguments_: readonly string[],
): ParsedMeasureOptions {
  let model: string | undefined;
  let effort: ComparableEffort | undefined;
  let rounds = 3;
  let out: string | undefined;
  let acceptTurns: number | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]!;
    const value = arguments_[index + 1];
    switch (option) {
      case "--model":
        if (
          value === undefined ||
          value.length === 0 ||
          value.startsWith("--") ||
          model !== undefined
        ) {
          throw new CliUsageError("--model needs one value");
        }
        model = value;
        index += 1;
        break;
      case "--effort":
        if (
          value === undefined ||
          !COMPARABLE_EFFORTS.has(value as ComparableEffort) ||
          effort !== undefined
        ) {
          throw new CliUsageError("--effort needs one comparable value");
        }
        effort = value as ComparableEffort;
        index += 1;
        break;
      case "--rounds":
        rounds = integerOption(value, "--rounds", 1, 10);
        index += 1;
        break;
      case "--out":
        if (
          value === undefined ||
          value.length === 0 ||
          value.startsWith("--") ||
          out !== undefined
        ) {
          throw new CliUsageError("--out needs one value");
        }
        out = value;
        index += 1;
        break;
      case "--accept-turns":
        acceptTurns = integerOption(value, "--accept-turns", 1, 200);
        index += 1;
        break;
      default:
        throw new CliUsageError(`unknown measure option: ${option}`);
    }
  }

  if (
    acceptTurns !== undefined &&
    (model === undefined || effort === undefined)
  ) {
    throw new CliUsageError(
      "--accept-turns requires explicit --model and --effort",
    );
  }
  return {
    rounds,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(out === undefined ? {} : { out }),
    ...(acceptTurns === undefined ? {} : { acceptTurns }),
  };
}

function parseCommand(arguments_: readonly string[]): ParsedCommand {
  const [command, ...options] = arguments_;
  if (command === undefined || command === "measure") {
    return {
      name: "measure",
      options: parseMeasureOptions(command === undefined ? [] : options),
    };
  }
  if (command === "help" || command === "--help" || command === "-h") {
    if (options.length > 0) throw new CliUsageError("help accepts no options");
    return { name: "help" };
  }
  if (command === "--version" || command === "-v") {
    if (options.length > 0) {
      throw new CliUsageError("version accepts no options");
    }
    return { name: "version" };
  }
  if (command === "doctor") {
    if (options.length > 0)
      throw new CliUsageError("doctor accepts no options");
    return { name: "doctor" };
  }
  if (command === "plan")
    return { name: "plan", options: parseSuiteOptions(options, "plan") };
  if (command === "run") {
    const parsed = parseSuiteOptions(options, "run");
    return { name: "run", options: { ...parsed, out: parsed.out! } };
  }
  if (command === "publish") {
    const [file, ...publishOptions] = options;
    if (file === undefined || file.length === 0 || file.startsWith("--")) {
      throw new CliUsageError("publish requires an artifact file");
    }
    let endpoint: string | undefined;
    let allowHttpLocalhost = false;
    for (let index = 0; index < publishOptions.length; index += 1) {
      const option = publishOptions[index]!;
      if (option === "--endpoint") {
        const value = publishOptions[index + 1];
        if (
          value === undefined ||
          value.length === 0 ||
          value.startsWith("--") ||
          endpoint !== undefined
        ) {
          throw new CliUsageError("--endpoint needs one value");
        }
        endpoint = value;
        index += 1;
      } else if (option === "--allow-http-localhost") {
        if (allowHttpLocalhost) {
          throw new CliUsageError("--allow-http-localhost may be used once");
        }
        allowHttpLocalhost = true;
      } else {
        throw new CliUsageError("unknown publish option");
      }
    }
    return {
      name: "publish",
      options: {
        file,
        allowHttpLocalhost,
        ...(endpoint === undefined ? {} : { endpoint }),
      },
    };
  }
  throw new CliUsageError(
    "command must be measure, doctor, plan, run, publish, or help",
  );
}

function safeFailure(error: unknown, fallback: string): string {
  if (
    error instanceof RunnerRuntimeError ||
    error instanceof AppServerError ||
    error instanceof RangeError ||
    error instanceof PublisherError
  ) {
    return `Error: ${error.message}`;
  }
  return `Error: ${fallback}`;
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? defaultIo;
  const normalizedArguments =
    arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  let command: ParsedCommand;
  try {
    command = parseCommand(normalizedArguments);
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr(`Error: ${error.message}`);
      return 2;
    }
    io.stderr("Error: invalid command arguments");
    return 2;
  }
  if (command.name === "help") {
    for (const line of HELP_LINES) io.stdout(line);
    return 0;
  }
  if (command.name === "version") {
    io.stdout(`CodexSpeed ${RUNNER_VERSION}`);
    return 0;
  }
  if (command.name === "measure") {
    const readInput = dependencies.readInput ?? defaultReadInput;
    try {
      return await runMeasure(
        command.options,
        { ...dependencies, readInput },
        io,
      );
    } catch (error) {
      if (error instanceof MeasureCommandError) {
        io.stderr(`Error: ${error.message}`);
        return error.exitCode;
      }
      io.stderr(safeFailure(error, "local benchmark failed"));
      return 1;
    }
  }
  if (command.name === "doctor") {
    try {
      const lines = await runDoctor(dependencies);
      for (const line of lines) io.stdout(line);
      return 0;
    } catch (error) {
      io.stderr(safeFailure(error, "doctor failed"));
      return 1;
    }
  }
  if (command.name === "plan") {
    try {
      const lines = await runPlan(command.options, dependencies);
      for (const line of lines) io.stdout(line);
      return 0;
    } catch (error) {
      io.stderr(safeFailure(error, "plan failed"));
      return 1;
    }
  }
  if (command.name === "run") {
    try {
      await runBenchmark(command.options, dependencies, (line) =>
        io.stdout(line),
      );
      io.stdout("Artifact written");
      return 0;
    } catch (error) {
      io.stderr(safeFailure(error, "run failed"));
      return 1;
    }
  }
  if (command.name === "publish") {
    try {
      const lines = await runPublish(command.options, dependencies);
      for (const line of lines) io.stdout(line);
      return 0;
    } catch (error) {
      io.stderr(safeFailure(error, "publish failed"));
      return 1;
    }
  }
  io.stderr("Error: unsupported command");
  return 2;
}

async function defaultReadInput(question: string): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return null;
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  try {
    return await prompt.question(question);
  } catch {
    return null;
  } finally {
    prompt.close();
  }
}
