import { createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const ARTIFACT_SCHEMA_VERSION = "1";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PageArtifactKind = "raw-html" | "rendered-html";

export interface ArtifactScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly pageId: string;
}

export interface StorePageArtifactInput extends ArtifactScope {
  readonly kind: PageArtifactKind;
  /** Raw responses remain byte-for-byte evidence; rendered markup is UTF-8 text. */
  readonly html: string | Uint8Array;
  readonly signal?: AbortSignal;
}

export interface StoredPageArtifact extends ArtifactScope {
  readonly kind: PageArtifactKind;
  readonly bucket: string;
  readonly key: string;
  readonly contentType: typeof HTML_CONTENT_TYPE;
  readonly contentEncoding: "gzip";
  readonly contentSha256: string;
  readonly storageSha256: string;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly etag: string | null;
  readonly objectVersion: string | null;
  readonly storedAt: string;
  readonly writeDisposition: "created" | "existing";
}

export interface LoadedPageArtifact extends StoredPageArtifact {
  /** The exact uncompressed bytes originally written for this artifact. */
  readonly body: Uint8Array;
}

export interface PageArtifactStore {
  store(input: StorePageArtifactInput): Promise<StoredPageArtifact>;
  load(
    scope: ArtifactScope,
    kind: PageArtifactKind,
    signal?: AbortSignal,
  ): Promise<LoadedPageArtifact | null>;
}

export class ArtifactStorageError extends Error {
  readonly code:
    | "artifact_conflict"
    | "artifact_missing"
    | "artifact_too_large"
    | "invalid_artifact_scope"
    | "object_storage_request_failed";
  readonly retryable: boolean;

