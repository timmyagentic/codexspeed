import { describe, expect, it } from "vitest";
import type { DiscoveredCatalog } from "./catalog.js";
import { buildSchedule, executeSchedule } from "./index.js";

const catalog: DiscoveredCatalog = {
  models: [
    {
      id: "model-alpha",
      displayName: "Alpha",
      hidden: false,
      defaultEffort: "medium",
      supportedEfforts: ["low", "medium", "ultra"],
    },
    {
      id: "model-beta",
      displayName: "Beta",
      hidden: false,
      defaultEffort: "high",
      supportedEfforts: ["high"],
    },
    {
      id: "model-hidden",
      displayName: "Hidden",
      hidden: true,
      defaultEffort: "ultra",
      supportedEfforts: ["high", "ultra"],
    },
  ],
};

describe("buildSchedule", () => {
  it("builds one default-effort warm-up per visible model and three measured rounds", () => {
    const schedule = buildSchedule(catalog, { seed: 42, maxTurns: 20 });

    expect(schedule.cells).toEqual([
      { model: "model-alpha", effort: "low" },
      { model: "model-alpha", effort: "medium" },
      { model: "model-beta", effort: "high" },
    ]);
    expect(schedule.entries.filter((entry) => entry.phase === "warmup")).toEqual([
      { model: "model-alpha", effort: "medium", phase: "warmup", round: 0, attempt: 1 },
      { model: "model-beta", effort: "high", phase: "warmup", round: 0, attempt: 1 },
    ]);
    expect(schedule.entries.filter((entry) => entry.phase === "measured")).toHaveLength(9);
    expect(schedule.entries).toHaveLength(11);
    expect(schedule.warmupPerModel).toBe(1);
    expect(schedule.measuredRounds).toBe(3);
  });

  it("uses a deterministic seeded Fisher-Yates order independently inside each round", () => {
    const first = buildSchedule(catalog, { seed: 123, maxTurns: 20 });
    const repeated = buildSchedule(catalog, { seed: 123, maxTurns: 20 });
    const different = buildSchedule(catalog, { seed: 124, maxTurns: 20 });
    const measuredOrder = (schedule: typeof first) =>
      schedule.entries
        .filter((entry) => entry.phase === "measured")
        .map((entry) => `${entry.round}:${entry.model}/${entry.effort}`);

    expect(measuredOrder(first)).toEqual(measuredOrder(repeated));
    expect(measuredOrder(first)).not.toEqual(measuredOrder(different));
    for (let round = 1; round <= 3; round += 1) {
      const roundCells = first.entries
        .filter((entry) => entry.phase === "measured" && entry.round === round)
        .map(({ model, effort }) => `${model}/${effort}`)
        .sort();
      expect(roundCells).toEqual([
        "model-alpha/low",
        "model-alpha/medium",
        "model-beta/high",
      ]);
    }
  });

  it("applies model and effort filters with reduced rounds and an explicit no-warmup mode", () => {
    const schedule = buildSchedule(catalog, {
      seed: 9,
      maxTurns: 1,
      models: ["model-alpha"],
      efforts: ["low"],
      rounds: 1,
      warmup: false,
    });

    expect(schedule).toMatchObject({
      cells: [{ model: "model-alpha", effort: "low" }],
      warmupPerModel: 0,
      measuredRounds: 1,
    });
    expect(schedule.entries).toEqual([
      { model: "model-alpha", effort: "low", phase: "measured", round: 1, attempt: 1 },
    ]);
  });

  it("refuses a plan larger than maxTurns before execution", () => {
    expect(() => buildSchedule(catalog, { seed: 42, maxTurns: 10 })).toThrow(
      "planned 11 turns exceeds --max-turns 10",
    );
  });

  it("never schedules Ultra and safely warms an Ultra-default model at a selected effort", () => {
    const ultraDefaultCatalog: DiscoveredCatalog = {
      models: [
        {
          id: "model-ultra-default",
          displayName: "Ultra Default",
          hidden: false,
          defaultEffort: "ultra",
          supportedEfforts: ["high", "ultra"],
        },
      ],
    };

    const schedule = buildSchedule(ultraDefaultCatalog, { seed: 1, maxTurns: 4 });

    expect(schedule.cells).toEqual([{ model: "model-ultra-default", effort: "high" }]);
    expect(schedule.entries[0]).toEqual({
      model: "model-ultra-default",
      effort: "high",
      phase: "warmup",
      round: 0,
      attempt: 1,
    });
    expect(schedule.entries.every((entry) => entry.effort !== ("ultra" as never))).toBe(true);
  });

  it.each([
    [{ seed: -1, maxTurns: 20 }, "seed"],
    [{ seed: 4_294_967_296, maxTurns: 20 }, "seed"],
    [{ seed: 1, maxTurns: 20, rounds: 0 }, "rounds"],
    [{ seed: 1, maxTurns: 200, rounds: 101, warmup: false }, "rounds"],
    [{ seed: 1, maxTurns: 0 }, "maxTurns"],
    [{ seed: 1, maxTurns: 201 }, "maxTurns"],
    [{ seed: 1, maxTurns: 20, models: ["missing"] }, "unavailable model"],
  ] as const)("rejects invalid scheduler boundary %s", (options, message) => {
    expect(() => buildSchedule(catalog, options)).toThrow(message);
  });

  it("rejects partially unmatched model and effort filters instead of silently shrinking them", () => {
    expect(() =>
      buildSchedule(catalog, {
        seed: 1,
        maxTurns: 20,
        models: ["model-alpha", "missing"],
      }),
    ).toThrow("model filter contains an unavailable model");
    expect(() =>
      buildSchedule(catalog, {
        seed: 1,
        maxTurns: 20,
        efforts: ["low", "max"],
      }),
    ).toThrow("effort filter contains an unavailable effort");
  });

  it("executes every planned trial strictly sequentially in schedule order", async () => {
    const schedule = buildSchedule(catalog, {
      seed: 7,
      maxTurns: 3,
      rounds: 1,
      warmup: false,
    });
    let active = 0;
    let maximumActive = 0;
    const started: string[] = [];

    const results = await executeSchedule(schedule, async (entry) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.push(`${entry.model}/${entry.effort}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return entry.round;
    });

    expect(maximumActive).toBe(1);
    expect(started).toEqual(
      schedule.entries.map((entry) => `${entry.model}/${entry.effort}`),
    );
    expect(results).toEqual([1, 1, 1]);
  });
});
