import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const headers = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");

function block(path: string): string {
  const match = new RegExp(`(?:^|\\n)${path.replaceAll("*", "\\*")}\\n((?:  .+\\n?)+)`, "u").exec(
    headers,
  );
  if (match?.[1] === undefined) throw new Error(`missing _headers block for ${path}`);
  return match[1];
}

describe("static asset headers", () => {
  it("does not merge the app shell cache policy into immutable assets", () => {
    expect(block("/*")).not.toContain("Cache-Control:");
    expect(block("/assets/*").trim()).toBe(
      "Cache-Control: public, max-age=31536000, immutable",
    );
  });

  it.each(["/", "/index.html", "/runs", "/runs/*", "/methodology"])(
    "revalidates the app shell at %s",
    (path) => {
      expect(block(path).trim()).toBe("Cache-Control: public, max-age=0, must-revalidate");
    },
  );
});
