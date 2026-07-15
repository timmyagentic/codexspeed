import type { RunSample } from "@codexspeed/contracts";
import {
  AppServerError,
  AppServerProtocolError,
  AppServerTimeoutError,
  type AppServerClient,
  type AppServerNotification,
} from "./app-server.js";
import { BENCHMARK_PROMPT, validateOutput } from "./prompt.js";

const TOKEN_USAGE_GRACE_MS = 1_000;
const MINIMUM_VISIBLE_TOKENS = 400;
const BENCHMARK_BASE_INSTRUCTIONS =
  "Follow the user prompt exactly. Do not use tools, commands, files, web search, MCP, apps, plugins, skills, subagents, or environment access. Produce only the requested answer.";

type TrialField =
  | "status"
  | "firstVisibleTextMs"
  | "lastVisibleTextMs"
  | "totalLatencyMs"
  | "outputTokens"
  | "reasoningOutputTokens"
  | "agentMessageCount"
  | "toolEventCount"
  | "reroutedTo"
  | "validatorPassed"
  | "validatorReason"
  | "errorCode";

export type TrialResult = Pick<RunSample, TrialField>;

export type TrialRequest = {
  model: string;
  effort: RunSample["effort"];
  workspacePath: string;
};

export type RecorderClock = {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
};

export const systemRecorderClock: RecorderClock = {
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

type JsonObject = Record<string, unknown>;
type TokenSnapshot = { outputTokens: number; reasoningOutputTokens: number };
type Completion = { status: string; receivedAt: number; turn: JsonObject };
type BufferedNotification = { notification: AppServerNotification; receivedAt: number | null };

const NON_TOOL_ITEM_TYPES = new Set([
  "userMessage",
  "agentMessage",
  "plan",
  "reasoning",
  "contextCompaction",
  "enteredReviewMode",
  "exitedReviewMode",
]);
const RECORDED_NOTIFICATION_METHODS = new Set([
  "item/agentMessage/delta",
  "thread/tokenUsage/updated",
  "model/rerouted",
  "item/started",
  "item/completed",
  "turn/completed",
]);

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredObject(value: unknown, field: string): JsonObject {
  if (!isObject(value)) throw new AppServerProtocolError(`App Server returned invalid ${field}`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppServerProtocolError(`App Server returned invalid ${field}`);
  }
  return value;
}

function nonNegativeToken(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AppServerProtocolError("App Server returned invalid token usage");
  }
  return value as number;
}

function elapsed(startedAt: number, receivedAt: number): number {
  const duration = receivedAt - startedAt;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new AppServerProtocolError("Monotonic clock moved backwards");
  }
  return duration;
}

function itemIdentity(item: JsonObject): { id: string; type: string } {
  return {
    id: requiredString(item["id"], "item ID"),
    type: requiredString(item["type"], "item type"),
  };
}

function isToolLike(type: string): boolean {
  return !NON_TOOL_ITEM_TYPES.has(type);
}

function failureResult(
  errorCode: NonNullable<RunSample["errorCode"]>,
  totalLatencyMs: number,
  outputText: string,
  state: {
    firstVisibleTextMs: number | null;
    lastVisibleTextMs: number | null;
    tokenSnapshot: TokenSnapshot | null;
    agentMessageIds: Set<string>;
    toolItemIds: Set<string>;
    reroutedTo: string | null;
  },
): TrialResult {
  const validation = validateOutput(outputText);
  return {
    status: "failed",
    firstVisibleTextMs: state.firstVisibleTextMs,
    lastVisibleTextMs: state.lastVisibleTextMs,
    totalLatencyMs,
    outputTokens: state.tokenSnapshot?.outputTokens ?? 0,
    reasoningOutputTokens: state.tokenSnapshot?.reasoningOutputTokens ?? 0,
    agentMessageCount: state.agentMessageIds.size,
    toolEventCount: state.toolItemIds.size,
    reroutedTo: state.reroutedTo,
    validatorPassed: validation.passed,
    validatorReason: validation.reason,
    errorCode,
  };
}

