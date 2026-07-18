import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { createTestSafeHttpClient } from "../src/testing.js";
import { afterEach, describe, expect, it } from "vitest";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        }),
    ),
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error("Expected the fixture server to be listening.");
  return `http://127.0.0.1:${address.port}`;
}

describe("safe HTTP request scheduling", () => {
  it("authorizes a redirect before holding the destination slot for requestOnce", async () => {
    const events: string[] = [];
    const targetOrigin = await listen(
      createServer((_request, response) => {
        events.push("network:target");
        response.writeHead(200, { "content-type": "text/html" });
        response.end("done");
      }),
    );
    const sourceOrigin = await listen(
      createServer((_request, response) => {
        events.push("network:source");
        response.writeHead(302, { location: `${targetOrigin}/final` });
        response.end();
      }),
    );
    const client = createTestSafeHttpClient({
      exactEndpoints: [sourceOrigin, targetOrigin],
      fetchLimits: {
        connectTimeoutMs: 1_000,
        dnsTimeoutMs: 1_000,
        headersTimeoutMs: 1_000,
        idleTimeoutMs: 1_000,
        requestTimeoutMs: 3_000,
      },
    });

    const response = await client.fetch({
      async authorizeRedirect(redirect) {
        events.push(`authorize:${redirect.toUrl}`);
      },
      kind: "page",
      async scheduleRequest(scheduled, operation) {
        events.push(`schedule:${scheduled.url}`);
        return operation();
      },
      scope: { hostname: "127.0.0.1", includeSubdomains: false },
      url: `${sourceOrigin}/`,
    });

    expect(response.finalUrl).toBe(`${targetOrigin}/final`);
    expect(events).toEqual([
      `schedule:${sourceOrigin}/`,
      "network:source",
      `authorize:${targetOrigin}/final`,
      `schedule:${targetOrigin}/final`,
      "network:target",
    ]);
  });

  it("returns bounded response evidence without persisting credential-bearing headers", async () => {
    const decodedBody = Buffer.from(`<html><body>${"evidence ".repeat(200)}</body></html>`);
    const encodedBody = gzipSync(decodedBody);
    const origin = await listen(
      createServer((_request, response) => {
        response.writeHead(200, {
          "cache-control": "public, max-age=60",
          "content-encoding": "gzip",
          "content-length": String(encodedBody.byteLength),
          "content-type": "text/html; charset=utf-8",
          authorization: "Bearer response-secret",
          "set-cookie": ["session=secret; HttpOnly", "preference=secret"],
          "strict-transport-security": "max-age=31536000",
          "x-fixture": ["first", "second"],
        });
        response.end(encodedBody);
      }),
    );
    const client = createTestSafeHttpClient({ exactEndpoints: [origin] });

    const response = await client.fetch({
      kind: "page",
      scope: { hostname: "127.0.0.1", includeSubdomains: false },
      url: `${origin}/evidence`,
    });

    expect(Buffer.from(response.body)).toEqual(decodedBody);
    expect(response.contentEncoding).toBe("gzip");
    expect(response.contentLength).toBe(encodedBody.byteLength);
    expect(response.transferBytes).toBe(encodedBody.byteLength);
    expect(response.responseBytes).toBe(decodedBody.byteLength);
    expect(response.responseHeaders["cache-control"]).toEqual(["public, max-age=60"]);
    expect(response.responseHeaders["strict-transport-security"]).toEqual(["max-age=31536000"]);
    expect(response.responseHeaders["x-fixture"]).toEqual(["first, second"]);
    expect(response.responseHeaders["set-cookie"]).toBeUndefined();
    expect(response.responseHeaders.authorization).toBeUndefined();
    expect(response.omittedResponseHeaders).toContain("authorization");
    expect(response.omittedResponseHeaders).toContain("set-cookie");
  });
});
