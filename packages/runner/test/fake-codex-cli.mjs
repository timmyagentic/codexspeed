import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";

const scenario = process.argv[2] ?? "normal";
let argumentIndex = 3;
let statePath;
if (scenario === "timeout-recover") {
  statePath = process.argv[argumentIndex++];
}
const command = process.argv[argumentIndex];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(71);
}

function assertIsolatedEnvironment() {
  for (const forbidden of [
    "CODEX_ACCESS_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_CONFIG",
    "CODEX_SKILLS",
  ]) {
    if (process.env[forbidden] !== undefined) fail(`forbidden environment: ${forbidden}`);
  }
  const codexHome = process.env.CODEX_HOME;
  if (!codexHome || process.env.CODEX_SQLITE_HOME !== codexHome) fail("unsafe Codex home");
  if (process.env.HOME === undefined || process.env.HOME === codexHome) fail("unsafe HOME");
  if ((statSync(codexHome).mode & 0o777) !== 0o700) fail("unsafe Codex home mode");
  const authPath = `${codexHome}/auth.json`;
  if (readdirSync(codexHome).join("\n") !== "auth.json") fail("Codex home was not auth-only");
  if ((statSync(authPath).mode & 0o777) !== 0o600) fail("unsafe auth mode");
  if (readFileSync(authPath, "utf8") !== "{}") fail("wrong auth material");
  if (
    scenario === "proxy" &&
    (process.env.HTTPS_PROXY !== "http://127.0.0.1:43210" ||
      process.env.no_proxy !== "localhost,127.0.0.1" ||
      process.env.SSL_CERT_FILE !== "/tmp/codexspeed-test-ca.pem")
  ) {
    fail("proxy environment was not preserved");
  }
}

assertIsolatedEnvironment();

if (command === "--version") {
  process.stdout.write("codex-cli 0.144.1\n");
  process.exit(0);
}

if (command === "login" && process.argv[argumentIndex + 1] === "status") {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}

if (command !== "app-server") fail("unexpected command");

let serverNumber = 1;
if (statePath !== undefined) {
  const activePath = `${statePath}.active`;
  if (existsSync(activePath)) fail("App Server instances overlapped");
  try {
    serverNumber = Number(readFileSync(statePath, "utf8")) + 1;
  } catch {
    serverNumber = 1;
  }
  writeFileSync(statePath, String(serverNumber), { mode: 0o600 });
  writeFileSync(activePath, String(serverNumber), { mode: 0o600 });
  process.on("exit", () => {
    try {
      unlinkSync(activePath);
    } catch {}
  });
  process.on("SIGTERM", () => {
    try {
      unlinkSync(activePath);
    } catch {}
    process.exit(0);
  });
}

let initialized = false;
let acknowledged = false;
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

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcError(id, message) {
  send({ id, error: { code: -32602, message } });
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    if (message.params?.clientInfo?.version !== "0.1.2") {
      rpcError(message.id, "wrong runner version");
      return;
    }
    initialized = true;
    send({ id: message.id, result: { userAgent: "fake", platformFamily: "unix", platformOs: "test" } });
    return;
  }
  if (message.method === "initialized") {
    if (!initialized) fail("initialized before initialize");
    acknowledged = true;
    return;
  }
  if (!acknowledged) {
    rpcError(message.id, "not initialized");
    return;
  }
  if (message.method === "model/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            id: "gpt-test",
            displayName: "GPT Test",
            hidden: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "ultra", description: "Ultra" },
            ],
            futurePrivateField: "must-not-escape",
          },
          {
            id: "gpt-hidden",
            displayName: "Hidden",
            hidden: true,
            defaultReasoningEffort: "ultra",
            supportedReasoningEfforts: [{ reasoningEffort: "ultra", description: "Ultra" }],
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }
  if (message.method === "thread/start") {
    const workspace = message.params?.cwd;
    if (
      typeof workspace !== "string" ||
      (statSync(workspace).mode & 0o777) !== 0o700 ||
      message.params?.model !== "gpt-test" ||
      message.params?.sandbox !== "read-only" ||
      message.params?.approvalPolicy !== "never" ||
      message.params?.ephemeral !== true ||
      message.params?.allowProviderModelFallback !== false ||
      message.params?.serviceTier !== "default" ||
      message.params?.config?.web_search !== "disabled" ||
      message.params?.config?.features?.multi_agent !== false ||
      message.params?.dynamicTools?.length !== 0 ||
      message.params?.environments?.length !== 0
    ) {
      rpcError(message.id, "unsafe thread/start");
      return;
    }
    send({
      id: message.id,
      result: { thread: { id: "thread-active" }, instructionSources: [] },
    });
    return;
  }
  if (message.method === "turn/start") {
    if (scenario === "doctor" || scenario === "plan") fail("unexpected model turn");
    if (scenario === "timeout-recover" && serverNumber === 1) return;
    send({ id: message.id, result: { turn: { id: "turn-active", status: "inProgress", items: [] } } });
    send({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        itemId: "message-final",
        delta: validOutput,
      },
    });
    send({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        tokenUsage: {
          last: { outputTokens: 520, reasoningOutputTokens: 20 },
          total: { outputTokens: 9_999, reasoningOutputTokens: 8_888 },
        },
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turn: {
          id: "turn-active",
          status: "completed",
          items: [{ id: "message-final", type: "agentMessage", text: validOutput }],
        },
      },
    });
    return;
  }
  rpcError(message.id, "unexpected method");
});
