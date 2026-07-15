import type { RunSample, RunUpload } from "@codexspeed/contracts";
import type { DiscoveredCatalog } from "./catalog.js";

export type ScheduleCell = RunUpload["selection"]["cells"][number];

export type ScheduleEntry = ScheduleCell & {
  phase: RunSample["phase"];
  round: number;
  attempt: number;
};

export type ScheduleOptions = {
  seed: number;
  maxTurns: number;
  rounds?: number;
  warmup?: boolean;
  models?: readonly string[];
  efforts?: readonly RunSample["effort"][];
};

export type BenchmarkSchedule = {
  mode: "full" | "smoke";
  seed: number;
  maxTurns: number;
  warmupPerModel: number;
  measuredRounds: number;
  cells: ScheduleCell[];
  entries: ScheduleEntry[];
};

const COMPARABLE_EFFORTS = new Set<RunSample["effort"]>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

export function buildSchedule(
  catalog: DiscoveredCatalog,
  options: ScheduleOptions,
): BenchmarkSchedule {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff) {
    throw new RangeError("seed must be an unsigned 32-bit integer");
  }
  if (
    !Number.isSafeInteger(options.maxTurns) ||
    options.maxTurns < 1 ||
    options.maxTurns > 200
  ) {
    throw new RangeError("maxTurns must be an integer from 1 through 200");
  }
  const rounds = options.rounds ?? 3;
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100) {
    throw new RangeError("rounds must be an integer from 1 through 100");
  }
  const warmup = options.warmup ?? true;
  const modelFilter =
    options.models === undefined || options.models.length === 0 ? null : new Set(options.models);
  const effortFilter =
    options.efforts === undefined || options.efforts.length === 0 ? null : new Set(options.efforts);
  if (
    modelFilter !== null &&
    [...modelFilter].some(
      (modelId) =>
        !catalog.models.some(
          (model) =>
            model.id === modelId &&
            !model.hidden &&
            model.supportedEfforts.some((effort) =>
              COMPARABLE_EFFORTS.has(effort as RunSample["effort"]),
            ),
        ),
    )
  ) {
    throw new RangeError("model filter contains an unavailable model");
  }
  const cells: ScheduleCell[] = catalog.models.flatMap((model) => {
    if (model.hidden || (modelFilter !== null && !modelFilter.has(model.id))) return [];
    return model.supportedEfforts.flatMap((effort) =>
      COMPARABLE_EFFORTS.has(effort as RunSample["effort"]) &&
      (effortFilter === null || effortFilter.has(effort as RunSample["effort"]))
        ? [{ model: model.id, effort: effort as RunSample["effort"] }]
        : [],
    );
  });
  if (
    effortFilter !== null &&
    [...effortFilter].some((effort) => !cells.some((cell) => cell.effort === effort))
  ) {
    throw new RangeError("effort filter contains an unavailable effort");
  }
  if (cells.length === 0) {
    throw new RangeError("selection contains no comparable cells");
  }
  const selectedModels = catalog.models.filter(
    (model) => !model.hidden && cells.some((cell) => cell.model === model.id),
  );
  const entries: ScheduleEntry[] = warmup
    ? selectedModels.map((model) => {
        const selectedEfforts = cells
          .filter((cell) => cell.model === model.id)
          .map((cell) => cell.effort);
        const effort = COMPARABLE_EFFORTS.has(model.defaultEffort as RunSample["effort"])
          ? (model.defaultEffort as RunSample["effort"])
          : selectedEfforts[0]!;
        return {
          model: model.id,
          effort,
          phase: "warmup",
          round: 0,
          attempt: 1,
        };
      })
    : [];

  for (let round = 1; round <= rounds; round += 1) {
    entries.push(
      ...shuffled(cells, options.seed + round - 1).map((cell) => ({
        ...cell,
        phase: "measured" as const,
        round,
        attempt: 1,
      })),
    );
  }

  if (entries.length > options.maxTurns) {
    throw new RangeError(
      `planned ${entries.length} turns exceeds --max-turns ${options.maxTurns}`,
    );
  }

  return {
    mode:
      warmup && rounds === 3 && modelFilter === null && effortFilter === null ? "full" : "smoke",
    seed: options.seed,
    maxTurns: options.maxTurns,
    warmupPerModel: warmup ? 1 : 0,
    measuredRounds: rounds,
    cells,
    entries,
  };
}

export async function executeSchedule<T>(
  schedule: BenchmarkSchedule,
  executeTrial: (entry: ScheduleEntry, index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (let index = 0; index < schedule.entries.length; index += 1) {
    results.push(await executeTrial(schedule.entries[index]!, index));
  }
  return results;
}
