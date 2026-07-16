import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const arguments_ = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (name === undefined || value === undefined || !name.startsWith("--")) {
    throw new Error(
      "usage: stage-portable-release --platform NAME --arch NAME --out PATH",
    );
  }
  arguments_.set(name.slice(2), value);
}

const platform = arguments_.get("platform");
const architecture = arguments_.get("arch");
const outputParent = arguments_.get("out");
if (
  !["macos", "linux", "windows"].includes(platform ?? "") ||
  !["arm64", "x64"].includes(architecture ?? "") ||
  outputParent === undefined
) {
  throw new Error("portable platform, architecture, or output is invalid");
}
const currentPlatform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform;
if (currentPlatform !== platform || process.arch !== architecture) {
  throw new Error(
    "portable package must be staged on its target platform and architecture",
  );
}

const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
const stageRoot = resolve(outputParent, "codexspeed");
const binDirectory = join(stageRoot, "bin");
const runtimeDirectory = join(stageRoot, "runtime");
const libraryDirectory = join(stageRoot, "lib");
const licenseDirectory = join(stageRoot, "licenses");

const nodeLicenseCandidates = [
  join(dirname(process.execPath), "LICENSE"),
  join(dirname(process.execPath), "..", "LICENSE"),
  join(dirname(process.execPath), "..", "..", "LICENSE"),
];
let nodeLicense;
for (const candidate of nodeLicenseCandidates) {
  try {
    await readFile(candidate);
    nodeLicense = candidate;
    break;
  } catch {
    // Try the next standard Node distribution layout.
  }
}
if (nodeLicense === undefined) {
  throw new Error(
    `Node license was not found near ${basename(process.execPath)}`,
  );
}

await rm(stageRoot, { force: true, recursive: true });
await Promise.all(
  [binDirectory, runtimeDirectory, libraryDirectory, licenseDirectory].map(
    (directory) => mkdir(directory, { recursive: true }),
  ),
);
const runtimeName = platform === "windows" ? "node.exe" : "node";
await Promise.all([
  copyFile(process.execPath, join(runtimeDirectory, runtimeName)),
  copyFile(
    join(repositoryRoot, "dist", "cli.js"),
    join(libraryDirectory, "cli.js"),
  ),
  copyFile(
    join(repositoryRoot, "LICENSE"),
    join(licenseDirectory, "CODEXSPEED-LICENSE"),
  ),
  copyFile(nodeLicense, join(licenseDirectory, "NODE-LICENSE")),
  copyFile(
    join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
    join(licenseDirectory, "THIRD_PARTY_NOTICES.md"),
  ),
]);

if (platform === "windows") {
  await writeFile(
    join(binDirectory, "codexspeed.cmd"),
    '@echo off\r\n"%~dp0..\\runtime\\node.exe" "%~dp0..\\lib\\cli.js" %*\r\n',
    "utf8",
  );
} else {
  const launcher = join(binDirectory, "codexspeed");
  await writeFile(
    launcher,
    '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$root/runtime/node" "$root/lib/cli.js" "$@"\n',
    { encoding: "utf8", mode: 0o755 },
  );
  await chmod(join(runtimeDirectory, runtimeName), 0o755);
  await chmod(join(libraryDirectory, "cli.js"), 0o644);
}

await writeFile(
  join(stageRoot, "MANIFEST.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      codexSpeedVersion: packageJson.version,
      nodeVersion: process.version,
      platform,
      architecture,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(`${stageRoot}\n`);
