import type {
  CrawlPageConnection,
  CrawlPageDetailRecord,
  CrawlProgressRecord,
  OrganizationScope,
} from "@searvia/database/runtime";
import { isDatabaseDomainError } from "@searvia/database/runtime";
import { z } from "zod";

import { serializeCrawlProgress } from "./crawl-progress";
import {
  type CrawlPageApiCursor,
  decodeCrawlPageCursor,
  encodeCrawlPageCursor,
  serializeCrawlPage,
  serializeCrawlPageDetail,
} from "./crawl-pages";

const identifierSchema = z.uuid();
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z\d._-]{8,128}$/u;
const TRACE_ID_PATTERN = /^[A-Za-z\d._-]{8,128}$/u;
const MAX_MUTATION_BODY_BYTES = 1_024;

interface SessionIdentity {
  readonly user: Readonly<{ id: string }>;
  readonly session: Readonly<{ id: string }>;
}

interface CrawlApiRepository<TScope> {
  createCrawl(
    scope: TScope,
    projectId: string,
    input: Readonly<{ idempotencyKey: string; traceId: string }>,
  ): Promise<Readonly<{ crawl: CrawlProgressRecord; created: boolean }>>;
  listCrawls(
    scope: TScope,
    projectId: string,
    limit?: number,
  ): Promise<readonly CrawlProgressRecord[]>;
  getCrawl(scope: TScope, projectId: string, crawlId: string): Promise<CrawlProgressRecord>;
  listCrawlPages(
    scope: TScope,
    projectId: string,
    crawlId: string,
    input?: Readonly<{ limit?: number; cursor?: CrawlPageApiCursor | null }>,
  ): Promise<CrawlPageConnection>;
  getCrawlPage(
    scope: TScope,
    projectId: string,
    crawlId: string,
    pageId: string,
  ): Promise<CrawlPageDetailRecord>;
  requestCancellation(
    scope: TScope,
    projectId: string,
    crawlId: string,
    traceId: string,
  ): Promise<CrawlProgressRecord>;
}

export interface CrawlApiDependencies<TScope = OrganizationScope> {
  readonly trustedMutationOrigins: readonly string[];
  readonly generateTraceId: () => string;
  readonly getSession: () => Promise<SessionIdentity | null>;
  readonly loadScope: (userId: string, sessionId: string) => Promise<TScope | null>;
  readonly repository: CrawlApiRepository<TScope>;
  readonly onUnexpectedError?: (error: unknown, traceId: string) => void;
}

interface ApiErrorBody {
  readonly error: Readonly<{ code: string; message: string }>;
  readonly traceId: string;
}

function noStoreJson(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function apiError(code: string, message: string, status: number, traceId: string): Response {
  const body: ApiErrorBody = { error: { code, message }, traceId };
  return noStoreJson(body, status);
}

function traceIdFor<TScope>(
  request: Request,
  dependencies: CrawlApiDependencies<TScope>,
): string | Response {
  const supplied = request.headers.get("x-request-id");
  if (supplied === null) {
    return dependencies.generateTraceId();
  }
  if (!TRACE_ID_PATTERN.test(supplied)) {
    return apiError(
      "invalid_request",
      "The request trace ID is invalid.",
      400,
      dependencies.generateTraceId(),
    );
  }
  return supplied;
}

function validateIdentifier(
  value: string,
  kind: "project" | "crawl" | "page",
  traceId: string,
): Response | null {
  return identifierSchema.safeParse(value).success
    ? null
    : apiError("invalid_request", `The ${kind} identifier is invalid.`, 400, traceId);
}

function hasOnlySingleQueryValues(
  searchParams: URLSearchParams,
  allowed: ReadonlySet<string>,
): boolean {
  const names = new Set<string>();
  for (const [name] of searchParams) {
    if (!allowed.has(name) || names.has(name)) return false;
    names.add(name);
  }
  return true;
}

async function validateEmptyMutationBody(
  request: Request,
  traceId: string,
): Promise<Response | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return apiError("invalid_request", "The request body length is invalid.", 400, traceId);
    }
    if (length > MAX_MUTATION_BODY_BYTES) {
      return apiError("body_too_large", "The request body is too large.", 413, traceId);
    }
  }

  if (request.body === null) {
    return null;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_MUTATION_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return apiError("body_too_large", "The request body is too large.", 413, traceId);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return apiError("invalid_request", "The request body could not be read.", 400, traceId);
  }

  return body.trim() === ""
    ? null
    : apiError("invalid_request", "This endpoint does not accept a request body.", 400, traceId);
}

