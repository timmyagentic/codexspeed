import { join } from "node:path";

import type { RunSample } from "@codexspeed/contracts";

import type { DiscoveredCatalog } from "../catalog.js";
import { buildSchedule } from "../scheduler.js";
import { formatTerminalResult } from "../terminal-result.js";
import { inspectDoctor } from "./doctor.js";
import { runBenchmark, type RunCommandDependencies } from "./run.js";

type ComparableEffort = RunSample["effort"];

export type MeasureCommandOptions = {
  model?: string;
  effort?: ComparableEffort;
  rounds: number;
  out?: string;
  acceptTurns?: number;
};

export type MeasureCommandDependencies = RunCommandDependencies & {
  readInput(question: string): Promise<string | null>;
};

export type MeasureCommandIo = {
  stdout(line: string): void;
};

export class MeasureCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message);
  }
}

type ModelChoice = {
  id: string;
  displayName: string;
  defaultEffort: ComparableEffort;
  efforts: ComparableEffort[];
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

function modelChoices(catalog: DiscoveredCatalog): ModelChoice[] {
  return catalog.models.flatMap((model) => {
    if (model.hidden) return [];
    const efforts = model.supportedEfforts.filter((effort) =>
      COMPARABLE_EFFORTS.has(effort as ComparableEffort),
    ) as ComparableEffort[];
    if (efforts.length === 0) return [];
    const defaultEffort = efforts.includes(
      model.defaultEffort as ComparableEffort,
    )
      ? (model.defaultEffort as ComparableEffort)
      : efforts[0]!;
    return [
      {
        id: model.id,
        displayName: model.displayName,
        defaultEffort,
        efforts,
      },
    ];
  });
}

function selectedIndex(
  answer: string,
  choices: readonly unknown[],
  defaultIndex: number,
): number {
  if (answer.trim() === "") return defaultIndex;
  if (!/^\d+$/u.test(answer.trim())) {
    throw new MeasureCommandError("selection must be a listed number", 2);
  }
  const index = Number(answer.trim()) - 1;
  if (index < 0 || index >= choices.length) {
    throw new MeasureCommandError("selection must be a listed number", 2);
  }
  return index;
}

async function selectModel(
  choices: ModelChoice[],
  requested: string | undefined,
  dependencies: MeasureCommandDependencies,
  io: MeasureCommandIo,
): Promise<ModelChoice> {
  if (requested !== undefined) {
    const match = choices.find((choice) => choice.id === requested);
    if (match === undefined) {
      throw new MeasureCommandError("selected model is unavailable", 2);
    }
    return match;
  }

  io.stdout("");
  io.stdout("Available models");
  choices.forEach((choice, index) => {
    io.stdout(`  ${index + 1}. ${choice.displayName} (${choice.id})`);
  });
  const answer = await dependencies.readInput("Choose a model [1]: ");
  if (answer === null) {
    throw new MeasureCommandError(
      "interactive model selection unavailable; pass --model and --effort",
      2,
    );
  }
  return choices[selectedIndex(answer, choices, 0)]!;
}

async function selectEffort(
  model: ModelChoice,
  requested: ComparableEffort | undefined,
  dependencies: MeasureCommandDependencies,
  io: MeasureCommandIo,
): Promise<ComparableEffort> {
  if (requested !== undefined) {
    if (!model.efforts.includes(requested)) {
      throw new MeasureCommandError(
        "selected reasoning effort is unavailable for this model",
        2,
      );
    }
    return requested;
  }

  const defaultIndex = model.efforts.indexOf(model.defaultEffort);
  io.stdout("");
  io.stdout(`Reasoning efforts for ${model.displayName}`);
  model.efforts.forEach((effort, index) => {
    const defaultLabel = index === defaultIndex ? " (default)" : "";
    io.stdout(`  ${index + 1}. ${effort}${defaultLabel}`);
  });
  const answer = await dependencies.readInput(
    `Choose reasoning effort [${defaultIndex + 1}]: `,
  );
  if (answer === null) {
    throw new MeasureCommandError(
      "interactive effort selection unavailable; pass --model and --effort",
      2,
    );
  }
  return model.efforts[selectedIndex(answer, model.efforts, defaultIndex)]!;
}

function defaultArtifactPath(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
    .replace("T", "-");
  return join(process.cwd(), `codexspeed-result-${timestamp}.json`);
}

export async function runMeasure(
  options: MeasureCommandOptions,
  dependencies: MeasureCommandDependencies,
  io: MeasureCommandIo,
): Promise<0 | 1> {
  const inspection = await inspectDoctor(dependencies);
  inspection.lines.forEach((line) => io.stdout(line));
  const choices = modelChoices(inspection.catalog);
  if (choices.length === 0) {
    throw new MeasureCommandError(
      "no comparable Codex models are available",
      1,
    );
  }

  const model = await selectModel(choices, options.model, dependencies, io);
  const effort = await selectEffort(model, options.effort, dependencies, io);
  const maxTurns = options.rounds + 1;
  const schedule = buildSchedule(inspection.catalog, {
    seed: 0,
    maxTurns,
    rounds: options.rounds,
    warmup: true,
    models: [model.id],
    efforts: [effort],
  });
  const plannedTurns = schedule.entries.length;

  io.stdout("");
  io.stdout("CodexSpeed local benchmark");
  io.stdout(`Model: ${model.displayName} (${model.id})`);
  io.stdout(`Reasoning effort: ${effort}`);
  io.stdout(
    `Plan: 1 warm-up + ${options.rounds} measured = ${plannedTurns} real Codex turns`,
  );
  io.stdout(
    "This consumes your Codex/ChatGPT usage allowance and may have billing impact depending on your account settings.",
  );
  io.stdout(
    "CodexSpeed cannot inspect billing. No result is uploaded automatically.",
  );

  if (options.acceptTurns !== undefined) {
    if (options.acceptTurns !== plannedTurns) {
      throw new MeasureCommandError(
        `--accept-turns must equal the planned ${plannedTurns} turns`,
        2,
      );
    }
  } else {
    const answer = await dependencies.readInput("Continue? [y/N]: ");
    if (answer === null) {
      throw new MeasureCommandError(
        `confirmation unavailable; rerun with --accept-turns ${plannedTurns} after reviewing the plan`,
        2,
      );
    }
    if (!/^(?:y|yes)$/iu.test(answer.trim())) {
      io.stdout("Cancelled; no model turns started.");
      return 0;
    }
  }

  const out = options.out ?? defaultArtifactPath();
  const run = await runBenchmark(
    {
      maxTurns: plannedTurns,
      rounds: options.rounds,
      seed: 0,
      warmup: true,
      models: [model.id],
      efforts: [effort],
      out,
    },
    dependencies,
    (line) => io.stdout(line),
  );
  const result = formatTerminalResult(run, out);
  result.lines.forEach((line) => io.stdout(line));
  return result.hasValidMeasurements ? 0 : 1;
}
