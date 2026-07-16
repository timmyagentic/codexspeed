import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = join(repositoryRoot, "dist", "cli.js");

await rm(dirname(outputPath), { force: true, recursive: true });
await mkdir(dirname(outputPath), { recursive: true });
await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  conditions: ["development", "node"],
  entryPoints: ["packages/runner/src/bin.ts"],
  format: "esm",
  legalComments: "none",
  minify: false,
  outfile: outputPath,
  packages: "bundle",
  platform: "node",
  sourcemap: false,
  target: "node22",
});
await chmod(outputPath, 0o755);

process.stdout.write(`Public CLI bundle written to ${outputPath}\n`);
