import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  buildPageArtifactKey,
  createS3CompatiblePageArtifactStore,
  type ArtifactStorageError,
  type S3CompatiblePageArtifactStoreOptions,
} from "../src/artifact-storage.js";

const scope = Object.freeze({
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  crawlId: "33333333-3333-4333-8333-333333333333",
  pageId: "44444444-4444-4444-8444-444444444444",
});

interface StoredObject {
  readonly body: Buffer;
  readonly headers: Headers;
}

function memoryS3() {
  let object: StoredObject | null = null;
  let putCount = 0;
  const requests: { readonly method: string; readonly url: string; readonly headers: Headers }[] =
    [];
  const fetch: NonNullable<S3CompatiblePageArtifactStoreOptions["fetch"]> = async (input, init) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    requests.push({ method, url: String(input), headers });
    if (method === "HEAD") {
      if (object === null) return new Response(null, { status: 404 });
      const responseHeaders = new Headers(object.headers);
      responseHeaders.set("content-length", String(object.body.byteLength));
      responseHeaders.set("etag", '"fixture-etag"');
      responseHeaders.set("last-modified", "Wed, 15 Jul 2026 12:34:56 GMT");
      responseHeaders.set("x-amz-version-id", "fixture-version");
      return new Response(null, { status: 200, headers: responseHeaders });
    }
    if (method === "GET") {
      if (object === null) return new Response(null, { status: 404 });
      return new Response(object.body, {
        status: 200,
        headers: { "content-length": String(object.body.byteLength) },
      });
    }
    if (method !== "PUT") return new Response(null, { status: 405 });
    putCount += 1;
    if (object !== null) return new Response(null, { status: 412 });
    const body = Buffer.from(await new Response(init?.body).arrayBuffer());
    object = Object.freeze({ body, headers });
    return new Response(null, {
      status: 200,
      headers: {
        date: "Wed, 15 Jul 2026 12:34:56 GMT",
        etag: '"fixture-etag"',
        "x-amz-version-id": "fixture-version",
      },
    });
  };
  return {
    fetch,
    get object(): StoredObject | null {
      return object;
    },
    get putCount(): number {
      return putCount;
    },
    requests,
  };
}

function options(
  fetch: NonNullable<S3CompatiblePageArtifactStoreOptions["fetch"]>,
): S3CompatiblePageArtifactStoreOptions {
  return {
    endpoint: "https://objects.example.test",
    region: "us-west-2",
    bucket: "searvia-private",
    accessKey: "test-access-key",
    secretKey: "test-secret-key",
    forcePathStyle: true,
    requestTimeoutMs: 1_000,
    maxHtmlBytes: 4_096,
    fetch,
    now: () => new Date("2026-07-15T12:34:56.000Z"),
  };
}

describe("page artifact keys", () => {
  it("constructs a tenant-derived key without accepting caller-controlled path segments", () => {
    expect(buildPageArtifactKey(scope, "raw-html")).toBe(
      "organizations/11111111-1111-4111-8111-111111111111/" +
        "projects/22222222-2222-4222-8222-222222222222/" +
        "crawls/33333333-3333-4333-8333-333333333333/" +
        "pages/44444444-4444-4444-8444-444444444444/raw-html.html.gz",
    );
  });

  it("rejects path traversal and non-UUID tenant scope", () => {
    expect(() =>
      buildPageArtifactKey({ ...scope, organizationId: "../../another-tenant" }, "raw-html"),
    ).toThrowError(
      expect.objectContaining<Partial<ArtifactStorageError>>({ code: "invalid_artifact_scope" }),
    );
  });

  it("cannot alias identical subordinate IDs across two tenant keys", () => {
    const otherTenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(buildPageArtifactKey({ ...scope, organizationId: otherTenant }, "raw-html")).not.toBe(
      buildPageArtifactKey(scope, "raw-html"),
    );
  });
});