  constructor(
    code: ArtifactStorageError["code"],
    message: string,
    options: Readonly<{ cause?: unknown; retryable?: boolean }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ArtifactStorageError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function canonicalId(name: keyof ArtifactScope, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new ArtifactStorageError(
      "invalid_artifact_scope",
      `The artifact ${name} is not a valid identifier.`,
    );
  }
  return normalized;
}

function canonicalScope(scope: ArtifactScope): ArtifactScope {
  return Object.freeze({
    organizationId: canonicalId("organizationId", scope.organizationId),
    projectId: canonicalId("projectId", scope.projectId),
    crawlId: canonicalId("crawlId", scope.crawlId),
    pageId: canonicalId("pageId", scope.pageId),
  });
}

export function buildPageArtifactKey(scope: ArtifactScope, kind: PageArtifactKind): string {
  const canonical = canonicalScope(scope);
  if (kind !== "raw-html" && kind !== "rendered-html") {
    throw new ArtifactStorageError("invalid_artifact_scope", "The artifact kind is invalid.");
  }
  return [
    "organizations",
    canonical.organizationId,
    "projects",
    canonical.projectId,
    "crawls",
    canonical.crawlId,
    "pages",
    canonical.pageId,
    `${kind}.html.gz`,
  ].join("/");
}

interface ObjectHead {
  readonly contentEncoding: string | null;
  readonly contentLength: number;
  readonly contentType: string | null;
  readonly etag: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly objectVersion: string | null;
  readonly storedAt: string;
}

interface PutObjectInput {
  readonly body: Uint8Array;
  readonly contentEncoding: "gzip";
  readonly contentType: typeof HTML_CONTENT_TYPE;
  readonly key: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

interface PrivateObjectClient {
  readonly bucket: string;
  head(key: string, signal?: AbortSignal): Promise<ObjectHead | null>;
  get(key: string, maximumBytes: number, signal?: AbortSignal): Promise<Uint8Array | null>;
  putIfAbsent(input: PutObjectInput): Promise<
    | Readonly<{
        state: "created";
        etag: string | null;
        objectVersion: string | null;
        storedAt: string;
      }>
    | Readonly<{ state: "precondition_failed" }>
  >;
}

type ObjectStorageFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface S3CompatiblePageArtifactStoreOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly sessionToken?: string;
  readonly forcePathStyle: boolean;
  readonly requestTimeoutMs: number;
  readonly maxHtmlBytes: number;
  readonly fetch?: ObjectStorageFetch;
  readonly now?: () => Date;
}

type S3ClientOptions = Omit<S3CompatiblePageArtifactStoreOptions, "maxHtmlBytes">;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`,
  );
}

function normalizedHeaderValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function boundedHeader(value: string | null, maximumLength: number): string | null {
  if (
    value === null ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\r\n]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function httpDate(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      await response.body?.cancel();
      throw new ArtifactStorageError(
        "artifact_conflict",
        "The stored artifact has an invalid compressed size.",
      );
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ArtifactStorageError(
          "artifact_conflict",
          "The stored artifact exceeds the compressed-size limit.",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function validateS3Options(options: S3ClientOptions): Readonly<{
  endpoint: URL;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  sessionToken: string | undefined;
  forcePathStyle: boolean;
  requestTimeoutMs: number;
  fetch: ObjectStorageFetch;
  now: () => Date;
}> {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch (cause) {
    throw new TypeError("The object-storage endpoint is invalid.", { cause });
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new TypeError(
      "The object-storage endpoint must be an HTTP(S) origin without credentials or a path.",
    );
  }
  if (
    !/^(?!.*\.\.)(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(
      options.bucket,
    )
  ) {
    throw new TypeError("The object-storage bucket is invalid.");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(options.region)) {
    throw new TypeError("The object-storage region is invalid.");
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9+=,.@_-]{0,255}$/u.test(options.accessKey) ||
    options.secretKey.trim() === "" ||
    /[\r\n]/u.test(options.sessionToken ?? "")
  ) {
    throw new TypeError("Object-storage credentials are required.");
  }
  if (
    !Number.isInteger(options.requestTimeoutMs) ||
    options.requestTimeoutMs < 100 ||
    options.requestTimeoutMs > 60_000
  ) {
    throw new TypeError("The object-storage request timeout is outside the supported bounds.");
  }
  if (!options.forcePathStyle && endpoint.hostname.includes(":")) {
    throw new TypeError("Virtual-host object storage cannot use an IPv6 endpoint.");
  }
  return Object.freeze({
    endpoint,
    region: options.region,
    bucket: options.bucket,
    accessKey: options.accessKey,
    secretKey: options.secretKey,
    sessionToken: options.sessionToken,
    forcePathStyle: options.forcePathStyle,
    requestTimeoutMs: options.requestTimeoutMs,
    fetch: options.fetch ?? globalThis.fetch,
    now: options.now ?? (() => new Date()),
  });
}

class SigV4PrivateObjectClient implements PrivateObjectClient {
  readonly #options: ReturnType<typeof validateS3Options>;

  constructor(options: S3ClientOptions) {
    this.#options = validateS3Options(options);
  }

  get bucket(): string {
    return this.#options.bucket;
  }

  async head(key: string, signal?: AbortSignal): Promise<ObjectHead | null> {
    const response = await this.#request("HEAD", key, new Uint8Array(), {}, signal);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#requestError(response.status);
    }
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      await response.body?.cancel();
      throw new ArtifactStorageError(
        "object_storage_request_failed",
        "Object storage returned invalid artifact metadata.",
        { retryable: false },
      );
    }
    const metadata: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      const prefix = "x-amz-meta-";
      if (name.startsWith(prefix)) metadata[name.slice(prefix.length)] = value;
    });
    await response.body?.cancel();
    return Object.freeze({
      contentEncoding: response.headers.get("content-encoding"),
      contentLength,
      contentType: response.headers.get("content-type"),
      etag: boundedHeader(response.headers.get("etag"), 1_024),
      metadata: Object.freeze(metadata),
      objectVersion: boundedHeader(response.headers.get("x-amz-version-id"), 2_048),
      storedAt:
        httpDate(response.headers.get("last-modified")) ?? this.#options.now().toISOString(),
    });
  }

  async get(key: string, maximumBytes: number, signal?: AbortSignal): Promise<Uint8Array | null> {
    const response = await this.#request(
      "GET",
      key,
      new Uint8Array(),
      { "accept-encoding": "identity" },
      signal,
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#requestError(response.status);
    }
    return readBoundedResponseBody(response, maximumBytes);
  }

  async putIfAbsent(input: PutObjectInput): Promise<
    | Readonly<{
        state: "created";
        etag: string | null;
        objectVersion: string | null;
        storedAt: string;
      }>
    | Readonly<{ state: "precondition_failed" }>
  > {
    const headers: Record<string, string> = {
      "cache-control": "private, no-store",
      "content-encoding": input.contentEncoding,
      "content-type": input.contentType,
      "if-none-match": "*",
    };
    for (const [name, value] of Object.entries(input.metadata)) {
      if (!/^[a-z0-9-]+$/u.test(name) || /[\r\n]/u.test(value)) {
        throw new TypeError("Artifact metadata contains an invalid name or value.");
      }
      headers[`x-amz-meta-${name}`] = value;
    }
    const response = await this.#request("PUT", input.key, input.body, headers, input.signal);
    if (response.status === 409 || response.status === 412) {
      await response.body?.cancel();
      return Object.freeze({ state: "precondition_failed" });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#requestError(response.status);
    }
    const result = Object.freeze({
      state: "created" as const,
      etag: boundedHeader(response.headers.get("etag"), 1_024),
      objectVersion: boundedHeader(response.headers.get("x-amz-version-id"), 2_048),
      storedAt: httpDate(response.headers.get("date")) ?? this.#options.now().toISOString(),
    });
    await response.body?.cancel();
    return result;
  }

  #objectUrl(key: string): URL {
    const url = new URL(this.#options.endpoint);
    const encodedKey = key.split("/").map(encodePathSegment).join("/");
    if (this.#options.forcePathStyle) {
      url.pathname = `/${encodePathSegment(this.#options.bucket)}/${encodedKey}`;
    } else {
      url.hostname = `${this.#options.bucket}.${url.hostname}`;
      url.pathname = `/${encodedKey}`;
    }
    return url;
  }