function validateMutationOrigin(
  request: Request,
  dependencies: Pick<CrawlApiDependencies, "trustedMutationOrigins">,
  traceId: string,
): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null || !dependencies.trustedMutationOrigins.includes(origin)) {
    return apiError("forbidden", "The request origin is not allowed.", 403, traceId);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return apiError("forbidden", "Cross-site mutation requests are not allowed.", 403, traceId);
  }

  return null;
}

async function loadAuthorizedScope<TScope>(
  dependencies: CrawlApiDependencies<TScope>,
  traceId: string,
): Promise<TScope | Response> {
  const session = await dependencies.getSession();
  if (session === null) {
    return apiError("unauthenticated", "Authentication is required.", 401, traceId);
  }

  const scope = await dependencies.loadScope(session.user.id, session.session.id);
  if (scope === null) {
    return apiError("forbidden", "Organization access is required.", 403, traceId);
  }
  return scope;
}

function databaseErrorResponse<TScope>(
  error: unknown,
  traceId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Response {
  if (!isDatabaseDomainError(error)) {
    dependencies.onUnexpectedError?.(error, traceId);
    return apiError("internal_error", "The crawl request could not be completed.", 500, traceId);
  }

  switch (error.code) {
    case "UNAUTHENTICATED":
      return apiError("unauthenticated", "Authentication is required.", 401, traceId);
    case "FORBIDDEN":
      return apiError("forbidden", "You do not have permission for this action.", 403, traceId);
    case "NOT_FOUND":
    case "INVITATION_INVALID":
      return apiError("not_found", "The requested resource was not found.", 404, traceId);
    case "CONFLICT":
      return apiError("conflict", error.message, 409, traceId);
    case "RATE_LIMITED":
      return apiError("rate_limited", "Too many crawl requests. Try again later.", 429, traceId);
  }
}

function isResponse<TScope>(value: TScope | Response): value is Response {
  return value instanceof Response;
}

export async function handleCreateCrawl<TScope>(
  request: Request,
  projectId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Promise<Response> {
  const traceId = traceIdFor(request, dependencies);
  if (traceId instanceof Response) return traceId;

  const identifierError = validateIdentifier(projectId, "project", traceId);
  if (identifierError !== null) return identifierError;

  const originError = validateMutationOrigin(request, dependencies, traceId);
  if (originError !== null) return originError;

  const bodyError = await validateEmptyMutationBody(request, traceId);
  if (bodyError !== null) return bodyError;

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey === null || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return apiError("invalid_request", "A valid Idempotency-Key header is required.", 400, traceId);
  }

  try {
    const scope = await loadAuthorizedScope(dependencies, traceId);
    if (isResponse(scope)) return scope;
    const result = await dependencies.repository.createCrawl(scope, projectId, {
      idempotencyKey,
      traceId,
    });
    return noStoreJson(
      { crawl: serializeCrawlProgress(result.crawl), created: result.created },
      result.created ? 202 : 200,
      { location: `/api/projects/${projectId}/crawls/${result.crawl.id}` },
    );
  } catch (error) {
    return databaseErrorResponse(error, traceId, dependencies);
  }
}

export async function handleListCrawls<TScope>(
  request: Request,
  projectId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Promise<Response> {
  const traceId = traceIdFor(request, dependencies);
  if (traceId instanceof Response) return traceId;

  const identifierError = validateIdentifier(projectId, "project", traceId);
  if (identifierError !== null) return identifierError;

  const searchParams = new URL(request.url).searchParams;
  const limitValue = searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (
    !hasOnlySingleQueryValues(searchParams, new Set(["limit"])) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (limitValue !== null && !/^[1-9]\d?$/u.test(limitValue))
  ) {
    return apiError("invalid_request", "The crawl list query is invalid.", 400, traceId);
  }

  try {
    const scope = await loadAuthorizedScope(dependencies, traceId);
    if (isResponse(scope)) return scope;
    const crawls = await dependencies.repository.listCrawls(scope, projectId, limit);
    return noStoreJson({ crawls: crawls.map(serializeCrawlProgress) }, 200);
  } catch (error) {
    return databaseErrorResponse(error, traceId, dependencies);
  }
}

export async function handleGetCrawl<TScope>(
  request: Request,
  projectId: string,
  crawlId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Promise<Response> {
  const traceId = traceIdFor(request, dependencies);
  if (traceId instanceof Response) return traceId;

  const projectError = validateIdentifier(projectId, "project", traceId);
  if (projectError !== null) return projectError;
  const crawlError = validateIdentifier(crawlId, "crawl", traceId);
  if (crawlError !== null) return crawlError;

  try {
    const scope = await loadAuthorizedScope(dependencies, traceId);
    if (isResponse(scope)) return scope;
    const crawl = await dependencies.repository.getCrawl(scope, projectId, crawlId);
    return noStoreJson({ crawl: serializeCrawlProgress(crawl) }, 200);
  } catch (error) {
    return databaseErrorResponse(error, traceId, dependencies);
  }
}

export async function handleListCrawlPages<TScope>(
  request: Request,
  projectId: string,
  crawlId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Promise<Response> {
  const traceId = traceIdFor(request, dependencies);
  if (traceId instanceof Response) return traceId;

  const projectError = validateIdentifier(projectId, "project", traceId);
  if (projectError !== null) return projectError;
  const crawlError = validateIdentifier(crawlId, "crawl", traceId);
  if (crawlError !== null) return crawlError;

  const searchParams = new URL(request.url).searchParams;
  if (!hasOnlySingleQueryValues(searchParams, new Set(["limit", "cursor"]))) {
    return apiError("invalid_request", "The crawl page list query is invalid.", 400, traceId);
  }

  const limitValue = searchParams.get("limit");
  const limit = limitValue === null ? 50 : Number(limitValue);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (limitValue !== null && !/^[1-9]\d{0,2}$/u.test(limitValue))
  ) {
    return apiError("invalid_request", "The crawl page list query is invalid.", 400, traceId);
  }

  const cursorValue = searchParams.get("cursor");
  const cursor = cursorValue === null ? null : decodeCrawlPageCursor(cursorValue, crawlId);
  if (cursorValue !== null && cursor === null) {
    return apiError("invalid_request", "The crawl page cursor is invalid.", 400, traceId);
  }

  try {
    const scope = await loadAuthorizedScope(dependencies, traceId);
    if (isResponse(scope)) return scope;
    const connection = await dependencies.repository.listCrawlPages(scope, projectId, crawlId, {
      limit,
      cursor,
    });
    return noStoreJson(
      {
        pages: connection.items.map(serializeCrawlPage),
        nextCursor: encodeCrawlPageCursor(connection.nextCursor),
      },
      200,
    );
  } catch (error) {
    return databaseErrorResponse(error, traceId, dependencies);
  }
}

export async function handleGetCrawlPage<TScope>(
  request: Request,
  projectId: string,
  crawlId: string,
  pageId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Promise<Response> {
  const traceId = traceIdFor(request, dependencies);
  if (traceId instanceof Response) return traceId;

  const projectError = validateIdentifier(projectId, "project", traceId);
  if (projectError !== null) return projectError;
  const crawlError = validateIdentifier(crawlId, "crawl", traceId);
  if (crawlError !== null) return crawlError;
  const pageError = validateIdentifier(pageId, "page", traceId);
  if (pageError !== null) return pageError;
  if ([...new URL(request.url).searchParams].length > 0) {
    return apiError(
      "invalid_request",
      "This crawl page endpoint does not accept a query.",
      400,
      traceId,
    );
  }

  try {
    const scope = await loadAuthorizedScope(dependencies, traceId);
    if (isResponse(scope)) return scope;
    const page = await dependencies.repository.getCrawlPage(scope, projectId, crawlId, pageId);
    return noStoreJson(serializeCrawlPageDetail(page), 200);
  } catch (error) {
    return databaseErrorResponse(error, traceId, dependencies);
  }
}

export async function handleCancelCrawl<TScope>(
  request: Request,
  projectId: string,
  crawlId: string,
  dependencies: CrawlApiDependencies<TScope>,
): Promise<Response> {
  const traceId = traceIdFor(request, dependencies);
  if (traceId instanceof Response) return traceId;

  const projectError = validateIdentifier(projectId, "project", traceId);
  if (projectError !== null) return projectError;
  const crawlError = validateIdentifier(crawlId, "crawl", traceId);
  if (crawlError !== null) return crawlError;

  const originError = validateMutationOrigin(request, dependencies, traceId);
  if (originError !== null) return originError;
  const bodyError = await validateEmptyMutationBody(request, traceId);
  if (bodyError !== null) return bodyError;

  try {
    const scope = await loadAuthorizedScope(dependencies, traceId);
    if (isResponse(scope)) return scope;
    const crawl = await dependencies.repository.requestCancellation(
      scope,
      projectId,
      crawlId,
      traceId,
    );
    return noStoreJson({ crawl: serializeCrawlProgress(crawl) }, 202);
  } catch (error) {
    return databaseErrorResponse(error, traceId, dependencies);
  }
}
