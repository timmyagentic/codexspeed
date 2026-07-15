# Repository Guidelines

## Workspace

CodexSpeed is a Node.js 22+ pnpm 10 TypeScript workspace. Shared packages live
under `packages/`, the Worker and dashboard live under `apps/`, browser tests
live under `tests/`, and public methodology belongs in `docs/methodology/`.

## Commands

- `corepack pnpm install`: install the pinned workspace dependencies.
- `corepack pnpm test`: run package test suites.
- `corepack pnpm typecheck`: type-check every package.
- `corepack pnpm check`: run the repository gate.

Use `corepack pnpm --filter <package> <script>` while iterating. Keep dependency
versions exact and commit `pnpm-lock.yaml` whenever dependencies change.

## Development

Use strict test-driven development: add one focused failing test, observe the
expected failure, implement the smallest passing change, and then refactor while
green. Keep TypeScript strict, prefer small domain-focused modules, and export
public package APIs through each package's `src/index.ts`.

## Security and contracts

The production website is display-only. It must never start Codex turns or
receive Codex, ChatGPT, or OpenAI credentials. Treat uploaded run documents as
public data: reject unknown properties, bound collections and strings, reject
non-finite numbers, and never add free-form environment, exception, transcript,
or credential fields. Server code must recompute derived values from raw data.

## Changes

Run focused tests first and `corepack pnpm check` before committing. Use concise
imperative commit subjects. Do not commit credentials, local benchmark output,
temporary Codex homes, signing material, generated coverage, or build output.
