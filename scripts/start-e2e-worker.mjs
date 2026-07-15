import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stateDirectory = await mkdtemp(join(tmpdir(), "codexspeed-e2e-d1-"));
const environmentFile = join(stateDirectory, "worker.env");
const secret = Buffer.alloc(32, 73).toString("base64url");
await writeFile(
  environmentFile,
  `PUBLISHER_KEY_ID=e2e-publisher\nPUBLISHER_HMAC_SECRET=${secret}\n`,
  { encoding: "utf8", mode: 0o600 },
);

const baseArguments = [
  "pnpm",
  "--filter",
  "@codexspeed/web",
  "exec",
  "wrangler",
];

function start(arguments_, options = {}) {
  return spawn("corepack", [...baseArguments, ...arguments_], {
    cwd: process.cwd(),
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    shell: false,
    stdio: "inherit",
    ...options,
  });
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${label} exited with ${code ?? signal ?? "unknown status"}`,
          ),
        );
    });
  });
}

try {
  await waitForExit(
    start([
      "d1",
      "migrations",
      "apply",
      "codexspeed",
      "--local",
      "--persist-to",
      stateDirectory,
    ]),
    "D1 migration",
  );
} catch (error) {
  await rm(stateDirectory, { recursive: true, force: true });
  throw error;
}

const worker = start([
  "dev",
  "--local",
  "--ip",
  "127.0.0.1",
  "--port",
  "8791",
  "--persist-to",
  stateDirectory,
  "--env-file",
  environmentFile,
  "--show-interactive-dev-session=false",
]);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  worker.kill(signal);
  const forceTimer = setTimeout(() => worker.kill("SIGKILL"), 5_000);
  await new Promise((resolve) => worker.once("exit", resolve));
  clearTimeout(forceTimer);
  await rm(stateDirectory, { recursive: true, force: true });
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
worker.once("error", async (error) => {
  await rm(stateDirectory, { recursive: true, force: true });
  throw error;
});
worker.once("exit", async (code, signal) => {
  if (shuttingDown) return;
  await rm(stateDirectory, { recursive: true, force: true });
  process.exitCode = code ?? (signal === null ? 1 : 128);
});