export async function recordTrial(
  client: AppServerClient,
  request: TrialRequest,
  clock: RecorderClock = systemRecorderClock,
): Promise<TrialResult> {
  const threadResponse: unknown = await client.request("thread/start", {
    model: request.model,
    cwd: request.workspacePath,
    runtimeWorkspaceRoots: [request.workspacePath],
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    dynamicTools: [],
    environments: [],
    allowProviderModelFallback: false,
    serviceTier: "default",
    config: {
      web_search: "disabled",
      features: { multi_agent: false },
    },
    baseInstructions: BENCHMARK_BASE_INSTRUCTIONS,
  });
  const threadObject = requiredObject(threadResponse, "thread/start response");
  const thread = requiredObject(threadObject["thread"], "thread");
  const threadId = requiredString(thread["id"], "thread ID");
  if (
    threadObject["instructionSources"] !== undefined &&
    (!Array.isArray(threadObject["instructionSources"]) ||
      threadObject["instructionSources"].length !== 0)
  ) {
    throw new AppServerProtocolError("benchmark thread loaded instruction sources");
  }

  let activeTurnId: string | null = null;
  let firstVisibleTextMs: number | null = null;
  let lastVisibleTextMs: number | null = null;
  let tokenSnapshot: TokenSnapshot | null = null;
  let reroutedTo: string | null = null;
  let outputText = "";
  const agentMessageIds = new Set<string>();
  const toolItemIds = new Set<string>();
  const buffered: BufferedNotification[] = [];
  let resolveCompletion!: (completion: Completion) => void;
  let rejectCompletion!: (error: Error) => void;
  const completionPromise = new Promise<Completion>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  let completed = false;
  let acceptLateTokenUsage = false;

  const state = () => ({
    firstVisibleTextMs,
    lastVisibleTextMs,
    tokenSnapshot,
    agentMessageIds,
    toolItemIds,
    reroutedTo,
  });
  const currentTokenSnapshot = (): TokenSnapshot | null => tokenSnapshot;

  const timingFor = (notification: AppServerNotification): number | null =>
    notification.method === "item/agentMessage/delta" || notification.method === "turn/completed"
      ? clock.now()
      : null;

  let startedAt = 0;
  const reduce = ({ notification, receivedAt }: BufferedNotification): void => {
    if (
      completed &&
      (notification.method !== "thread/tokenUsage/updated" || !acceptLateTokenUsage)
    ) {
      return;
    }
    try {
      const params = requiredObject(notification.params, `${notification.method} params`);
      if (params["threadId"] !== threadId) return;
      const notificationTurnId =
        notification.method === "turn/completed"
          ? isObject(params["turn"])
            ? params["turn"]["id"]
            : undefined
          : params["turnId"];
      if (notificationTurnId !== activeTurnId) return;

      switch (notification.method) {
        case "item/agentMessage/delta": {
          if (typeof params["delta"] !== "string") {
            throw new AppServerProtocolError("App Server returned invalid agent delta");
          }
          outputText += params["delta"];
          if (params["delta"].trim().length > 0) {
            if (receivedAt === null) {
              throw new AppServerProtocolError("Agent delta lacked a receipt timestamp");
            }
            const relative = elapsed(startedAt, receivedAt);
            firstVisibleTextMs ??= relative;
            lastVisibleTextMs = relative;
          }
          break;
        }
        case "thread/tokenUsage/updated": {
          const usage = requiredObject(params["tokenUsage"], "token usage");
          const last = requiredObject(usage["last"], "last token usage");
          tokenSnapshot = {
            outputTokens: nonNegativeToken(last["outputTokens"]),
            reasoningOutputTokens: nonNegativeToken(last["reasoningOutputTokens"]),
          };
          if (completed) acceptLateTokenUsage = false;
          break;
        }
        case "model/rerouted":
          reroutedTo = requiredString(params["toModel"], "rerouted model");
          break;
        case "item/started":
        case "item/completed": {
          const item = requiredObject(params["item"], "thread item");
          const identity = itemIdentity(item);
          if (isToolLike(identity.type)) toolItemIds.add(identity.id);
          break;
        }
        case "turn/completed": {
          const turn = requiredObject(params["turn"], "completed turn");
          const status = requiredString(turn["status"], "turn status");
          if (!Array.isArray(turn["items"])) {
            throw new AppServerProtocolError("Completed turn lacked items");
          }
          for (const rawItem of turn["items"]) {
            const item = requiredObject(rawItem, "completed turn item");
            const identity = itemIdentity(item);
            if (identity.type === "agentMessage") agentMessageIds.add(identity.id);
            if (isToolLike(identity.type)) toolItemIds.add(identity.id);
          }
          if (receivedAt === null) {
            throw new AppServerProtocolError("Turn completion lacked a receipt timestamp");
          }
          acceptLateTokenUsage = tokenSnapshot === null;
          completed = true;
          resolveCompletion({ status, receivedAt, turn });
          break;
        }
      }
    } catch (error) {
      completed = true;
      rejectCompletion(
        error instanceof Error ? error : new AppServerProtocolError("Event reduction failed"),
      );
    }
  };

  const unsubscribe = client.subscribe((notification) => {
    if (!RECORDED_NOTIFICATION_METHODS.has(notification.method)) return;
    if (activeTurnId === null) {
      const params = isObject(notification.params) ? notification.params : null;
      if (params?.["threadId"] === threadId) {
        buffered.push({ notification, receivedAt: timingFor(notification) });
      }
      return;
    }
    const params = isObject(notification.params) ? notification.params : null;
    const candidateTurnId =
      notification.method === "turn/completed"
        ? isObject(params?.["turn"])
          ? params["turn"]["id"]
          : undefined
        : params?.["turnId"];
    const isActive = params?.["threadId"] === threadId && candidateTurnId === activeTurnId;
    reduce({ notification, receivedAt: isActive ? timingFor(notification) : null });
  });

  startedAt = clock.now();
  try {
    const turnOperation = (async (): Promise<Completion> => {
      const turnResponse: unknown = await client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: BENCHMARK_PROMPT }],
        model: request.model,
        effort: request.effort,
        serviceTier: "default",
        environments: [],
        runtimeWorkspaceRoots: [request.workspacePath],
      });
      const responseObject = requiredObject(turnResponse, "turn/start response");
      const turn = requiredObject(responseObject["turn"], "started turn");
      activeTurnId = requiredString(turn["id"], "turn ID");
      for (const bufferedNotification of buffered) reduce(bufferedNotification);
      buffered.length = 0;

      return Promise.race([
        completionPromise,
        client.waitForTermination().then((error) => Promise.reject(error)),
      ]);
    })();
    const completion = await client.withTurnTimeout(turnOperation);
    const totalLatencyMs = elapsed(startedAt, completion.receivedAt);

    let finalTokenSnapshot = currentTokenSnapshot();
    if (finalTokenSnapshot === null) {
      await Promise.race([
        clock.sleep(TOKEN_USAGE_GRACE_MS),
        client.waitForTermination().then((error) => Promise.reject(error)),
      ]);
      finalTokenSnapshot = currentTokenSnapshot();
    }
    if (finalTokenSnapshot === null) {
      return failureResult("missing_token_usage", totalLatencyMs, outputText, state());
    }

    let validation = validateOutput(outputText);
    if (
      validation.passed &&
      finalTokenSnapshot.outputTokens - finalTokenSnapshot.reasoningOutputTokens <
        MINIMUM_VISIBLE_TOKENS
    ) {
      validation = { passed: false, reason: "too_short" };
    }
    return {
      status: completion.status === "completed" ? "completed" : "failed",
      firstVisibleTextMs,
      lastVisibleTextMs,
      totalLatencyMs,
      outputTokens: finalTokenSnapshot.outputTokens,
      reasoningOutputTokens: finalTokenSnapshot.reasoningOutputTokens,
      agentMessageCount: agentMessageIds.size,
      toolEventCount: toolItemIds.size,
      reroutedTo,
      validatorPassed: validation.passed,
      validatorReason: validation.reason,
      errorCode: completion.status === "completed" ? null : "turn_failed",
    };
  } catch (error) {
    const totalLatencyMs = elapsed(startedAt, clock.now());
    const errorCode = error instanceof AppServerTimeoutError ? "timeout" : "protocol_error";
    if (!(error instanceof AppServerError)) {
      throw error;
    }
    return failureResult(errorCode, totalLatencyMs, outputText, state());
  } finally {
    unsubscribe();
    outputText = "";
  }
}
