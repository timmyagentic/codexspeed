import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { RUNNER_VERSION } from "./version.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_STDOUT_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const CLOSE_GRACE_MS = 250;

type JsonObject = Record<string, unknown>;

export type AppServerNotification = {
  method: string;
  params: unknown;
};

export type AppServerClientOptions = {
  command?: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  maxStdoutLineBytes?: number;
  maxStderrBytes?: number;
};

export type AppServerRequestOptions = {
  timeoutMs?: number;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return result;
}

export class AppServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AppServerTimeoutError extends AppServerError {}
export class AppServerProtocolError extends AppServerError {}
export class AppServerExitedError extends AppServerError {}

export class AppServerRpcError extends AppServerError {
  readonly code: number | null;

  constructor(method: string, code: number | null) {
    super(`App Server request failed: ${method}${code === null ? "" : ` (${code})`}`);
    this.code = code;
  }
}

export class AppServerClient {
  readonly turnTimeoutMs: number;

  readonly #child: ChildProcessWithoutNullStreams;
  readonly #requestTimeoutMs: number;
  readonly #maxStdoutLineBytes: number;
  readonly #maxStderrBytes: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #listeners = new Set<(notification: AppServerNotification) => void>();
  readonly #termination: Promise<AppServerError>;
  #resolveTermination!: (error: AppServerError) => void;
  #nextRequestId = 1;
  #stdoutBuffer = Buffer.alloc(0);
  #stderrTail = Buffer.alloc(0);
  #terminalError: AppServerError | null = null;
  #closing = false;
  #exitPromise: Promise<void>;
  #resolveExit!: () => void;

