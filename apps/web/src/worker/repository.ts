import type { RunUpload } from "@codexspeed/contracts";
import type { RunSummary } from "@codexspeed/metrics";

import { ProblemError } from "./problem.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_CURSOR_LENGTH = 512;

type RunRow = {
  payload_sha256: string;
  public_payload_json: string;
  published_at: string;
  run_id: string;
  summary_json: string;
};

type LatestRunRow = RunRow & {
  generation: number;
};

type RunListRow = {
  codex_cli_version: string;
  ended_at: string;
  expected_measured_samples: number;
  invalid_samples: number;
  measured_cells: number;
  measured_samples: number;
  mode: string;
  payload_sha256: string;
  protocol_version: string;
  published_at: string;
  recorded_measured_samples: number;
  run_id: string;
  runner_version: string;
  schema_version: number;
  selected_cells: number;
  started_at: string;
  status: string;
  suite_version: string;
  unmeasured_cells: number;
  valid_samples: number;
};

export type RunPublication = {
  payloadSha256: string;
  publishedAt: string;
};

export type PublicRunResponse = {
  publication: RunPublication;
  run: RunUpload;
  summary: RunSummary;
};

export type LatestRunResponse = PublicRunResponse & {
  generation: number;
};

export type StoredPublicRunResponse = {
  body: string;
  publication: RunPublication;
};

export type StoredLatestRunResponse = StoredPublicRunResponse & {
  generation: number;
};

export type RunListMetadata = Pick<
  RunUpload,
  | "codexCliVersion"
  | "endedAt"
  | "mode"
  | "protocolVersion"
  | "runId"
  | "runnerVersion"
  | "schemaVersion"
  | "startedAt"
  | "status"
  | "suiteVersion"
> & {
  publication: RunPublication;
  summary: Pick<RunSummary, "coverage" | "reliability">;
};

export type RunListResponse = {
  data: RunListMetadata[];
  nextCursor: string | null;
};

export type InsertRunInput = {
  payloadSha256: string;
  publishedAt: string;
  run: RunUpload;
  summary: RunSummary;
};

export type InsertRunResult = {
  created: boolean;
  value: StoredPublicRunResponse;
};

type CursorKey = {
  publishedAt: string;
  runId: string;
};

function runConflict(): ProblemError {
  return new ProblemError(
    409,
    "run_conflict",
    "Run ID already exists with different content",
  );
}

function invalidCursor(): ProblemError {
  return new ProblemError(400, "invalid_cursor", "Invalid cursor");
}

function storedDataError(): Error {
  const error = new Error("Stored run data is invalid");
  error.name = "StoredDataError";
  return error;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw storedDataError();
  }
  return value;
}

function count(value: unknown): number {
  const parsed = finiteNumber(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw storedDataError();
  }
  return parsed;
}

function validatePublication(row: Pick<RunRow, "payload_sha256" | "published_at">): RunPublication {
  if (
    !SHA256_PATTERN.test(row.payload_sha256) ||
    !UTC_TIMESTAMP_PATTERN.test(row.published_at) ||
    new Date(row.published_at).toISOString() !== row.published_at
  ) {
    throw storedDataError();
  }
  return {
    payloadSha256: row.payload_sha256,
    publishedAt: row.published_at,
  };
}

function storedPublicRun(
  publicPayloadJson: string,
  summaryJson: string,
  publication: RunPublication,
): StoredPublicRunResponse {
  return {
    body: `{"run":${publicPayloadJson},"summary":${summaryJson},"publication":${JSON.stringify(publication)}}`,
    publication,
  };
}

function rowToStoredPublicRun(row: RunRow): StoredPublicRunResponse {
  return storedPublicRun(
    row.public_payload_json,
    row.summary_json,
    validatePublication(row),
  );
}

function mode(value: string): RunUpload["mode"] {
  if (value !== "full" && value !== "smoke") {
    throw storedDataError();
  }
  return value;
}