  async #request(
    method: "GET" | "HEAD" | "PUT",
    key: string,
    body: Uint8Array,
    inputHeaders: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = this.#objectUrl(key);
    if (method === "GET") url.searchParams.set("response-content-encoding", "identity");
    const now = this.#options.now();
    if (Number.isNaN(now.getTime()))
      throw new TypeError("The signing clock returned an invalid date.");
    const iso = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
    const date = iso.slice(0, 8);
    const payloadHash = sha256(body);
    const headers: Record<string, string> = {
      ...inputHeaders,
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": iso,
    };
    if (this.#options.sessionToken !== undefined) {
      headers["x-amz-security-token"] = this.#options.sessionToken;
    }
    const canonicalNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalHeaders = canonicalNames
      .map((name) => `${name}:${normalizedHeaderValue(headers[name] ?? "")}\n`)
      .join("");
    const signedHeaders = canonicalNames.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      method === "GET" ? "response-content-encoding=identity" : "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${date}/${this.#options.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", iso, credentialScope, sha256(canonicalRequest)].join(
      "\n",
    );
    const dateKey = hmac(`AWS4${this.#options.secretKey}`, date);
    const regionKey = hmac(dateKey, this.#options.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.#options.accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    delete headers.host;

    const timeoutSignal = AbortSignal.timeout(this.#options.requestTimeoutMs);
    const requestSignal =
      signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    try {
      return await this.#options.fetch(url, {
        method,
        headers,
        signal: requestSignal,
        ...(method === "PUT" ? { body: Buffer.from(body) } : {}),
      });
    } catch (cause) {
      throw new ArtifactStorageError(
        "object_storage_request_failed",
        "The private artifact store could not complete the request.",
        { cause, retryable: true },
      );
    }
  }

  #requestError(status: number): ArtifactStorageError {
    return new ArtifactStorageError(
      "object_storage_request_failed",
      "The private artifact store rejected the request.",
      { retryable: status === 408 || status === 429 || status >= 500 },
    );
  }
}

