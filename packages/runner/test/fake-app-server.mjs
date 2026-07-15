import { createInterface } from "node:readline";

const scenario = process.argv[2] ?? "normal";
const expectedWorkspace = process.env.EXPECT_WORKSPACE ?? "/tmp/codexspeed-empty";
const outputWords = Array.from({ length: 112 }, (_, index) => `benchmark${index}`).join(" ");
const validOutput = [
  "## Summary",
  outputWords,
  "## Reasoning",
  outputWords,
  "## Trade-offs",
  outputWords,
  "## Recommendation",
  outputWords,
].join("\n\n");

let initialized = false;
let acknowledged = false;
let firstConcurrentRequest;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(id, message) {
  send({ id, error: { code: -32602, message } });
}

function assertInitialize(message) {
  const info = message.params?.clientInfo;
  if (
    info?.name !== "codexspeed" ||
    info?.title !== "CodexSpeed" ||
    info?.version !== "0.1.2" ||
    message.params?.capabilities?.experimentalApi !== true ||
    Object.keys(message.params.capabilities).length !== 1
  ) {
    fail(message.id, "unexpected initialize params");
    return false;
  }
  return true;
}

function assertThreadStart(message) {
  const params = message.params;
  const expected =
    params?.model === "gpt-test" &&
    params?.cwd === expectedWorkspace &&
    params?.approvalPolicy === "never" &&
    params?.sandbox === "read-only" &&
    params?.ephemeral === true &&
    params?.allowProviderModelFallback === false &&
    params?.serviceTier === "default" &&
    Array.isArray(params?.runtimeWorkspaceRoots) &&
    params.runtimeWorkspaceRoots.length === 1 &&
    params.runtimeWorkspaceRoots[0] === expectedWorkspace &&
    Array.isArray(params?.dynamicTools) &&
    params.dynamicTools.length === 0 &&
    Array.isArray(params?.environments) &&
    params.environments.length === 0 &&
    params?.config?.web_search === "disabled" &&
    params?.config?.features?.multi_agent === false &&
    typeof params?.baseInstructions === "string" &&
    params.baseInstructions.includes("Do not use tools");

  if (!expected) {
    fail(message.id, "unsafe thread/start params");
    return false;
  }
  return true;
}

function usage(
  threadId = "thread-active",
  turnId = "turn-active",
  outputTokens = 520,
  reasoningOutputTokens = 20,
) {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId,
      tokenUsage: {
        last: {
          inputTokens: 50,
          cachedInputTokens: 10,
          outputTokens,
          reasoningOutputTokens,
          totalTokens: 570,
        },
        total: {
          inputTokens: 9_000,
          cachedInputTokens: 8_000,
          outputTokens: 9_999,
          reasoningOutputTokens: 8_888,
          totalTokens: 18_999,
        },
        modelContextWindow: 100_000,
      },
    },
  };
}

function agentItem(id = "message-final") {
  return { id, type: "agentMessage", text: validOutput };
}

function commandItem() {
  return {
    id: "tool-one",
    type: "commandExecution",
    command: "forbidden",
    commandActions: [],
    cwd: expectedWorkspace,
    status: "completed",
  };
}

function complete(status = "completed") {
  const items = scenario === "current-protocol-items" ? [] : [agentItem()];
  if (scenario === "tool") items.push(commandItem());
  if (scenario === "multiple-message") items.push(agentItem("message-second"));

  send({
    method: "turn/completed",
    params: {
      threadId: "thread-active",
      turn: {
        id: "turn-active",
        status,
        items,
        ...(status === "failed" ? { error: { message: "synthetic failure" } } : {}),
      },
    },
  });
}