  private constructor(child: ChildProcessWithoutNullStreams, options: AppServerClientOptions) {
    this.#child = child;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.turnTimeoutMs = positiveInteger(
      options.turnTimeoutMs,
      DEFAULT_TURN_TIMEOUT_MS,
      "turnTimeoutMs",
    );
    this.#maxStdoutLineBytes = positiveInteger(
      options.maxStdoutLineBytes,
      DEFAULT_MAX_STDOUT_LINE_BYTES,
      "maxStdoutLineBytes",
    );
    this.#maxStderrBytes = positiveInteger(
      options.maxStderrBytes,
      DEFAULT_MAX_STDERR_BYTES,
      "maxStderrBytes",
    );
    this.#termination = new Promise((resolve) => {
      this.#resolveTermination = resolve;
    });
    this.#exitPromise = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });

    child.stdout.on("data", (chunk: Buffer) => this.#consumeStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.#consumeStderr(chunk));
    child.on("error", () => {
      this.#fail(new AppServerExitedError("App Server failed to start"));
    });
    child.on("exit", () => {
      this.#resolveExit();
      this.#fail(new AppServerExitedError("App Server exited"));
    });
    child.on("close", () => this.#resolveExit());
  }

  static async connect(options: AppServerClientOptions = {}): Promise<AppServerClient> {
    const command = options.command ?? "codex";
    const args = options.args === undefined ? ["app-server"] : [...options.args];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new AppServerClient(child, options);

    try {
      await client.request("initialize", {
        clientInfo: {
          name: "codexspeed",
          title: "CodexSpeed",
          version: RUNNER_VERSION,
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      client.notify("initialized", {});
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  request<T>(method: string, params: unknown, options: AppServerRequestOptions = {}): Promise<T> {
    if (this.#terminalError !== null) {
      return Promise.reject(this.#terminalError);
    }
    if (typeof method !== "string" || method.length === 0) {
      return Promise.reject(new AppServerProtocolError("App Server method must be non-empty"));
    }

    const id = this.#nextRequestId++;
    const timeoutMs = positiveInteger(options.timeoutMs, this.#requestTimeoutMs, "timeoutMs");
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AppServerTimeoutError(`App Server request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.#write({ id, method, params }, (error) => {
        if (error === null) return;
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        const exited = new AppServerExitedError("App Server input is unavailable");
        pending.reject(exited);
        this.#fail(exited);
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.#terminalError !== null) {
      throw this.#terminalError;
    }
    this.#write({ method, params }, (error) => {
      if (error !== null) this.#fail(new AppServerExitedError("App Server input is unavailable"));
    });
  }

  subscribe(listener: (notification: AppServerNotification) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  waitForTermination(): Promise<AppServerError> {
    return this.#termination;
  }

  async withTurnTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let timeoutError: AppServerTimeoutError | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timeoutError = new AppServerTimeoutError("App Server turn timed out");
        this.#fail(timeoutError);
        reject(timeoutError);
      }, this.turnTimeoutMs);
    });

    try {
      return await Promise.race([operation, timeout]);
    } catch (error) {
      if (error === timeoutError) await this.close();
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.#closing) {
      await this.#exitPromise;
      return;
    }
    this.#closing = true;

    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      await this.#exitPromise;
      return;
    }

    this.#child.stdin.end();
    const exitedGracefully = await Promise.race([
      this.#exitPromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), CLOSE_GRACE_MS)),
    ]);
    if (exitedGracefully) return;

    this.#child.kill("SIGTERM");
    const exitedAfterTerm = await Promise.race([
      this.#exitPromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), CLOSE_GRACE_MS)),
    ]);
    if (exitedAfterTerm) return;

    this.#child.kill("SIGKILL");
    await this.#exitPromise;
  }

  #write(message: JsonObject, callback: (error: Error | null) => void): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`, (error) => callback(error ?? null));
  }

  #consumeStdout(chunk: Buffer): void {
    if (this.#terminalError !== null) return;
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);

    while (true) {
      const newlineIndex = this.#stdoutBuffer.indexOf(0x0a);
      if (newlineIndex === -1) break;
      if (newlineIndex > this.#maxStdoutLineBytes) {
        this.#fail(new AppServerProtocolError("App Server stdout line exceeded the byte limit"));
        return;
      }

      let line = this.#stdoutBuffer.subarray(0, newlineIndex);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newlineIndex + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length === 0) continue;

      let message: unknown;
      try {
        message = JSON.parse(line.toString("utf8"));
      } catch {
        this.#fail(new AppServerProtocolError("App Server emitted malformed JSON"));
        return;
      }
      if (!this.#routeMessage(message)) return;
    }

    if (this.#stdoutBuffer.length > this.#maxStdoutLineBytes) {
      this.#fail(new AppServerProtocolError("App Server stdout line exceeded the byte limit"));
    }
  }

  #routeMessage(message: unknown): boolean {
    if (!isObject(message)) {
      this.#fail(new AppServerProtocolError("App Server emitted an invalid message"));
      return false;
    }

    if (Object.hasOwn(message, "id")) {
      if (!Number.isSafeInteger(message["id"])) {
        this.#fail(new AppServerProtocolError("App Server response ID must be numeric"));
        return false;
      }
      const pending = this.#pending.get(message["id"] as number);
      if (pending === undefined) return true;
      this.#pending.delete(message["id"] as number);
      clearTimeout(pending.timer);

      if (Object.hasOwn(message, "error")) {
        const errorObject = isObject(message["error"]) ? message["error"] : null;
        const code = typeof errorObject?.["code"] === "number" ? errorObject["code"] : null;
        pending.reject(new AppServerRpcError(pending.method, code));
      } else if (Object.hasOwn(message, "result")) {
        pending.resolve(message["result"]);
      } else {
        const error = new AppServerProtocolError("App Server response lacked result or error");
        pending.reject(error);
        this.#fail(error);
        return false;
      }
      return true;
    }

    if (typeof message["method"] !== "string") {
      this.#fail(new AppServerProtocolError("App Server notification lacked a method"));
      return false;
    }
    const notification = { method: message["method"], params: message["params"] };
    for (const listener of this.#listeners) listener(notification);
    return true;
  }

  #consumeStderr(chunk: Buffer): void {
    if (this.#maxStderrBytes === 0) return;
    const combined = Buffer.concat([this.#stderrTail, chunk]);
    this.#stderrTail = combined.subarray(Math.max(0, combined.length - this.#maxStderrBytes));
  }

  #fail(error: AppServerError): void {
    if (this.#terminalError !== null) return;
    this.#terminalError = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#resolveTermination(error);

    if (!this.#closing && this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill("SIGTERM");
    }
  }
}
