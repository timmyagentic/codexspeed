import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { RunUploadSchema } from "@codexspeed/contracts";

import { runCli } from "./cli.js";

const fakeCodex = fileURLToPath(
  new URL("../test/fake-codex-cli.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codexspeed-measure-test-"));
  temporaryDirectories.push(directory);
  const authPath = join(directory, "auth.json");
  await writeFile(authPath, "{}", { mode: 0o600 });
  return { directory, authPath };
}

afterEach(async () => {
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

describe("codexspeed measure", () => {
  it("shows help and version without touching Codex", async () => {
    const help = output();
    const version = output();

    expect(await runCli(["--help"], { io: help.io })).toBe(0);
    expect(help.stdout).toContain(
      "  codexspeed measure     Test this device and network",
    );
    expect(await runCli(["--version"], { io: version.io })).toBe(0);
    expect(version.stdout).toEqual(["CodexSpeed 0.2.0"]);
  });

  it("defaults to one model cell, one warm-up, and three measured turns", async () => {
    const { directory, authPath } = await fixture();
    const captured = output();
    const answers = ["", "", "n"];

    const exitCode = await runCli([], {
      io: captured.io,
      readInput: async () => answers.shift() ?? null,
      codexCommand: process.execPath,
      codexArguments: [fakeCodex, "run"],
      authPath,
      temporaryParent: directory,
    });

    expect(exitCode).toBe(0);
    expect(captured.stdout).toContain(
      "Plan: 1 warm-up + 3 measured = 4 real Codex turns",
    );
    expect(captured.stdout.at(-1)).toBe("Cancelled; no model turns started.");
    expect(await readdir(directory)).toEqual(["auth.json"]);
  });

  it("refuses EOF or non-interactive execution without exact turn acceptance", async () => {
    const { directory, authPath } = await fixture();
    const artifactPath = join(directory, "must-not-exist.json");
    const captured = output();

    const exitCode = await runCli(
      [
        "measure",
        "--model",
        "gpt-test",
        "--effort",
        "medium",
        "--rounds",
        "1",
        "--out",
        artifactPath,
      ],
      {
        io: captured.io,
        readInput: async () => null,
        codexCommand: process.execPath,
        codexArguments: [fakeCodex, "run"],
        authPath,
        temporaryParent: directory,
      },
    );

    expect(exitCode).toBe(2);
    expect(captured.stderr).toEqual([
      "Error: confirmation unavailable; rerun with --accept-turns 2 after reviewing the plan",
    ]);
    await expect(access(artifactPath)).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["auth.json"]);
  });

  it("requires non-interactive acceptance to match the exact plan", async () => {
    const { directory, authPath } = await fixture();
    const artifactPath = join(directory, "must-not-exist.json");
    const captured = output();

    const exitCode = await runCli(
      [
        "measure",
        "--model",
        "gpt-test",
        "--effort",
        "medium",
        "--rounds",
        "1",
        "--accept-turns",
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
      },
    );

    expect(exitCode).toBe(2);
    expect(captured.stderr).toEqual([
      "Error: --accept-turns must equal the planned 2 turns",
    ]);
    await expect(access(artifactPath)).rejects.toThrow();
  });

  it("runs an exactly accepted local benchmark and prints its result", async () => {
    const { directory, authPath } = await fixture();
    const artifactPath = join(directory, "local-result.json");
    const captured = output();
    const ids = [
      "01900000-0000-7000-8000-000000000100",
      "01900000-0000-7000-8000-000000000101",
      "01900000-0000-7000-8000-000000000102",
    ];
    const dates = [
      new Date("2026-07-16T12:00:00.000Z"),
      new Date("2026-07-16T12:01:00.000Z"),
    ];

    const exitCode = await runCli(
      [
        "measure",
        "--model",
        "gpt-test",
        "--effort",
        "medium",
        "--rounds",
        "1",
        "--accept-turns",
        "2",
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
    expect(captured.stdout).toContain(
      "Visible stream speed (estimated): unavailable",
    );
    expect(captured.stdout).toContain(
      "Reliability: 1/1 measured samples valid",
    );
    expect(captured.stdout.at(-1)).toBe("Nothing was uploaded.");
    const run = RunUploadSchema.parse(
      JSON.parse(await readFile(artifactPath, "utf8")),
    );
    expect(run.selection).toMatchObject({
      cells: [{ model: "gpt-test", effort: "medium" }],
      warmupPerModel: 1,
      measuredRounds: 1,
      maxTurns: 2,
    });
    expect(run.samples).toHaveLength(2);
  });
});
