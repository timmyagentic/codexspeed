import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient, AppServerTimeoutError } from "./app-server.js";
import { BENCHMARK_PROMPT, validateOutput } from "./prompt.js";
import { recordTrial, type RecorderClock, type TrialResult } from "./recorder.js";

const fakeServer = fileURLToPath(new URL("../test/fake-app-server.mjs", import.meta.url));
const workspacePath = "/tmp/codexspeed-empty";
const clients = new Set<AppServerClient>();

function clock(): RecorderClock & { sleeps: number[] } {
  let time = 100;
  const sleeps: number[] = [];
  return {
    sleeps,
    now() {
      const current = time;
      time += 10;
      return current;
    },
    async sleep(milliseconds) {
      sleeps.push(milliseconds);
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
    },
  };
}

async function connect(scenario: string, turnTimeoutMs = 500): Promise<AppServerClient> {
  const client = await AppServerClient.connect({
    command: process.execPath,
    args: [fakeServer, scenario],
    env: { ...process.env, EXPECT_WORKSPACE: workspacePath },
    requestTimeoutMs: 500,
    turnTimeoutMs,
  });
  clients.add(client);
  return client;
}

async function run(scenario: string, recorderClock = clock()): Promise<TrialResult> {
  const client = await connect(scenario);
  return recordTrial(
    client,
    { model: "gpt-test", effort: "medium", workspacePath },
    recorderClock,
  );
}

afterEach(async () => {
  await Promise.all([...clients].map(async (client) => client.close()));
  clients.clear();
});

describe("BENCHMARK_PROMPT", () => {
  it("is fixed, public, tool-free, and requests the validated response shape", () => {
    expect(BENCHMARK_PROMPT).toContain("Do not use tools");
    expect(BENCHMARK_PROMPT).toContain("at least 400 words");
    expect(BENCHMARK_PROMPT).toContain("## Summary");
    expect(BENCHMARK_PROMPT).toContain("## Recommendation");
  });
});

describe("validateOutput", () => {
  const words = Array.from({ length: 410 }, (_, index) => `word${index}`).join(" ");
  const valid = [
    "## Summary",
    words,
    "## Reasoning",
    "substantive section",
    "## Trade-offs",
    "substantive section",
    "## Recommendation",
    "substantive section",
  ].join("\n\n");

  it.each([
    ["", { passed: false, reason: "missing_output" }],
    [valid.replace(words, "too short"), { passed: false, reason: "too_short" }],
    [valid.replace("## Trade-offs", "## Details"), { passed: false, reason: "bad_structure" }],
    [valid, { passed: true, reason: "ok" }],
  ] as const)("classifies structural output without retaining it", (output, expected) => {
    expect(validateOutput(output)).toEqual(expected);
  });
});

describe("recordTrial", () => {
  it("records only matching events, relative timings, tokenUsage.last, and a sanitized result", async () => {
    const result = await run("normal");

    expect(result).toEqual({
      status: "completed",
      firstVisibleTextMs: 10,
      lastVisibleTextMs: 20,
      totalLatencyMs: 30,
      outputTokens: 520,
      reasoningOutputTokens: 20,
      agentMessageCount: 1,
      toolEventCount: 0,
      reroutedTo: null,
      validatorPassed: true,
      validatorReason: "ok",
      errorCode: null,
    });
    expect(result.outputTokens).not.toBe(9_999);
    expect(JSON.stringify(result)).not.toContain("benchmark0");
    expect(Object.keys(result)).not.toContain("text");
  });

  it("deduplicates tool lifecycle events and records reroutes", async () => {
    const [tool, reroute] = await Promise.all([run("tool"), run("reroute")]);

    expect(tool.toolEventCount).toBe(1);
    expect(reroute.reroutedTo).toBe("gpt-fallback");
  });

  it("records a completed turn's non-success status as a stable failure", async () => {
    await expect(run("failed")).resolves.toMatchObject({
      status: "failed",
      errorCode: "turn_failed",
    });
  });

  it("counts final agent messages from the completed turn", async () => {
    await expect(run("multiple-message")).resolves.toMatchObject({ agentMessageCount: 2 });
  });

  it.each([
    ["bad-output", "bad_structure"],
    ["short-output", "too_short"],
  ] as const)("records validator result for %s", async (scenario, validatorReason) => {
    await expect(run(scenario)).resolves.toMatchObject({
      validatorPassed: false,
      validatorReason,
    });
  });

  it("waits up to one second for late matching token usage only when needed", async () => {
    const recorderClock = clock();

    const result = await run("late-usage", recorderClock);

    expect(recorderClock.sleeps).toEqual([1_000]);
    expect(result).toMatchObject({
      status: "completed",
      outputTokens: 520,
      reasoningOutputTokens: 20,
      errorCode: null,
    });
  });

  it("keeps the newest matching snapshot observed before completion", async () => {
    await expect(run("post-completion-usage")).resolves.toMatchObject({
      outputTokens: 520,
      reasoningOutputTokens: 20,
    });
  });

  it("reports missing token usage after the bounded grace window", async () => {
    const recorderClock = clock();

    const result = await run("missing-usage", recorderClock);

    expect(recorderClock.sleeps).toEqual([1_000]);
    expect(result).toMatchObject({
      status: "failed",
      outputTokens: 0,
      reasoningOutputTokens: 0,
      errorCode: "missing_token_usage",
    });
  });

  it("returns stable timeout and protocol failures after turn/start", async () => {
    const timeoutClient = await connect("turn-timeout", 20);
    const protocolClient = await connect("protocol-after-turn");
    const exitClient = await connect("exit-after-turn");
    const rpcClient = await connect("turn-rpc-error");
    const startTimeoutClient = await connect("turn-start-timeout", 20);

    const request = { model: "gpt-test", effort: "medium" as const, workspacePath };
    const [timeout, protocol, exited, rpc, startTimeout] = await Promise.all([
      recordTrial(timeoutClient, request, clock()),
      recordTrial(protocolClient, request, clock()),
      recordTrial(exitClient, request, clock()),
      recordTrial(rpcClient, request, clock()),
      recordTrial(startTimeoutClient, request, clock()),
    ]);

    expect(timeout).toMatchObject({ status: "failed", errorCode: "timeout" });
    await expect(timeoutClient.request("model/list", {})).rejects.toBeInstanceOf(
      AppServerTimeoutError,
    );
    expect(protocol).toMatchObject({ status: "failed", errorCode: "protocol_error" });
    expect(exited).toMatchObject({ status: "failed", errorCode: "protocol_error" });
    expect(rpc).toMatchObject({ status: "failed", errorCode: "protocol_error" });
    expect(startTimeout).toMatchObject({ status: "failed", errorCode: "timeout" });
    await expect(startTimeoutClient.request("model/list", {})).rejects.toBeInstanceOf(
      AppServerTimeoutError,
    );
  });
});
