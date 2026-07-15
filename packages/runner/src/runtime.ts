import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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
  appServerOptions?: Pick<AppServerClientOptions, "requestTimeoutMs" | "turnTimeoutMs">;
};

export type IsolatedRuntime = {
  rootPath: string;
  codexHomePath: string;
  workspacePath: string;
  env: NodeJS.ProcessEnv;
  connect(): Promise<AppServerClient>;
  runCodex(arguments_: readonly string[]): Promise<{ stdout: string; stderr: string }>;
};

function commandOutput(
  command: string,
  arguments_: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...arguments_],
      { cwd, env, shell: false, encoding: "utf8", maxBuffer: MAX_COMMAND_OUTPUT_BYTES },
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

async function copyAuthentication(sourcePath: string, destinationPath: string): Promise<void> {
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
    await copyAuthentication(currentAuthPath(options.authPath), join(codexHomePath, "auth.json"));

    const env: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENVIRONMENT_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    env["HOME"] = rootPath;
    env["TMPDIR"] = rootPath;
    env["CODEX_HOME"] = codexHomePath;
    env["CODEX_SQLITE_HOME"] = codexHomePath;

    const codexCommand = options.codexCommand ?? "codex";
    const prefix = [...(options.codexArguments ?? [])];
    const runtime: IsolatedRuntime = {
      rootPath,
      codexHomePath,
      workspacePath,
      env,
      connect: () =>
        AppServerClient.connect({
          command: codexCommand,
          args: [...prefix, "app-server"],
          cwd: workspacePath,
          env,
          ...options.appServerOptions,
        }),
      runCodex: (arguments_) =>
        commandOutput(codexCommand, [...prefix, ...arguments_], env, workspacePath),
    };
    return await operation(runtime);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}
