import {
  readFile,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunUploadSchema } from "@codexspeed/contracts";
import { runCli } from "./cli.js";
import { BENCHMARK_PROMPT, BENCHMARK_PROMPT_SHA256 } from "./prompt.js";
import { createUuidV7 } from "./commands/run.js";
import { RUNNER_VERSION } from "./version.js";

const fakeCodex = fileURLToPath(
  new URL("../test/fake-codex-cli.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function temporaryAuth() {
  const directory = await mkdtemp(join(tmpdir(), "codexspeed-cli-test-"));
  temporaryDirectories.push(directory);
  const authPath = join(directory, "auth.json");
  await writeFile(authPath, "{}", { mode: 0o600 });
  return { directory, authPath };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("codexspeed CLI", () => {
  it("uses one runner version in package metadata and public artifacts", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(packageJson.version).toBe(RUNNER_VERSION);
    expect(RUNNER_VERSION).toBe("0.1.0");
  });

  it("creates canonical UUIDv7 identifiers with timestamp, version, and variant bits", () => {
    expect(createUuidV7(0x0190_0000_0000, Buffer.alloc(16, 0xff))).toBe(
      "01900000-0000-7fff-bfff-ffffffffffff",
    );
  });

  it("requires the explicit max-turn guard before planning anything", async () => {
    const captured = output();

    const exitCode = await runCli(["plan"], { io: captured.io });

    expect(exitCode).toBe(2);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr).toEqual(["Error: --max-turns is required"]);
  });

  it.each([
    [
      ["plan", "--max-turns", "0"],
      "Error: --max-turns must be an integer from 1 through 200",
    ],
    [
      ["plan", "--max-turns", "1", "--rounds", "0"],
      "Error: --rounds must be an integer from 1 through 100",
    ],
    [
      ["plan", "--max-turns", "1", "--seed", "-1"],
      "Error: --seed must be an unsigned 32-bit integer",
    ],
    [
      ["plan", "--max-turns", "1", "--effort", "ultra"],
      "Error: --effort must be comparable",
    ],
    [["run", "--max-turns", "1"], "Error: --out is required"],
    [["doctor", "--model", "x"], "Error: doctor accepts no options"],
  ] as const)(
    "rejects unsafe arguments for %s",
    async (arguments_, expected) => {
      const captured = output();

      const exitCode = await runCli(arguments_, { io: captured.io });

      expect(exitCode).toBe(2);
      expect(captured.stdout).toEqual([]);
      expect(captured.stderr).toEqual([expected]);
    },
  );

  it("runs a live-style doctor in an isolated home without starting a model turn", async () => {
    const { directory, authPath } = await temporaryAuth();
    const captured = output();

    const exitCode = await runCli(["doctor"], {
      io: captured.io,
      codexCommand: process.execPath,
      codexArguments: [fakeCodex, "doctor"],
      authPath,
      temporaryParent: directory,
    });

    expect(exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout).toEqual([
      "Codex CLI: 0.144.1",
      "ChatGPT login: ok",
      "App Server protocol: ok",
      "Model catalog: 2 models, 1 comparable cell",
      "Instruction sources: none",
      "Doctor: ready",
    ]);
    expect(await readdir(directory)).toEqual(["auth.json"]);
  });

  it("accepts exactly one package-manager argument separator for documented commands", async () => {
    const { directory, authPath } = await temporaryAuth();
    const doctor = output();
    const plan = output();
    const dependencies = {
      codexCommand: process.execPath,
      codexArguments: [fakeCodex, "doctor"],
      authPath,
      temporaryParent: directory,
    };

    expect(
      await runCli(["--", "doctor"], { ...dependencies, io: doctor.io }),
    ).toBe(0);
    expect(
      await runCli(["--", "plan", "--model", "gpt-test", "--max-turns", "4"], {
        ...dependencies,
        io: plan.io,
      }),
    ).toBe(0);
    expect(doctor.stderr).toEqual([]);
    expect(plan.stderr).toEqual([]);

    const doubled = output();
    expect(await runCli(["--", "--", "doctor"], { io: doubled.io })).toBe(2);
    expect(doubled.stderr).toEqual([
      "Error: command must be doctor, plan, run, or publish",
    ]);
  });

  it("reports known safe doctor failures without exposing the authentication path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexspeed-cli-test-"));
    temporaryDirectories.push(directory);
    const missingAuthPath = join(
      directory,
      "private-account-name",
      "auth.json",
    );
    const captured = output();

    const exitCode = await runCli(["doctor"], {
      io: captured.io,
      authPath: missingAuthPath,
      temporaryParent: directory,
    });

    expect(exitCode).toBe(1);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr).toEqual([
      "Error: ChatGPT authentication is unavailable",
    ]);
    expect(captured.stderr.join(" ")).not.toContain(missingAuthPath);
    expect(captured.stderr.join(" ")).not.toContain("private-account-name");
  });

  it("prints the exact seeded plan without starting a model turn", async () => {
    const { directory, authPath } = await temporaryAuth();
    const captured = output();

    const exitCode = await runCli(["plan", "--seed", "7", "--max-turns", "4"], {
      io: captured.io,
      codexCommand: process.execPath,
      codexArguments: [fakeCodex, "plan"],
      authPath,
      temporaryParent: directory,
    });

    expect(exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout).toEqual([
      "Seed: 7",
      "Mode: full",
      "Comparable cells: 1",
      "Cell 1: gpt-test / medium",
      "Warm-up turns: 1",
      "Measured turns: 3",
      "Total turns: 4 / max 4",
      "Turn 1: warmup gpt-test / medium (round 0)",
      "Turn 2: measured gpt-test / medium (round 1)",
      "Turn 3: measured gpt-test / medium (round 2)",
      "Turn 4: measured gpt-test / medium (round 3)",
    ]);
    expect(await readdir(directory)).toEqual(["auth.json"]);
  });

  it("preserves standard proxy trust settings but strips credential environment variables", async () => {
    const { directory, authPath } = await temporaryAuth();
    const captured = output();
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:43210");
    vi.stubEnv("no_proxy", "localhost,127.0.0.1");
    vi.stubEnv("SSL_CERT_FILE", "/tmp/codexspeed-test-ca.pem");
    vi.stubEnv("OPENAI_API_KEY", "must-not-reach-child");
    vi.stubEnv("CODEX_ACCESS_TOKEN", "must-not-reach-child");

    const exitCode = await runCli(["doctor"], {
      io: captured.io,
      codexCommand: process.execPath,
      codexArguments: [fakeCodex, "proxy"],
      authPath,
      temporaryParent: directory,
    });

    expect(exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout.at(-1)).toBe("Doctor: ready");
  });

  it("runs one bounded smoke turn and writes only a validated compact owner-only artifact", async () => {
    const { directory, authPath } = await temporaryAuth();
    const artifactPath = join(directory, "run.json");
    const captured = output();
    const ids = [
      "01900000-0000-7000-8000-000000000010",
      "01900000-0000-7000-8000-000000000011",
    ];
    const dates = [
      new Date("2026-07-16T08:00:00.000Z"),
      new Date("2026-07-16T08:01:00.000Z"),
    ];

    const exitCode = await runCli(
      [
        "run",
        "--model",
        "gpt-test",
        "--effort",
        "medium",
        "--rounds",
        "1",
        "--no-warmup",
        "--seed",
        "17",
        "--max-turns",
        "1",
        "--out",
        artifactPath,
      ],
      {
        io: captured.io,
        codexCommand: process.execPath,
        codexArguments: [fakeCodex, "run"],
        authPath,
        temporaryParent: directory,
        now: () => dates.shift()!,
        idFactory: () => ids.shift()!,
        publicEnvironment: {
          osFamily: "macos",
          osVersion: "15.5",
          architecture: "arm64",
          region: "east-asia",
          authChannel: "chatgpt",
          serviceTier: "default",
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout).toEqual([
      "Seed: 17",
      "Mode: smoke",
      "Comparable cells: 1",
      "Cell 1: gpt-test / medium",
      "Warm-up turns: 0",
      "Measured turns: 1",
      "Total turns: 1 / max 1",
      "Turn 1: measured gpt-test / medium (round 1)",
      "Starting turn 1/1: measured gpt-test / medium (round 1); remaining 1",
      "Finished turn 1/1: completed; remaining 0",
      "Artifact written",
    ]);

    const bytes = await readFile(artifactPath, "utf8");
    const run = RunUploadSchema.parse(JSON.parse(bytes));
    expect(bytes).toBe(JSON.stringify(run));
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
    expect(run).toMatchObject({
      runId: "01900000-0000-7000-8000-000000000010",
      startedAt: "2026-07-16T08:00:00.000Z",
      endedAt: "2026-07-16T08:01:00.000Z",
      mode: "smoke",
      seed: 17,
      status: "completed",
      codexCliVersion: "0.144.1",
      runnerVersion: RUNNER_VERSION,
      prompt: { id: "codexspeed-prompt-v1", sha256: BENCHMARK_PROMPT_SHA256 },
      selection: { warmupPerModel: 0, measuredRounds: 1, maxTurns: 1 },
      samples: [
        {
          sampleId: "01900000-0000-7000-8000-000000000011",
          model: "gpt-test",
          effort: "medium",
          phase: "measured",
          round: 1,
          status: "completed",
          outputTokens: 520,
          reasoningOutputTokens: 20,
        },
      ],
    });
    expect(run.catalog.models).toEqual([
      {
        id: "gpt-test",
        displayName: "GPT Test",
        hidden: false,
        defaultEffort: "medium",
        supportedEfforts: ["medium", "ultra"],
      },
      {
        id: "gpt-hidden",
        displayName: "Hidden",
        hidden: true,
        defaultEffort: "ultra",
        supportedEfforts: ["ultra"],
      },
    ]);
    expect(Object.keys(run.environment)).toEqual([
      "osFamily",
      "osVersion",
      "architecture",
      "region",
      "authChannel",
      "serviceTier",
    ]);
    expect(bytes).not.toContain(BENCHMARK_PROMPT);
    expect(bytes).not.toContain("benchmark0");
    expect(bytes).not.toContain(directory);
    expect(bytes).not.toContain("must-not-escape");
    expect(await readdir(directory)).toEqual(["auth.json", "run.json"]);
  });

  it("fully terminates a timed-out App Server and reconnects before the next sequential sample", async () => {
    const { directory, authPath } = await temporaryAuth();
    const artifactPath = join(directory, "timeout-run.json");
    const statePath = join(directory, "server-count");
    const captured = output();
    const ids = [
      "01900000-0000-7000-8000-000000000020",
      "01900000-0000-7000-8000-000000000021",
      "01900000-0000-7000-8000-000000000022",
    ];
    const dates = [
      new Date("2026-07-16T09:00:00.000Z"),
      new Date("2026-07-16T09:01:00.000Z"),
    ];

    const exitCode = await runCli(
      [
        "run",
        "--model",
        "gpt-test",
        "--effort",
        "medium",
        "--rounds",
        "2",
        "--no-warmup",
        "--max-turns",
        "2",
        "--out",
        artifactPath,
      ],
      {
        io: captured.io,
        codexCommand: process.execPath,
        codexArguments: [fakeCodex, "timeout-recover", statePath],
        authPath,
        temporaryParent: directory,
        appServerOptions: { requestTimeoutMs: 500, turnTimeoutMs: 30 },
        now: () => dates.shift()!,
        idFactory: () => ids.shift()!,
        publicEnvironment: {
          osFamily: "macos",
          osVersion: "15.5",
          architecture: "arm64",
          region: "east-asia",
          authChannel: "chatgpt",
          serviceTier: "default",
        },
      },
    );

    expect(exitCode).toBe(0);
    const run = RunUploadSchema.parse(
      JSON.parse(await readFile(artifactPath, "utf8")),
    );
    expect(run.status).toBe("completed");
    expect(run.samples).toHaveLength(2);
    expect(run.samples[0]).toMatchObject({
      status: "failed",
      errorCode: "timeout",
    });
    expect(run.samples[1]).toMatchObject({
      status: "completed",
      errorCode: null,
    });
    expect(await readFile(statePath, "utf8")).toBe("2");
    expect(captured.stdout).toContain("Finished turn 1/2: failed; remaining 1");
    expect(captured.stdout).toContain(
      "Finished turn 2/2: completed; remaining 0",
    );
  });

  it("keeps the repository prompt document byte-locked to the executed prompt", async () => {
    const document = await readFile(
      new URL("../../../docs/methodology/prompt-v1.md", import.meta.url),
      "utf8",
    );

    expect(document).toBe(`${BENCHMARK_PROMPT}\n`);
    expect(
      createHash("sha256").update(BENCHMARK_PROMPT, "utf8").digest("hex"),
    ).toBe(BENCHMARK_PROMPT_SHA256);
  });
});
