import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "codexspeed-built-cli-"));
const authHome = join(root, "auth-home");
const binDirectory = join(root, "bin");
const codexShim = join(
  binDirectory,
  process.platform === "win32" ? "codex.cmd" : "codex",
);
const fakeCodexUrl = new URL(
  "../packages/runner/test/fake-codex-cli.mjs",
  import.meta.url,
).href;

function execute(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn("corepack", arguments_, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: authHome,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal, stderr, stdout }),
    );
  });
}

try {
  await mkdir(authHome, { mode: 0o700 });
  await mkdir(binDirectory, { mode: 0o700 });
  await writeFile(join(authHome, "auth.json"), "{}", { mode: 0o600 });

  if (process.platform === "win32") {
    await writeFile(
      codexShim,
      `@echo off\r\n"${process.execPath}" -e "process.argv.splice(2,0,'doctor');import('${fakeCodexUrl}')" %*\r\n`,
    );
  } else {
    await writeFile(
      codexShim,
      `#!/usr/bin/env node\nprocess.argv.splice(2, 0, "doctor");\nawait import(${JSON.stringify(fakeCodexUrl)});\n`,
      { mode: 0o700 },
    );
    await chmod(codexShim, 0o700);
  }

  const prefix = ["pnpm", "--filter", "@codexspeed/runner", "codexspeed", "--"];
  const doctor = await execute([...prefix, "doctor"]);
  if (
    doctor.code !== 0 ||
    !doctor.stdout.includes("Doctor: ready") ||
    doctor.stderr.length > 0
  ) {
    throw new Error(
      `documented doctor command failed (${doctor.code ?? doctor.signal ?? "unknown"})`,
    );
  }

  const plan = await execute([
    ...prefix,
    "plan",
    "--model",
    "gpt-test",
    "--seed",
    "7",
    "--max-turns",
    "4",
  ]);
  if (
    plan.code !== 0 ||
    !plan.stdout.includes("Total turns: 4 / max 4") ||
    plan.stderr.length > 0
  ) {
    throw new Error(
      `documented plan command failed (${plan.code ?? plan.signal ?? "unknown"})`,
    );
  }

  process.stdout.write(
    "Built runner CLI doctor/plan smoke passed without model turns.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