function streamTurn() {
  if (scenario === "turn-timeout") return;
  if (scenario === "protocol-after-turn") {
    process.stdout.write("{not-json}\n");
    return;
  }
  if (scenario === "exit-after-turn") {
    process.exit(23);
    return;
  }

  send({ method: "account/updated" });
  send(usage("thread-noise", "turn-noise"));
  send(usage("thread-active", "turn-noise"));
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-noise",
      turnId: "turn-noise",
      itemId: "message-noise",
      delta: "unrelated visible text",
    },
  });
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-active",
      turnId: "turn-noise",
      itemId: "message-noise",
      delta: "unrelated visible text",
    },
  });

  const output = scenario === "bad-output"
    ? validOutput.replace("## Trade-offs", "## Details")
    : scenario === "short-output"
      ? "## Summary\nshort\n## Reasoning\nshort\n## Trade-offs\nshort\n## Recommendation\nshort"
      : validOutput;
  const split = Math.floor(output.length / 2);
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "message-final",
      delta: output.slice(0, split),
    },
  });
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "message-final",
      delta: output.slice(split),
    },
  });

  if (scenario === "reroute") {
    send({
      method: "model/rerouted",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        fromModel: "gpt-test",
        toModel: "gpt-fallback",
        reason: "model_not_found",
      },
    });
  }

  if (scenario === "tool") {
    const item = commandItem();
    send({
      method: "item/started",
      params: { threadId: "thread-active", turnId: "turn-active", item, startedAtMs: 1 },
    });
    send({
      method: "item/completed",
      params: { threadId: "thread-active", turnId: "turn-active", item, completedAtMs: 2 },
    });
  }

  if (scenario === "current-protocol-items") {
    send({
      method: "item/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        item: agentItem(),
        completedAtMs: 2,
      },
    });
  }

  if (!new Set(["missing-usage", "late-usage", "failed-no-usage"]).has(scenario)) send(usage());
  complete(new Set(["failed", "failed-no-usage"]).has(scenario) ? "failed" : "completed");
  if (scenario === "late-usage") setTimeout(() => send(usage()), 5);
  if (scenario === "post-completion-usage") send(usage("thread-active", "turn-active", 777, 77));
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exitCode = 2;
    return;
  }

  if (message.method === "initialize") {
    if (!assertInitialize(message)) return;
    initialized = true;
    send({ id: message.id, result: { userAgent: "fake", platformFamily: "unix", platformOs: "test" } });
    return;
  }

  if (message.method === "initialized") {
    if (!initialized || message.id !== undefined) {
      process.exitCode = 3;
      return;
    }
    acknowledged = true;
    return;
  }

  if (!acknowledged) {
    fail(message.id, "not initialized");
    return;
  }

  if (message.method === "model/list") {
    if (scenario === "request-timeout") return;
    if (scenario === "malformed") {
      process.stdout.write("{not-json}\n");
      return;
    }
    if (scenario === "exit" || scenario === "stderr-exit") {
      if (scenario === "stderr-exit") {
        process.stderr.write(`${"x".repeat(50_000)}SHOULD_NOT_LEAK\n`);
      }
      process.exit(17);
      return;
    }
    if (scenario === "oversized") {
      process.stdout.write(`${JSON.stringify({ id: message.id, result: { value: "x".repeat(5_000) } })}\n`);
      return;
    }
    if (scenario === "catalog") {
      if (message.params?.cursor === undefined) {
        send({
          id: message.id,
          result: {
            data: [
              {
                id: "gpt-visible",
                model: "provider-internal-visible",
                displayName: "Visible Model",
                description: "must not escape",
                hidden: false,
                isDefault: true,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "Low" },
                  { reasoningEffort: "medium", description: "Medium" },
                ],
                secretFutureField: "must not escape",
              },
            ],
            nextCursor: "page-two",
            rawFutureField: "must not escape",
          },
        });
      } else {
        send({
          id: message.id,
          result: {
            data: [
              {
                id: "gpt-hidden",
                model: "provider-internal-hidden",
                displayName: "Hidden Model",
                description: "must not escape",
                hidden: true,
                isDefault: false,
                defaultReasoningEffort: "ultra",
                supportedReasoningEfforts: [
                  { reasoningEffort: "high", description: "High" },
                  { reasoningEffort: "ultra", description: "Ultra" },
                ],
              },
            ],
            nextCursor: null,
          },
        });
      }
      return;
    }

    send({
      id: message.id,
      result: {
        data: [
          {
            id: "gpt-test",
            model: "gpt-test",
            displayName: "GPT Test",
            description: "fake",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }

  if (message.method === "echo/one" || message.method === "echo/two") {
    if (firstConcurrentRequest === undefined) {
      firstConcurrentRequest = message;
    } else {
      send({ id: message.id, result: { value: message.method } });
      send({ id: firstConcurrentRequest.id, result: { value: firstConcurrentRequest.method } });
    }
    return;
  }

  if (message.method === "thread/start") {
    if (!assertThreadStart(message)) return;
    send({
      id: message.id,
      result: {
        thread: { id: "thread-active" },
        instructionSources: [],
        model: "gpt-test",
        modelProvider: "openai",
        cwd: expectedWorkspace,
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: { type: "readOnly" },
      },
    });
    return;
  }

  if (message.method === "turn/start") {
    const params = message.params;
    if (
      params?.threadId !== "thread-active" ||
      params?.model !== "gpt-test" ||
      params?.effort !== "medium" ||
      params?.serviceTier !== "default" ||
      !Array.isArray(params?.runtimeWorkspaceRoots) ||
      params.runtimeWorkspaceRoots.length !== 1 ||
      params.runtimeWorkspaceRoots[0] !== expectedWorkspace ||
      !Array.isArray(params?.environments) ||
      params.environments.length !== 0 ||
      !Array.isArray(params?.input) ||
      params.input.length !== 1 ||
      params.input[0]?.type !== "text" ||
      !params.input[0]?.text?.includes("## Recommendation")
    ) {
      fail(message.id, "unexpected turn/start params");
      return;
    }
    if (scenario === "turn-rpc-error") {
      fail(message.id, "synthetic turn rejection");
      return;
    }
    if (scenario === "turn-start-timeout") {
      setTimeout(() => {
        send({ id: message.id, result: { turn: { id: "turn-active", status: "inProgress", items: [] } } });
        streamTurn();
      }, 100);
      return;
    }
    send({ id: message.id, result: { turn: { id: "turn-active", status: "inProgress", items: [] } } });
    setTimeout(streamTurn, 5);
    return;
  }

  fail(message.id, `unknown method ${message.method}`);
});
