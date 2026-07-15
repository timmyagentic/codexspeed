import { RunUploadSchema, type RunUpload } from "@codexspeed/contracts";
import { summarizeRun, type RunSummary } from "@codexspeed/metrics";

import { verifyUploadRequest } from "./auth.js";
import { ProblemError, problem } from "./problem.js";
import {
  getLatest,
  getRun,
  insertRunAndAdvanceLatest,
  listRuns,
  type StoredPublicRunResponse,
} from "./repository.js";
import {
  IMMUTABLE_RUN_CACHE,
  matchesIfNoneMatch,
  NO_STORE_CACHE,
  payloadEtag,
  RUN_LIST_CACHE,
  withSecurityHeaders,
} from "./security.js";

const HEALTH_PATH = "/api/v1/health";
const LATEST_PATH = "/api/v1/latest";
const RUNS_PATH = "/api/v1/runs";
const RUN_PATH_PATTERN = /^\/api\/v1\/runs\/([0-9a-f-]+)$/iu;
const LIMIT_PATTERN = /^(?:[1-9]|[1-4][0-9]|50)$/u;
const DEFAULT_LIMIT = 20;

function jsonResponse(value: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "application/json",
    },
    status,
  });
}

function storedJsonResponse(
  value: StoredPublicRunResponse,
  status: number,
  cacheControl: string,
): Response {
  return new Response(value.body, {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "application/json",
    },
    status,
  });
}

function routeProblem(error: ProblemError, requestId: string): Response {
  return problem(error.status, error.code, error.title, requestId);
}

function notFound(title = "Resource not found"): ProblemError {
  return new ProblemError(404, "not_found", title);
}

function methodNotAllowed(): ProblemError {
  return new ProblemError(405, "method_not_allowed", "Method not allowed");
}

function invalidQuery(): ProblemError {
  return new ProblemError(400, "invalid_query", "Invalid query");
}

function invalidRun(): ProblemError {
  return new ProblemError(422, "invalid_run", "Invalid run document");
}

function idempotencyMismatch(): ProblemError {
  return new ProblemError(
    400,
    "idempotency_mismatch",
    "Idempotency key does not match run ID",
  );
}

function browserWriteForbidden(): ProblemError {
  return new ProblemError(403, "browser_write_forbidden", "Browser writes are not allowed");
}

function fullRunResponse(
  request: Request,
  value: StoredPublicRunResponse,
  cacheControl: string,
): Response {
  const etag = payloadEtag(value.publication.payloadSha256);
  if (matchesIfNoneMatch(request, etag)) {
    return new Response(null, {
      headers: { "Cache-Control": cacheControl, ETag: etag },
      status: 304,
    });
  }
  const response = storedJsonResponse(value, 200, cacheControl);
  response.headers.set("ETag", etag);
  return response;
}

function parseListOptions(url: URL): { cursor: string | null; limit: number } {
  for (const key of url.searchParams.keys()) {
    if (key !== "cursor" && key !== "limit") {
      throw invalidQuery();
    }
  }
  if (url.searchParams.getAll("cursor").length > 1 || url.searchParams.getAll("limit").length > 1) {
    throw invalidQuery();
  }

  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && cursor.length === 0) {
    throw invalidQuery();
  }
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null && !LIMIT_PATTERN.test(rawLimit)) {
    throw invalidQuery();
  }
  return {
    cursor,
    limit: rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit),
  };
}

function parseRunDocument(document: unknown): RunUpload {
  const parsed = RunUploadSchema.safeParse(document);
  if (!parsed.success) {
    throw invalidRun();
  }
  return parsed.data;
}

function summarizeValidatedRun(run: RunUpload): RunSummary {
  try {
    return summarizeRun(run);
  } catch (error) {
    if (error instanceof RangeError) {
      throw invalidRun();
    }
    throw error;
  }
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  if (request.headers.has("Origin")) {
    throw browserWriteForbidden();
  }

  const verified = await verifyUploadRequest(request, env, new Date());
  const run = parseRunDocument(verified.document);
  if (run.runId !== verified.idempotencyKey) {
    throw idempotencyMismatch();
  }
  const summary = summarizeValidatedRun(run);
  const result = await insertRunAndAdvanceLatest(env.DB, {
    payloadSha256: verified.bodySha256,
    publishedAt: new Date().toISOString(),
    run,
    summary,
  });
  return storedJsonResponse(result.value, result.created ? 201 : 200, NO_STORE_CACHE);
}

async function handleGet(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === HEALTH_PATH) {
    if (url.search.length > 0) {
      throw invalidQuery();
    }
    await env.DB.prepare(
      `SELECT run_id, schema_version, payload_sha256, suite_version, protocol_version,
              runner_version, codex_cli_version, started_at, ended_at, status,
              public_payload_json, summary_json, published_at
       FROM runs
       WHERE 0`,
    ).all();
    await env.DB.prepare(
      `SELECT key, latest_run_id, generation, updated_at
       FROM site_state
       WHERE 0`,
    ).all();
    return jsonResponse({ schemaVersion: 1, status: "ok" }, 200, NO_STORE_CACHE);
  }

  if (url.pathname === LATEST_PATH) {
    if (url.search.length > 0) {
      throw invalidQuery();
    }
    const latest = await getLatest(env.DB);
    if (latest === null) {
      throw notFound("No published run");
    }
    return fullRunResponse(request, latest, NO_STORE_CACHE);
  }

  if (url.pathname === RUNS_PATH) {
    return jsonResponse(await listRuns(env.DB, parseListOptions(url)), 200, RUN_LIST_CACHE);
  }

  const match = RUN_PATH_PATTERN.exec(url.pathname);
  if (match !== null) {
    if (url.search.length > 0) {
      throw invalidQuery();
    }
    const runId = match[1];
    if (runId === undefined) {
      throw notFound();
    }
    const run = await getRun(env.DB, runId);
    if (run === null) {
      throw notFound("Run not found");
    }
    return fullRunResponse(request, run, IMMUTABLE_RUN_CACHE);
  }

  throw notFound();
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === RUNS_PATH) {
    return handlePost(request, env);
  }
  if (request.method === "GET") {
    return handleGet(request, env, url);
  }
  if (
    url.pathname === HEALTH_PATH ||
    url.pathname === LATEST_PATH ||
    url.pathname === RUNS_PATH ||
    RUN_PATH_PATTERN.test(url.pathname)
  ) {
    throw methodNotAllowed();
  }
  throw notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      return withSecurityHeaders(await route(request, env));
    } catch (error) {
      if (error instanceof ProblemError) {
        return withSecurityHeaders(routeProblem(error, requestId));
      }

      console.error(
        JSON.stringify({
          errorClass: error instanceof Error ? error.name : typeof error,
          errorCode: "service_unavailable",
          event: "worker_request_failed",
          requestId,
        }),
      );
      return withSecurityHeaders(
        problem(503, "service_unavailable", "Service unavailable", requestId),
      );
    }
  },
} satisfies ExportedHandler<Env>;
