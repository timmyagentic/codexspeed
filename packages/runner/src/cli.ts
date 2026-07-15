#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runDoctor } from "./commands/doctor.js";
import { runPlan } from "./commands/plan.js";
import { runBenchmark, type RunCommandDependencies } from "./commands/run.js";
import { AppServerError } from "./app-server.js";
import { RunnerRuntimeError, type RuntimeOptions } from "./runtime.js";

export type CliIo = {
  stdout(line: string): void;
  stderr(line: string): void;
};

export type CliDependencies = RuntimeOptions & RunCommandDependencies & {
  io?: CliIo;
};

type ComparableEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type ParsedSuiteOptions = {
  maxTurns: number;
  rounds: number;
  seed: number;
  warmup: boolean;
  models: string[];
  efforts: ComparableEffort[];
  out?: string;
};

type ParsedCommand =
  | { name: "doctor" }
  | { name: "plan"; options: ParsedSuiteOptions }
  | { name: "run"; options: ParsedSuiteOptions & { out: string } };

class CliUsageError extends Error {}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

const COMPARABLE_EFFORTS = new Set<ComparableEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function integerOption(value: string | undefined, name: string, minimum: number, maximum: number) {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new CliUsageError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliUsageError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function parseSuiteOptions(arguments_: readonly string[], command: "plan" | "run"): ParsedSuiteOptions {
  let maxTurns: number | undefined;
  let rounds = 3;
  let seed = 0;
  let warmup = true;
  let out: string | undefined;
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
        if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
          throw new CliUsageError("--seed must be an unsigned 32-bit integer");
        }
        seed = parsed;
        index += 1;
        break;
      }
      case "--model":
        if (value === undefined || value.length === 0) throw new CliUsageError("--model needs a value");
        models.push(value);
        index += 1;
        break;
      case "--effort":
        if (value === undefined || !COMPARABLE_EFFORTS.has(value as ComparableEffort)) {
          throw new CliUsageError("--effort must be comparable");
        }
        efforts.push(value as ComparableEffort);
        index += 1;
        break;
      case "--no-warmup":
        warmup = false;
        break;
      case "--out":
        if (value === undefined || value.length === 0) throw new CliUsageError("--out needs a value");
        out = value;
        index += 1;
        break;
      default:
        throw new CliUsageError(`unknown option: ${option}`);
    }
  }

  if (maxTurns === undefined) throw new CliUsageError("--max-turns is required");
  if (command === "run" && out === undefined) throw new CliUsageError("--out is required");
  if (command === "plan" && out !== undefined) throw new CliUsageError("--out is only valid for run");
  return { maxTurns, rounds, seed, warmup, models, efforts, ...(out === undefined ? {} : { out }) };
}

function parseCommand(arguments_: readonly string[]): ParsedCommand {
  const [command, ...options] = arguments_;
  if (command === "doctor") {
    if (options.length > 0) throw new CliUsageError("doctor accepts no options");
    return { name: "doctor" };
  }
  if (command === "plan") return { name: "plan", options: parseSuiteOptions(options, "plan") };
  if (command === "run") {
    const parsed = parseSuiteOptions(options, "run");
    return { name: "run", options: { ...parsed, out: parsed.out! } };
  }
  throw new CliUsageError("command must be doctor, plan, or run");
}

function safeFailure(error: unknown, fallback: string): string {
  if (
    error instanceof RunnerRuntimeError ||
    error instanceof AppServerError ||
    error instanceof RangeError
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
  let command: ParsedCommand;
  try {
    command = parseCommand(arguments_);
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr(`Error: ${error.message}`);
      return 2;
    }
    io.stderr("Error: invalid command arguments");
    return 2;
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
      await runBenchmark(command.options, dependencies, (line) => io.stdout(line));
      io.stdout("Artifact written");
      return 0;
    } catch (error) {
      io.stderr(safeFailure(error, "run failed"));
      return 1;
    }
  }
  io.stderr("Error: unsupported command");
  return 2;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void runCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      defaultIo.stderr("Error: command failed");
      process.exitCode = 1;
    },
  );
}