describe("S3-compatible page artifact storage", () => {
  it("stores deterministic gzip through a private signed conditional request", async () => {
    const s3 = memoryS3();
    const store = createS3CompatiblePageArtifactStore(options(s3.fetch));
    const html = "<!doctype html><html><body>Stored evidence</body></html>";

    const stored = await store.store({ ...scope, kind: "raw-html", html });

    expect(stored).toMatchObject({
      ...scope,
      kind: "raw-html",
      bucket: "searvia-private",
      contentEncoding: "gzip",
      contentType: "text/html; charset=utf-8",
      originalBytes: Buffer.byteLength(html),
      etag: '"fixture-etag"',
      objectVersion: "fixture-version",
      storedAt: "2026-07-15T12:34:56.000Z",
      writeDisposition: "created",
    });
    expect(stored.contentSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(stored.storageSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(s3.object).not.toBeNull();
    expect(gunzipSync(s3.object?.body ?? Buffer.alloc(0)).toString("utf8")).toBe(html);
    const put = s3.requests.find((request) => request.method === "PUT");
    expect(put?.url).toBe(`https://objects.example.test/searvia-private/${stored.key}`);
    expect(put?.headers.get("if-none-match")).toBe("*");
    expect(put?.headers.get("cache-control")).toBe("private, no-store");
    expect(put?.headers.get("x-amz-date")).toBe("20260715T123456Z");
    expect(put?.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access-key\/20260715\/us-west-2\/s3\/aws4_request,/u,
    );
    expect(put?.headers.get("authorization")).not.toContain("test-secret-key");
    expect(put?.headers.get("x-amz-meta-organization-id")).toBe(scope.organizationId);
  });

  it("returns the immutable existing artifact for an idempotent replay", async () => {
    const s3 = memoryS3();
    const store = createS3CompatiblePageArtifactStore(options(s3.fetch));
    const input = { ...scope, kind: "rendered-html" as const, html: "<main>Rendered</main>" };

    expect((await store.store(input)).writeDisposition).toBe("created");
    expect((await store.store(input)).writeDisposition).toBe("existing");
    expect(s3.putCount).toBe(1);
  });

  it("loads and verifies the exact uncompressed bytes for a durable replay", async () => {
    const s3 = memoryS3();
    const store = createS3CompatiblePageArtifactStore(options(s3.fetch));
    const body = new Uint8Array([0x3c, 0x70, 0x3e, 0x80, 0xff, 0x3c, 0x2f, 0x70, 0x3e]);

    await store.store({ ...scope, kind: "raw-html", html: body });
    const loaded = await store.load(scope, "raw-html");

    expect(loaded?.body).toEqual(body);
    expect(loaded).toMatchObject({
      ...scope,
      kind: "raw-html",
      writeDisposition: "existing",
      originalBytes: body.byteLength,
    });
    expect(s3.requests.find((request) => request.method === "GET")?.url).toContain(
      "response-content-encoding=identity",
    );
  });

  it("fails closed instead of overwriting a tenant artifact with different content", async () => {
    const s3 = memoryS3();
    const store = createS3CompatiblePageArtifactStore(options(s3.fetch));
    await store.store({ ...scope, kind: "raw-html", html: "<p>first</p>" });

    await expect(
      store.store({ ...scope, kind: "raw-html", html: "<p>different</p>" }),
    ).rejects.toMatchObject({ code: "artifact_conflict", retryable: false });
    expect(s3.putCount).toBe(1);
  });

  it("rejects oversized HTML before contacting object storage", async () => {
    const s3 = memoryS3();
    const store = createS3CompatiblePageArtifactStore({
      ...options(s3.fetch),
      maxHtmlBytes: 1_024,
    });

    await expect(
      store.store({ ...scope, kind: "raw-html", html: "x".repeat(1_025) }),
    ).rejects.toMatchObject({ code: "artifact_too_large" });
    expect(s3.requests).toHaveLength(0);
  });
});
