import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { AppServerClient, type AppServerClientOptions } from "./app-server.js";

const MAX_AUTH_BYTES = 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const SAFE_ENVIRONMENT_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SYSTEMROOT",
  "WINDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export class RunnerRuntimeError extends Error {}

export type RuntimeOptions = {
  codexCommand?: string;
  codexArguments?: readonly string[];
  authPath?: string;
  temporaryParent?: string;
  appServerOptions?: Pick<
    AppServerClientOptions,
    "requestTimeoutMs" | "turnTimeoutMs"
  >;
};

export type IsolatedRuntime = {
  rootPath: string;
  codexHomePath: string;
  workspacePath: string;
  env: NodeJS.ProcessEnv;
  connect(): Promise<AppServerClient>;
  runCodex(
    arguments_: readonly string[],
  ): Promise<{ stdout: string; stderr: string }>;
};

export type CodexProcessInvocation = {
  command: string;
  arguments: string[];
  windowsVerbatimArguments: boolean;
};

type RuntimeDiscovery = {
  platform: NodeJS.Platform;
  homePath: string;
  pathValue: string;
  pathExtensions: readonly string[];
  isAvailable(path: string): Promise<boolean>;
};

function defaultDiscovery(): RuntimeDiscovery {
  const extensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];
  return {
    platform: process.platform,
    homePath: homedir(),
    pathValue: process.env["PATH"] ?? "",
    pathExtensions: extensions,
    isAvailable: async (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
  };
}

function codexCandidates(discovery: RuntimeDiscovery): string[] {
  const names =
    discovery.platform === "win32"
      ? discovery.pathExtensions.map(
          (extension) => `codex${extension.toLowerCase()}`,
        )
      : ["codex"];
  const candidates = discovery.pathValue
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => join(directory, name)));

  if (discovery.platform === "darwin") {
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      join(
        discovery.homePath,
        "Applications/Codex.app/Contents/Resources/codex",
      ),
      join(
        discovery.homePath,
        "Applications/ChatGPT.app/Contents/Resources/codex",
      ),
    );
  }
  return [...new Set(candidates)];
}

export async function resolveCodexCommand(
  explicit: string | undefined,
  discovery: RuntimeDiscovery = defaultDiscovery(),
): Promise<string> {
  if (explicit !== undefined) return explicit;
  for (const candidate of codexCandidates(discovery)) {
    if (await discovery.isAvailable(candidate)) return candidate;
  }
  throw new RunnerRuntimeError(
    "Codex CLI is unavailable; install Codex and sign in with ChatGPT first",
  );
}

function quoteWindowsBatchArgument(value: string): string {
  if (
    value.includes("%") ||
    value.includes('"') ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new RunnerRuntimeError(
      "Codex command contains characters unsupported by the Windows launcher",
    );
  }
  return `"${value}"`;
}

export function createCodexProcessInvocation(
  command: string,
  prefix: readonly string[],
  arguments_: readonly string[],
  platform: NodeJS.Platform = process.platform,
  windowsCommandProcessor: string | undefined = process.env["ComSpec"] ??
    process.env["COMSPEC"],
): CodexProcessInvocation {
  const argumentsWithPrefix = [...prefix, ...arguments_];
  if (platform !== "win32" || !/\.(?:bat|cmd)$/iu.test(command)) {
    return {
      command,
      arguments: argumentsWithPrefix,
      windowsVerbatimArguments: false,
    };
  }
  if (
    windowsCommandProcessor === undefined ||
    windowsCommandProcessor.length === 0
  ) {
    throw new RunnerRuntimeError("Windows command processor is unavailable");
  }
  const commandLine = [command, ...argumentsWithPrefix]
    .map(quoteWindowsBatchArgument)
    .join(" ");
  return {
    command: windowsCommandProcessor,
    arguments: ["/d", "/s", "/v:off", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

function commandOutput(
  command: string,
  arguments_: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  windowsVerbatimArguments: boolean,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...arguments_],
      {
        cwd,
        env,
        shell: false,
        windowsVerbatimArguments,
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new RunnerRuntimeError("Codex command failed"));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function currentAuthPath(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  const configuredHome = process.env["CODEX_HOME"];
  return join(configuredHome ?? join(homedir(), ".codex"), "auth.json");
}

async function copyAuthentication(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const metadata = await lstat(sourcePath).catch(() => null);
  if (metadata === null || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new RunnerRuntimeError("ChatGPT authentication is unavailable");
  }
  if (metadata.size > MAX_AUTH_BYTES) {
    throw new RunnerRuntimeError("ChatGPT authentication is invalid");
  }
  const bytes = await readFile(sourcePath);
  await writeFile(destinationPath, bytes, { mode: 0o600, flag: "wx" });
}

export async function withIsolatedRuntime<T>(
  options: RuntimeOptions,
  operation: (runtime: IsolatedRuntime) => Promise<T>,
): Promise<T> {
  const parent = options.temporaryParent ?? tmpdir();
  const rootPath = await mkdtemp(join(parent, "codexspeed-"));
  const codexHomePath = join(rootPath, "codex-home");
  const workspacePath = join(rootPath, "workspace");

  try {
    await mkdir(codexHomePath, { mode: 0o700 });
    await mkdir(workspacePath, { mode: 0o700 });
    await copyAuthentication(
      currentAuthPath(options.authPath),
      join(codexHomePath, "auth.json"),
    );

    const env: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENVIRONMENT_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    env["HOME"] = rootPath;
    env["TMPDIR"] = rootPath;
    if (process.platform === "win32") {
      env["TEMP"] = rootPath;
      env["TMP"] = rootPath;
      env["USERPROFILE"] = rootPath;
      const commandProcessor = process.env["ComSpec"] ?? process.env["COMSPEC"];
      if (commandProcessor !== undefined) {
        env["ComSpec"] = commandProcessor;
      }
    }
    env["CODEX_HOME"] = codexHomePath;
    env["CODEX_SQLITE_HOME"] = codexHomePath;

    const codexCommand = await resolveCodexCommand(options.codexCommand);
    const prefix = [...(options.codexArguments ?? [])];
    const invocation = (arguments_: readonly string[]) =>
      createCodexProcessInvocation(codexCommand, prefix, arguments_);
    const runtime: IsolatedRuntime = {
      rootPath,
      codexHomePath,
      workspacePath,
      env,
      connect: () => {
        const appServer = invocation(["app-server"]);
        return AppServerClient.connect({
          command: appServer.command,
          args: appServer.arguments,
          windowsVerbatimArguments: appServer.windowsVerbatimArguments,
          cwd: workspacePath,
          env,
          ...options.appServerOptions,
        });
      },
      runCodex: (arguments_) => {
        const child = invocation(arguments_);
        return commandOutput(
          child.command,
          child.arguments,
          env,
          workspacePath,
          child.windowsVerbatimArguments,
        );
      },
    };
    return await operation(runtime);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}
