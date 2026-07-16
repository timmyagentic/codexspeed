import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const bundlePath = join(repositoryRoot, "dist", "cli.js");
const temporaryRoot = await mkdtemp(join(tmpdir(), "codexspeed-public-cli-"));

try {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  const runnerPackageJson = JSON.parse(
    await readFile(
      join(repositoryRoot, "packages", "runner", "package.json"),
      "utf8",
    ),
  );
  if (packageJson.version !== runnerPackageJson.version) {
    throw new Error("public and runner versions differ");
  }

  const bundle = await readFile(bundlePath, "utf8");
  if (!bundle.startsWith("#!/usr/bin/env node\n")) {
    throw new Error("public CLI is missing its executable entrypoint");
  }
  if (/from\s+["'](?:@codexspeed\/|zod)/u.test(bundle)) {
    throw new Error("public CLI retained a private runtime dependency");
  }
  if (((await stat(bundlePath)).mode & 0o111) === 0) {
    throw new Error("public CLI bundle was not executable");
  }

  const direct = await execute(process.execPath, [bundlePath, "--version"], {
    cwd: temporaryRoot,
  });
  if (direct.stdout.trim() !== `CodexSpeed ${packageJson.version}`) {
    throw new Error("direct public CLI version check failed");
  }

  const packDirectory = join(temporaryRoot, "pack");
  const installDirectory = join(temporaryRoot, "install");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(installDirectory, { recursive: true }),
  ]);
  const packed = await execute(
    "npm",
    ["pack", "--json", "--pack-destination", packDirectory],
    { cwd: repositoryRoot },
  );
  const packResult = JSON.parse(packed.stdout);
  const filename = packResult[0]?.filename;
  if (typeof filename !== "string") {
    throw new Error("npm pack did not return an artifact");
  }
  const tarball = join(packDirectory, filename);
  await execute(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: installDirectory },
  );
  const binDirectory = join(installDirectory, "node_modules", ".bin");
  const installed = await execute(
    process.platform === "win32" ? "codexspeed.cmd" : "codexspeed",
    ["--help"],
    {
      cwd: installDirectory,
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  if (!installed.stdout.includes("codexspeed measure")) {
    throw new Error("installed public CLI did not start through its bin link");
  }

  process.stdout.write(
    `Public CLI bundle and packed install smoke passed for ${packageJson.version}.\n`,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
