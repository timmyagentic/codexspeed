import type { DiscoveredCatalog } from "../catalog.js";
import { discoverCatalog } from "../catalog.js";
import { AppServerProtocolError, type AppServerClient } from "../app-server.js";
import { RunnerRuntimeError, withIsolatedRuntime, type RuntimeOptions } from "../runtime.js";

const DOCTOR_INSTRUCTIONS =
  "Do not start a model turn. Do not use tools, commands, files, web search, MCP, plugins, skills, subagents, or environment access.";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function comparableCellCount(catalog: DiscoveredCatalog): number {
  return catalog.models.reduce(
    (total, model) =>
      total +
      (model.hidden ? 0 : model.supportedEfforts.filter((effort) => effort !== "ultra").length),
    0,
  );
}

async function verifyInstructionSafety(
  client: AppServerClient,
  workspacePath: string,
  model: string,
): Promise<void> {
  const response: unknown = await client.request("thread/start", {
    model,
    cwd: workspacePath,
    runtimeWorkspaceRoots: [workspacePath],
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    dynamicTools: [],
    environments: [],
    allowProviderModelFallback: false,
    serviceTier: "default",
    config: { web_search: "disabled", features: { multi_agent: false } },
    baseInstructions: DOCTOR_INSTRUCTIONS,
  });
  if (!isObject(response) || !isObject(response["thread"])) {
    throw new AppServerProtocolError("doctor received an invalid thread response");
  }
  const sources = response["instructionSources"];
  if (!Array.isArray(sources) || sources.length !== 0) {
    throw new AppServerProtocolError("doctor found benchmark instruction sources");
  }
}

function parseVersion(output: { stdout: string; stderr: string }): string {
  const match = /\bcodex(?:-cli)?\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/i.exec(
    `${output.stdout}\n${output.stderr}`,
  );
  if (match?.[1] === undefined) throw new RunnerRuntimeError("Codex CLI version is unavailable");
  return match[1];
}

export async function runDoctor(options: RuntimeOptions): Promise<string[]> {
  return withIsolatedRuntime(options, async (runtime) => {
    const version = parseVersion(await runtime.runCodex(["--version"]));
    const login = await runtime.runCodex(["login", "status"]);
    if (!/Logged in using ChatGPT/i.test(`${login.stdout}\n${login.stderr}`)) {
      throw new RunnerRuntimeError("ChatGPT login is unavailable");
    }

    const client = await runtime.connect();
    try {
      const catalog = await discoverCatalog(client);
      const comparableCells = comparableCellCount(catalog);
      if (comparableCells === 0) {
        throw new AppServerProtocolError("model catalog has no comparable cells");
      }
      const safetyModel = catalog.models.find(
        (model) => !model.hidden && model.supportedEfforts.some((effort) => effort !== "ultra"),
      )!;
      await verifyInstructionSafety(client, runtime.workspacePath, safetyModel.id);
      return [
        `Codex CLI: ${version}`,
        "ChatGPT login: ok",
        "App Server protocol: ok",
        `Model catalog: ${catalog.models.length} models, ${comparableCells} comparable cell${comparableCells === 1 ? "" : "s"}`,
        "Instruction sources: none",
        "Doctor: ready",
      ];
    } finally {
      await client.close();
    }
  });
}
