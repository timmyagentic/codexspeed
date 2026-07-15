export const BENCHMARK_PROMPT = `You are completing a synthetic reasoning benchmark. Use only the facts in this prompt. Do not use tools, web search, commands, files, external sources, or hidden assumptions.

A small service has 12 identical work units. Policy A completes one unit every 9 seconds with no setup cost. Policy B has a 24-second setup cost, then completes one unit every 6 seconds. Policy C splits the work into three equal batches; each batch has a 10-second setup cost and then completes a unit every 7 seconds. Setups and unit work are sequential, and batches cannot overlap. The service values predictable completion time, low setup overhead, and a clear explanation of trade-offs.

Compare the three policies using the supplied facts. Explain the calculation path, identify the fastest policy, discuss when the ranking could change if the number of units changed, and make one recommendation. The goal is consistent structured output rather than external knowledge.

Write at least 400 words and no more than 550 words. Use exactly these four Markdown level-two headings in this order, with substantive prose beneath every heading and no other level-two headings:

## Summary
## Reasoning
## Trade-offs
## Recommendation`;

export const BENCHMARK_PROMPT_SHA256 =
  "48ebeacd78a933ea53e78e13439c489db1264b121928806acc9e350ec9dbd56e";

export type OutputValidation =
  | { passed: true; reason: "ok" }
  | { passed: false; reason: "too_short" | "bad_structure" | "missing_output" };

const REQUIRED_HEADINGS = ["Summary", "Reasoning", "Trade-offs", "Recommendation"] as const;
const MINIMUM_WORDS = 400;

export function validateOutput(text: string): OutputValidation {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { passed: false, reason: "missing_output" };

  const words = trimmed.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length < MINIMUM_WORDS) return { passed: false, reason: "too_short" };

  const headings = [...trimmed.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  if (
    headings.length !== REQUIRED_HEADINGS.length ||
    headings.some((heading, index) => heading[1] !== REQUIRED_HEADINGS[index]) ||
    headings[0]?.index !== 0
  ) {
    return { passed: false, reason: "bad_structure" };
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const contentStart = heading.index! + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? trimmed.length;
    if (trimmed.slice(contentStart, contentEnd).trim().length === 0) {
      return { passed: false, reason: "bad_structure" };
    }
  }

  return { passed: true, reason: "ok" };
}
