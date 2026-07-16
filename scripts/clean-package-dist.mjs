import { rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packagePath = relative(root, process.cwd()).split(sep).join("/");
const allowedPackages = new Set([
  "packages/contracts",
  "packages/metrics",
  "packages/runner",
]);
if (!allowedPackages.has(packagePath)) {
  throw new Error("package dist cleanup may run only for buildable packages");
}

await rm(resolve(process.cwd(), "dist"), { recursive: true, force: true });
