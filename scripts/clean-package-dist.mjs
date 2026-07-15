import { rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packagePath = relative(root, process.cwd()).split(sep).join("/");
if (packagePath !== "packages/contracts" && packagePath !== "packages/runner") {
  throw new Error("package dist cleanup may run only for contracts or runner");
}

await rm(resolve(process.cwd(), "dist"), { recursive: true, force: true });
