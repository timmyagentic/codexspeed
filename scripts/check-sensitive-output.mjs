import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const SELF = "scripts/check-sensitive-output.mjs";
const OUTPUT_ROOTS = [
  "apps/web/dist",
  "packages/contracts/dist",
  "packages/runner/dist",
  "test-results",
  "playwright-report",
  "artifacts",
];
const SENSITIVE_BASENAMES = new Set([".env", ".dev.vars", "auth.json"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12"]);

const detectors = [
  {
    name: "API or repository token",
    pattern:
      /(?:\bsk-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b)/gu,
  },
  {
    name: "bearer credential",
    pattern: /\bbearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/giu,
  },
  {
    name: "JWT credential",
    pattern: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
  },
  {
    name: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/gu,
  },
  {
    name: "credential assignment",
    pattern:
      /(?:^|[\r\n])\s*(?:export\s+)?(?:[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)|CODEXSPEED_HMAC_SECRET)\s*=\s*[^\s#]{8,}/gmu,
  },
  {
    name: "YAML credential value",
    pattern:
      /(?:^|[\r\n])\s*(?:[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)|TOKEN|PASSWORD)\s*:\s*(?!(?:[A-Z_$][A-Z0-9_$]*)(?:\.|\[|\s*[,}]))["']?[A-Z0-9_+./=-]{8,}/gimu,
  },
  {
    name: "JSON credential value",
    pattern:
      /["'](?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|hmac[_-]?secret|codexspeed_hmac_secret|password)["']\s*:\s*["'][^"'\r\n]{8,}["']/giu,
  },
  {
    name: "npm auth token",
    pattern:
      /(?:^|[\r\n])\s*(?:(?:\/\/|https?:\/\/)[^\s=]+:)?_authToken\s*=\s*[^\s#]{8,}/gimu,
  },
  {
    name: "private local user path",
    pattern:
      /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|\/Volumes\/[^/\s"']+|\/(?:private\/)?var\/folders\/[^\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)/gu,
  },
  {
    name: "raw App Server JSON-RPC transcript",
    pattern:
      /(?:["']jsonrpc["']\s*:\s*["']2\.0["'][^{}]{0,256}["'](?:method|result|error)["']\s*:|["'](?:method|result|error)["']\s*:[^{}]{0,256}["']jsonrpc["']\s*:\s*["']2\.0["'])/giu,
  },
  {
    name: "source map reference",
    pattern: /(?:\/\/[#@]\s*sourceMappingURL=|\bsourceMappingURL=)/gu,
  },
];

function normalized(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function sensitivePathReason(path) {
  const name = basename(path);
  const parts = normalized(path).split("/");
  if (SENSITIVE_BASENAMES.has(name) || /^\.env\./u.test(name))
    return "credential file";
  if (SENSITIVE_EXTENSIONS.has(extname(name).toLowerCase()))
    return "key material file";
  if (parts.includes(".codex")) return "Codex private state";
  if (name.endsWith(".map")) return "source map file";
  return null;
}

export function scanText(text) {
  return detectors.flatMap(({ name, pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text) ? [name] : [];
  });
}

async function trackedFiles() {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: ROOT,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(ROOT, path));
}

export async function walk(path) {
  const metadata = await lstat(path).catch(() => null);
  if (metadata === null) return [];
  if (metadata.isSymbolicLink()) return [path];
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => walk(resolve(path, entry.name))),
  );
  return nested.flat();
}

function isText(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8_192));
  return !sample.includes(0);
}

export async function runSensitiveScan() {
  const tracked = await trackedFiles();
  const output = (
    await Promise.all(OUTPUT_ROOTS.map((root) => walk(resolve(ROOT, root))))
  ).flat();
  const paths = [...new Set([...tracked, ...output])].sort();
  const findings = await scanPaths(paths);

  if (findings.length > 0) {
    const safeList = findings
      .map(({ path, reason }) => `- ${path}: ${reason}`)
      .join("\n");
    throw new Error(`Sensitive-output scan failed:\n${safeList}`);
  }
  process.stdout.write(
    `Sensitive-output scan passed (${paths.length} files checked).\n`,
  );
}

export async function scanPaths(paths) {
  const findings = [];

  for (const path of paths) {
    const displayPath = normalized(path);
    if (displayPath === SELF) continue;
    const metadata = await lstat(path).catch(() => null);
    if (metadata === null) continue;
    if (metadata.isSymbolicLink()) {
      findings.push({ path: displayPath, reason: "symbolic link" });
      continue;
    }
    if (!metadata.isFile()) continue;
    const pathReason = sensitivePathReason(path);
    if (pathReason !== null)
      findings.push({ path: displayPath, reason: pathReason });

    const bytes = await readFile(path).catch(() => null);
    if (bytes === null || !isText(bytes)) continue;
    for (const reason of scanText(bytes.toString("utf8"))) {
      findings.push({ path: displayPath, reason });
    }
  }

  return findings;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runSensitiveScan();
}
