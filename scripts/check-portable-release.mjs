import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = await mkdtemp(join(tmpdir(), "codexspeed-portable-"));
const platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform;

try {
  await execute(
    process.execPath,
    [
      join(repositoryRoot, "scripts", "stage-portable-release.mjs"),
      "--platform",
      platform,
      "--arch",
      process.arch,
      "--out",
      temporaryRoot,
    ],
    { cwd: repositoryRoot },
  );
  const manifest = JSON.parse(
    await readFile(join(temporaryRoot, "codexspeed", "MANIFEST.json"), "utf8"),
  );
  const launcher = join(
    temporaryRoot,
    "codexspeed",
    "bin",
    process.platform === "win32" ? "codexspeed.cmd" : "codexspeed",
  );
  const result = await execute(launcher, ["--version"], {
    cwd: temporaryRoot,
  });
  if (result.stdout.trim() !== `CodexSpeed ${manifest.codexSpeedVersion}`) {
    throw new Error("portable launcher version check failed");
  }
  if (manifest.nodeVersion !== process.version) {
    throw new Error("portable manifest Node version differs from its runtime");
  }
  process.stdout.write(
    `Portable ${platform}-${process.arch} launcher smoke passed.\n`,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