function status(value: string): RunUpload["status"] {
  if (value !== "completed" && value !== "partial" && value !== "failed") {
    throw storedDataError();
  }
  return value;
}

function schemaVersion(value: number): RunUpload["schemaVersion"] {
  if (value !== 1) {
    throw storedDataError();
  }
  return value;
}

function listRowToMetadata(row: RunListRow): RunListMetadata {
  return {
    codexCliVersion: row.codex_cli_version,
    endedAt: row.ended_at,
    mode: mode(row.mode),
    protocolVersion: row.protocol_version,
    publication: validatePublication(row),
    runId: row.run_id,
    runnerVersion: row.runner_version,
    schemaVersion: schemaVersion(row.schema_version),
    startedAt: row.started_at,
    status: status(row.status),
    suiteVersion: row.suite_version,
    summary: {
      coverage: {
        expectedMeasuredSamples: count(row.expected_measured_samples),
        measuredCells: count(row.measured_cells),
        recordedMeasuredSamples: count(row.recorded_measured_samples),
        selectedCells: count(row.selected_cells),
        unmeasuredCells: count(row.unmeasured_cells),
      },
      reliability: {
        invalidSamples: count(row.invalid_samples),
        measuredSamples: count(row.measured_samples),
        validSamples: count(row.valid_samples),
      },
    },
  };
}

async function selectRunRow(db: D1Database, runId: string): Promise<RunRow | null> {
  return db
    .prepare(
      `SELECT run_id, payload_sha256, public_payload_json, summary_json, published_at
       FROM runs
       WHERE run_id = ?`,
    )
    .bind(runId)
    .first<RunRow>();
}

function encodeBase64Url(value: Uint8Array): string {
  const binary = String.fromCharCode(...value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    value.length % 4 === 1 ||
    value.includes("=") ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw invalidCursor();
  }

  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (encodeBase64Url(bytes) !== value) {
      throw invalidCursor();
    }
    return bytes;
  } catch (error) {
    if (error instanceof ProblemError) {
      throw error;
    }
    throw invalidCursor();
  }
}

function decodeCursor(value: string): CursorKey {
  let parsed: unknown;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      decodeBase64Url(value),
    );
    const decodedValue: unknown = JSON.parse(decoded);
    parsed = decodedValue;
  } catch (error) {
    if (error instanceof ProblemError) {
      throw error;
    }
    throw invalidCursor();
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(parsed[0]) ||
    !UUID_V7_PATTERN.test(parsed[1])
  ) {
    throw invalidCursor();
  }

  try {
    if (new Date(parsed[0]).toISOString() !== parsed[0]) {
      throw invalidCursor();
    }
  } catch {
    throw invalidCursor();
  }

  return { publishedAt: parsed[0], runId: parsed[1] };
}

function encodeCursor(key: CursorKey): string {
  return encodeBase64Url(
    new TextEncoder().encode(JSON.stringify([key.publishedAt, key.runId])),
  );
}

export async function insertRunAndAdvanceLatest(
  db: D1Database,
  input: InsertRunInput,
): Promise<InsertRunResult> {
  const existing = await selectRunRow(db, input.run.runId);
  if (existing !== null) {
    if (existing.payload_sha256 !== input.payloadSha256) {
      throw runConflict();
    }
    return { created: false, value: rowToStoredPublicRun(existing) };
  }

  const publicPayloadJson = JSON.stringify(input.run);
  const summaryJson = JSON.stringify(input.summary);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO runs (
             run_id, schema_version, payload_sha256, suite_version, protocol_version,
             runner_version, codex_cli_version, started_at, ended_at, status,
             public_payload_json, summary_json, published_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.run.runId,
          input.run.schemaVersion,
          input.payloadSha256,
          input.run.suiteVersion,
          input.run.protocolVersion,
          input.run.runnerVersion,
          input.run.codexCliVersion,
          input.run.startedAt,
          input.run.endedAt,
          input.run.status,
          publicPayloadJson,
          summaryJson,
          input.publishedAt,
        ),
      db
        .prepare(
          `INSERT INTO site_state (key, latest_run_id, generation, updated_at)
           VALUES ('latest', ?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET
             latest_run_id = excluded.latest_run_id,
             generation = site_state.generation + 1,
             updated_at = excluded.updated_at`,
        )
        .bind(input.run.runId, input.publishedAt),
    ]);
  } catch (error) {
    const raced = await selectRunRow(db, input.run.runId);
    if (raced !== null) {
      if (raced.payload_sha256 !== input.payloadSha256) {
        throw runConflict();
      }
      return { created: false, value: rowToStoredPublicRun(raced) };
    }
    throw error;
  }

  return {
    created: true,
    value: storedPublicRun(publicPayloadJson, summaryJson, {
      payloadSha256: input.payloadSha256,
      publishedAt: input.publishedAt,
    }),
  };
}