class S3CompatiblePageArtifactStore implements PageArtifactStore {
  readonly #client: PrivateObjectClient;
  readonly #maxHtmlBytes: number;

  constructor(client: PrivateObjectClient, maxHtmlBytes: number) {
    if (!Number.isInteger(maxHtmlBytes) || maxHtmlBytes < 1_024 || maxHtmlBytes > 5_000_000) {
      throw new TypeError("The HTML artifact byte limit is outside the supported bounds.");
    }
    this.#client = client;
    this.#maxHtmlBytes = maxHtmlBytes;
  }

  async load(
    inputScope: ArtifactScope,
    kind: PageArtifactKind,
    signal?: AbortSignal,
  ): Promise<LoadedPageArtifact | null> {
    const scope = canonicalScope(inputScope);
    const key = buildPageArtifactKey(scope, kind);
    const existing = await this.#client.head(key, signal);
    if (existing === null) return null;

    const expectedScopeMetadata = {
      "schema-version": ARTIFACT_SCHEMA_VERSION,
      "organization-id": scope.organizationId,
      "project-id": scope.projectId,
      "crawl-id": scope.crawlId,
      "page-id": scope.pageId,
      kind,
    } as const;
    const scopeMatches = Object.entries(expectedScopeMetadata).every(
      ([name, value]) => existing.metadata[name] === value,
    );
    const contentSha256 = existing.metadata["content-sha256"] ?? "";
    const storageSha256 = existing.metadata["storage-sha256"] ?? "";
    const originalBytesRaw = existing.metadata["original-bytes"] ?? "";
    const originalBytes = /^(?:0|[1-9]\d*)$/u.test(originalBytesRaw)
      ? Number.parseInt(originalBytesRaw, 10)
      : Number.NaN;
    const maximumStoredBytes = this.#maxHtmlBytes + 65_536;
    if (
      !scopeMatches ||
      existing.contentEncoding?.toLowerCase() !== "gzip" ||
      existing.contentType?.toLowerCase() !== HTML_CONTENT_TYPE ||
      existing.contentLength > maximumStoredBytes ||
      !Number.isSafeInteger(originalBytes) ||
      originalBytes < 0 ||
      originalBytes > this.#maxHtmlBytes ||
      !/^[a-f\d]{64}$/u.test(contentSha256) ||
      !/^[a-f\d]{64}$/u.test(storageSha256)
    ) {
      throw new ArtifactStorageError(
        "artifact_conflict",
        "The stored page artifact metadata is invalid.",
      );
    }

    const compressed = await this.#client.get(key, maximumStoredBytes, signal);
    if (compressed === null) {
      throw new ArtifactStorageError(
        "artifact_missing",
        "The stored page artifact disappeared while it was being loaded.",
      );
    }
    if (compressed.byteLength !== existing.contentLength || sha256(compressed) !== storageSha256) {
      throw new ArtifactStorageError(
        "artifact_conflict",
        "The stored page artifact does not match its immutable metadata.",
      );
    }

    let body: Buffer;
    try {
      body = await gunzipAsync(Buffer.from(compressed), {
        maxOutputLength: this.#maxHtmlBytes,
      });
    } catch (cause) {
      throw new ArtifactStorageError(
        "artifact_conflict",
        "The stored page artifact could not be decompressed safely.",
        { cause },
      );
    }
    if (body.byteLength !== originalBytes || sha256(body) !== contentSha256) {
      throw new ArtifactStorageError(
        "artifact_conflict",
        "The stored page artifact content does not match its immutable metadata.",
      );
    }
    return Object.freeze({
      ...scope,
      kind,
      bucket: this.#client.bucket,
      key,
      contentType: HTML_CONTENT_TYPE,
      contentEncoding: "gzip",
      body: Uint8Array.from(body),
      contentSha256,
      storageSha256,
      originalBytes,
      storedBytes: compressed.byteLength,
      etag: existing.etag,
      objectVersion: existing.objectVersion,
      storedAt: existing.storedAt,
      writeDisposition: "existing",
    });
  }

