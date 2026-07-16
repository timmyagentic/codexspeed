import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
);

test("public run scripts are syntax-valid and pinned to the release version", async () => {
  const shellPath = join(repositoryRoot, "apps", "web", "public", "run.sh");
  const powershellPath = join(
    repositoryRoot,
    "apps",
    "web",
    "public",
    "run.ps1",
  );
  const [shell, powershell] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(powershellPath, "utf8"),
  ]);

  assert.match(shell, new RegExp(`version="${packageJson.version}"`, "u"));
  assert.match(
    powershell,
    new RegExp(`\\$Version = "${packageJson.version}"`, "u"),
  );
  assert.match(shell, /SHA256SUMS/u);
  assert.match(shell, /mktemp -d/u);
  assert.doesNotMatch(shell, /codexspeed-run-\$\$/u);
  assert.match(powershell, /Get-FileHash -Algorithm SHA256/u);
  await execute("sh", ["-n", shellPath]);
});
