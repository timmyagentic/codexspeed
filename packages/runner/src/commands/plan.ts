import type { RunSample } from "@codexspeed/contracts";
import { discoverCatalog } from "../catalog.js";
import {
  buildSchedule,
  type BenchmarkSchedule,
  type ScheduleOptions,
} from "../scheduler.js";
import { withIsolatedRuntime, type RuntimeOptions } from "../runtime.js";

export type SuiteCommandOptions = {
  maxTurns: number;
  rounds: number;
  seed: number;
  warmup: boolean;
  models: readonly string[];
  efforts: readonly RunSample["effort"][];
  series?: string;
};

function schedulerOptions(options: SuiteCommandOptions): ScheduleOptions {
  return {
    maxTurns: options.maxTurns,
    rounds: options.rounds,
    seed: options.seed,
    warmup: options.warmup,
    ...(options.models.length === 0 ? {} : { models: options.models }),
    ...(options.efforts.length === 0 ? {} : { efforts: options.efforts }),
    ...(options.series === undefined ? {} : { series: options.series }),
  };
}

export function formatPlan(schedule: BenchmarkSchedule): string[] {
  const warmups = schedule.entries.filter((entry) => entry.phase === "warmup").length;
  const measured = schedule.entries.length - warmups;
  return [
    `Seed: ${schedule.seed}`,
    `Mode: ${schedule.mode}`,
    ...(schedule.series === undefined ? [] : [`Series: ${schedule.series}`]),
    `Comparable cells: ${schedule.cells.length}`,
    ...schedule.cells.map(
      (cell, index) => `Cell ${index + 1}: ${cell.model} / ${cell.effort}`,
    ),
    `Warm-up turns: ${warmups}`,
    `Measured turns: ${measured}`,
    `Total turns: ${schedule.entries.length} / max ${schedule.maxTurns}`,
    ...schedule.entries.map(
      (entry, index) =>
        `Turn ${index + 1}: ${entry.phase} ${entry.model} / ${entry.effort} (round ${entry.round})`,
    ),
  ];
}

export async function runPlan(
  options: SuiteCommandOptions,
  runtimeOptions: RuntimeOptions,
): Promise<string[]> {
  return withIsolatedRuntime(runtimeOptions, async (runtime) => {
    const client = await runtime.connect();
    try {
      const catalog = await discoverCatalog(client);
      return formatPlan(buildSchedule(catalog, schedulerOptions(options)));
    } finally {
      await client.close();
    }
  });
}

export { schedulerOptions };