export async function getRun(
  db: D1Database,
  runId: string,
): Promise<StoredPublicRunResponse | null> {
  const row = await selectRunRow(db, runId);
  return row === null ? null : rowToStoredPublicRun(row);
}

export async function getLatest(db: D1Database): Promise<StoredLatestRunResponse | null> {
  const row = await db
    .prepare(
      `SELECT r.run_id, r.payload_sha256, r.public_payload_json, r.summary_json,
              r.published_at, s.generation
       FROM site_state AS s
       INNER JOIN runs AS r ON r.run_id = s.latest_run_id
       WHERE s.key = 'latest'`,
    )
    .first<LatestRunRow>();
  if (row === null) {
    return null;
  }
  const generation = count(row.generation);
  const stored = rowToStoredPublicRun(row);
  return {
    body: `${stored.body.slice(0, -1)},"generation":${generation}}`,
    generation,
    publication: stored.publication,
  };
}

const LIST_COLUMNS = `
  run_id, schema_version, payload_sha256, suite_version, protocol_version,
  runner_version, codex_cli_version, started_at, ended_at, status, published_at,
  json_extract(public_payload_json, '$.mode') AS mode,
  json_extract(summary_json, '$.coverage.selectedCells') AS selected_cells,
  json_extract(summary_json, '$.coverage.measuredCells') AS measured_cells,
  json_extract(summary_json, '$.coverage.unmeasuredCells') AS unmeasured_cells,
  json_extract(summary_json, '$.coverage.expectedMeasuredSamples') AS expected_measured_samples,
  json_extract(summary_json, '$.coverage.recordedMeasuredSamples') AS recorded_measured_samples,
  json_extract(summary_json, '$.reliability.measuredSamples') AS measured_samples,
  json_extract(summary_json, '$.reliability.validSamples') AS valid_samples,
  json_extract(summary_json, '$.reliability.invalidSamples') AS invalid_samples`;

export async function listRuns(
  db: D1Database,
  options: { cursor: string | null; limit: number },
): Promise<RunListResponse> {
  const key = options.cursor === null ? null : decodeCursor(options.cursor);
  const statement =
    key === null
      ? db.prepare(
          `SELECT ${LIST_COLUMNS}
           FROM runs
           ORDER BY published_at DESC, run_id DESC
           LIMIT ?`,
        ).bind(options.limit + 1)
      : db
          .prepare(
            `SELECT ${LIST_COLUMNS}
             FROM runs
             WHERE published_at < ? OR (published_at = ? AND run_id < ?)
             ORDER BY published_at DESC, run_id DESC
             LIMIT ?`,
          )
          .bind(key.publishedAt, key.publishedAt, key.runId, options.limit + 1);
  const rows = (await statement.all<RunListRow>()).results;
  const pageRows = rows.slice(0, options.limit);
  const data = pageRows.map(listRowToMetadata);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > options.limit && last !== undefined
      ? encodeCursor({ publishedAt: last.published_at, runId: last.run_id })
      : null;

  return { data, nextCursor };
}