  async store(input: StorePageArtifactInput): Promise<StoredPageArtifact> {
    const scope = canonicalScope(input);
    const key = buildPageArtifactKey(scope, input.kind);
    const source =
      typeof input.html === "string" ? Buffer.from(input.html, "utf8") : Buffer.from(input.html);
    if (source.byteLength > this.#maxHtmlBytes) {
      throw new ArtifactStorageError(
        "artifact_too_large",
        "The page HTML exceeds the artifact storage limit.",
      );
    }
    const compressed = await gzipAsync(source, { level: 9 });
    const contentSha256 = sha256(source);
    const storageSha256 = sha256(compressed);
    const metadata = Object.freeze({
      "schema-version": ARTIFACT_SCHEMA_VERSION,
      "organization-id": scope.organizationId,
      "project-id": scope.projectId,
      "crawl-id": scope.crawlId,
      "page-id": scope.pageId,
      kind: input.kind,
      "content-sha256": contentSha256,
      "storage-sha256": storageSha256,
      "original-bytes": String(source.byteLength),
    });
    const descriptor = (
      writeDisposition: StoredPageArtifact["writeDisposition"],
      object: Readonly<{
        etag: string | null;
        objectVersion: string | null;
        storedAt: string;
      }>,
    ): StoredPageArtifact =>
      Object.freeze({
        ...scope,
        kind: input.kind,
        bucket: this.#client.bucket,
        key,
        contentType: HTML_CONTENT_TYPE,
        contentEncoding: "gzip",
        contentSha256,
        storageSha256,
        originalBytes: source.byteLength,
        storedBytes: compressed.byteLength,
        etag: object.etag,
        objectVersion: object.objectVersion,
        storedAt: object.storedAt,
        writeDisposition,
      });
    const existing = await this.#client.head(key, input.signal);
    if (existing !== null) {
      this.#assertExisting(existing, metadata, compressed.byteLength);
      return descriptor("existing", existing);
    }

    const result = await this.#client.putIfAbsent({
      key,
      body: compressed,
      contentType: HTML_CONTENT_TYPE,
      contentEncoding: "gzip",
      metadata,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (result.state === "created") return descriptor("created", result);

    const raced = await this.#client.head(key, input.signal);
    if (raced === null) {
      throw new ArtifactStorageError(
        "object_storage_request_failed",
        "The artifact write could not be reconciled.",
        { retryable: true },
      );
    }
    this.#assertExisting(raced, metadata, compressed.byteLength);
    return descriptor("existing", raced);
  }

  #assertExisting(
    existing: ObjectHead,
    expectedMetadata: Readonly<Record<string, string>>,
    expectedBytes: number,
  ): void {
    const metadataMatches = Object.entries(expectedMetadata).every(
      ([name, value]) => existing.metadata[name] === value,
    );
    if (
      !metadataMatches ||
      existing.contentLength !== expectedBytes ||
      existing.contentEncoding?.toLowerCase() !== "gzip" ||
      existing.contentType?.toLowerCase() !== HTML_CONTENT_TYPE
    ) {
      throw new ArtifactStorageError(
        "artifact_conflict",
        "The immutable page artifact key already contains different content.",
      );
    }
  }
}

export function createS3CompatiblePageArtifactStore(
  options: S3CompatiblePageArtifactStoreOptions,
): PageArtifactStore {
  const { maxHtmlBytes, ...clientOptions } = options;
  return new S3CompatiblePageArtifactStore(
    new SigV4PrivateObjectClient(clientOptions),
    maxHtmlBytes,
  );
}
