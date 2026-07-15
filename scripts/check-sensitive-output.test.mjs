import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanPaths, scanText, walk } from "./check-sensitive-output.mjs";

test("detects every prohibited captured-output class without embedding a live-looking secret", () => {
  const cases = [
    ["API or repository token", ["s", "k-", "abcdefghijklmnopqrstu"].join("")],
    ["bearer credential", ["Bear", "er ", "abcdefghijklmnop"].join("")],
    ["JWT credential", ["eyJabc", "payload", "signature"].join(".")],
    ["private key", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    [
      "credential assignment",
      ["OPENAI_API_KEY", "=", "abcdefghijklmnop"].join(""),
    ],
    [
      "credential assignment",
      ["export CODEXSPEED_HMAC_", "SECRET=", "abcdefghijklmnop"].join(""),
    ],
    [
      "JSON credential value",
      ['{"access_', 'token":"abcdefghijklmnop"}'].join(""),
    ],
    [
      "JSON credential value",
      ['{"hmac', 'Secret":"abcdefghijklmnop"}'].join(""),
    ],
    [
      "JSON credential value",
      ['{"CODEXSPEED_HMAC_', 'SECRET":"abcdefghijklmnop"}'].join(""),
    ],
    [
      "YAML credential value",
      ["CODEXSPEED_HMAC_", "SECRET: ", "abcdefghijklmnop"].join(""),
    ],
    [
      "YAML credential value",
      ["hmac", "Secret: ", "abcdefghijklmnop"].join(""),
    ],
    [
      "npm auth token",
      ["//registry.npmjs.org/:_auth", "Token=", "abcdefghijklmnop"].join(""),
    ],
    ["private local user path", ["/Us", "ers/private-user/project"].join("")],
    ["private local user path", ["/Vol", "umes/private-disk/project"].join("")],
    [
      "private local user path",
      ["/private/var/fol", "ders/private-run/output"].join(""),
    ],
    [
      "raw App Server JSON-RPC transcript",
      ['{"json', 'rpc":"2.0","method":"turn/start"}'].join(""),
    ],
    [
      "raw App Server JSON-RPC transcript",
      ['{"json', 'rpc":"2.0",\n"meth', 'od":"turn/start"}'].join(""),
    ],
    [
      "raw App Server JSON-RPC transcript",
      ['{"meth', 'od":"turn/start","json', 'rpc":"2.0"}'].join(""),
    ],
    [
      "source map reference",
      ["//# source", "MappingURL=bundle.js.map"].join(""),
    ],
  ];

  for (const [expected, text] of cases) {
    assert.ok(
      scanText(text).includes(expected),
      `missing detector: ${expected}`,
    );
  }
});

test("does not flag public benchmark evidence or documentation prose", () => {
  assert.deepEqual(
    scanText(
      "Runner Verified means publisher-key signing only. No responses or credentials are uploaded.",
    ),
    [],
  );
});

test("scans a captured-output tree without following traversal symlinks", async () => {
  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "codexspeed-sensitive-fixture-"),
  );
  const externalRoot = await mkdtemp(
    join(tmpdir(), "codexspeed-sensitive-external-"),
  );
  try {
    const outputRoot = join(fixtureRoot, "public-output");
    await mkdir(outputRoot);
    const sourceMap = join(outputRoot, "bundle.js.map");
    const capture = join(outputRoot, "capture.txt");
    const authFile = join(outputRoot, "auth.json");
    const externalFile = join(externalRoot, "must-not-be-read.txt");
    const traversalLink = join(outputRoot, "outside-link");
    await writeFile(sourceMap, "{}", "utf8");
    await writeFile(authFile, "{}", "utf8");
    await writeFile(
      capture,
      [
        ['{"hmac', 'Secret":"abcdefghijklmnop"}'].join(""),
        ["/Us", "ers/private-user/captured-output"].join(""),
      ].join("\n"),
      "utf8",
    );
    await writeFile(externalFile, "ordinary external text", "utf8");
    await symlink(externalRoot, traversalLink);

    const paths = await walk(outputRoot);
    assert.ok(paths.includes(sourceMap));
    assert.ok(paths.includes(capture));
    assert.ok(paths.includes(authFile));
    assert.ok(paths.includes(traversalLink));
    assert.ok(!paths.includes(externalFile));

    const findings = await scanPaths(paths);
    assert.ok(
      findings.some(
        ({ path, reason }) =>
          path.endsWith("bundle.js.map") && reason === "source map file",
      ),
    );
    assert.ok(
      findings.some(
        ({ path, reason }) =>
          path.endsWith("auth.json") && reason === "credential file",
      ),
    );
    assert.ok(
      findings.some(
        ({ path, reason }) =>
          path.endsWith("capture.txt") && reason === "private local user path",
      ),
    );
    assert.ok(
      findings.some(
        ({ path, reason }) =>
          path.endsWith("outside-link") && reason === "symbolic link",
      ),
    );
  } finally {
    await Promise.all([
      rm(fixtureRoot, { force: true, recursive: true }),
      rm(externalRoot, { force: true, recursive: true }),
    ]);
  }
});
