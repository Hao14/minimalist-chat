import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

export const CRAWLER_FIXTURE_KINDS = [
  "healthy",
  "robots-blocked",
  "robots-redirect-blocked",
  "redirect-chain",
  "redirect-loop",
  "private-ip-redirect",
  "oversized-response",
  "infinite-parameter-links",
  "sitemap-discovery",
  "broken-links",
  "timeout",
  "server-error",
] as const;

export type CrawlerFixtureKind = (typeof CRAWLER_FIXTURE_KINDS)[number];

export interface FixtureRequestRecord {
  readonly method: string;
  readonly path: string;
  readonly receivedAt: number;
}

export interface CrawlerFixtureSite {
  readonly kind: CrawlerFixtureKind;
  readonly origin: string;
  readonly trapOrigin: string | null;
  close(): Promise<void>;
  requestCount(path?: string): number;
  requests(): readonly FixtureRequestRecord[];
  trapRequestCount(path?: string): number;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as AddressInfo | null;
      if (address === null) {
        reject(new Error("Fixture server did not publish an address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
}

function html(response: ServerResponse, body: string, statusCode = 200): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function robots(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

export async function startCrawlerFixtureSite(
  kind: CrawlerFixtureKind,
): Promise<CrawlerFixtureSite> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Crawler fixture servers are available only when NODE_ENV=test.");
  }

  const records: FixtureRequestRecord[] = [];
  const trapRecords: FixtureRequestRecord[] = [];
  let origin = "";
  let trapOrigin: string | null = null;
  let serverErrorAttempts = 0;

  const trapServer = createServer((request, response) => {
    const path = request.url ?? "/";
    trapRecords.push({
      method: request.method ?? "GET",
      path,
      receivedAt: Date.now(),
    });
    if (kind === "robots-redirect-blocked" && path === "/robots.txt") {
      robots(response, "User-agent: SearviaBot\nDisallow: /private\nAllow: /\n");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("private trap should never be reached");
  });
  if (kind === "private-ip-redirect" || kind === "robots-redirect-blocked") {
    trapOrigin = await listen(trapServer);
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const rawPath = request.url ?? "/";
    records.push({
      method: request.method ?? "GET",
      path: rawPath,
      receivedAt: Date.now(),
    });
    const url = new URL(rawPath, origin);

    if (url.pathname === "/robots.txt") {
      if (kind === "robots-blocked") {
        robots(response, "User-agent: SearviaBot\nDisallow: /private\nAllow: /\n");
        return;
      }
      if (kind === "sitemap-discovery") {
        robots(
          response,
          `User-agent: SearviaBot\nAllow: /\nCrawl-delay: 0\nSitemap: ${origin}/sitemap.xml\n`,
        );
        return;
      }
      robots(response, "User-agent: SearviaBot\nAllow: /\n");
      return;
    }

    switch (kind) {
      case "healthy": {
        if (url.pathname === "/") {
          html(
            response,
            '<!doctype html><a href="/about">About</a><a href="/about#team">Duplicate</a><a href="/?utm_source=test">Tracking</a>',
          );
        } else if (url.pathname === "/about") {
          html(response, "<!doctype html><title>About</title>");
        } else {
          html(response, "Not found", 404);
        }
        return;
      }
      case "robots-blocked": {
        if (url.pathname === "/") {
          html(response, '<a href="/private">Private</a><a href="/public">Public</a>');
        } else if (url.pathname === "/private") {
          html(response, "This request violates robots.txt");
        } else {
          html(response, "Public");
        }
        return;
      }
      case "robots-redirect-blocked": {
        response.writeHead(302, { location: `${trapOrigin ?? ""}/private` });
        response.end();
        return;
      }
      case "redirect-chain": {
        if (url.pathname === "/") {
          response.writeHead(302, { location: "/middle" });
          response.end();
        } else if (url.pathname === "/middle") {
          response.writeHead(301, { location: "/final" });
          response.end();
        } else {
          html(response, "Redirect complete");
        }
        return;
      }
      case "redirect-loop": {
        response.writeHead(302, {
          location: url.pathname === "/loop-b" ? "/loop-a" : "/loop-b",
        });
        response.end();
        return;
      }
      case "private-ip-redirect": {
        response.writeHead(302, { location: `${trapOrigin ?? ""}/secret` });
        response.end();
        return;
      }
      case "oversized-response": {
        if (url.pathname === "/gzip") {
          const body = gzipSync(Buffer.alloc(256 * 1_024, 65));
          response.writeHead(200, {
            "content-encoding": "gzip",
            "content-type": "text/html",
          });
          response.end(body);
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        for (let index = 0; index < 32; index += 1) response.write(Buffer.alloc(16 * 1_024, 65));
        response.end();
        return;
      }
      case "infinite-parameter-links": {
        const page = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
        html(
          response,
          `<a href="/?page=${page + 1}">Next</a><a href="/?page=${page + 1}&utm_source=trap">Tracked next</a>`,
        );
        return;
      }
      case "sitemap-discovery": {
        if (url.pathname === "/sitemap.xml") {
          response.writeHead(200, { "content-type": "application/xml" });
          response.end(
            `<?xml version="1.0"?><urlset><url><loc>${origin}/from-sitemap</loc></url></urlset>`,
          );
        } else {
          html(response, url.pathname === "/from-sitemap" ? "From sitemap" : "Root");
        }
        return;
      }
      case "broken-links": {
        if (url.pathname === "/") html(response, '<a href="/missing">Missing</a>');
        else html(response, "Not found", 404);
        return;
      }
      case "timeout": {
        if (url.pathname === "/idle") {
          response.writeHead(200, { "content-type": "text/html" });
          response.write("partial");
          setTimeout(() => response.end("late"), 500).unref();
        } else {
          setTimeout(() => html(response, "Late headers"), 500).unref();
        }
        return;
      }
      case "server-error": {
        serverErrorAttempts += 1;
        if (serverErrorAttempts <= 2) {
          response.writeHead(503, {
            "content-type": "text/html",
            "retry-after": "0",
          });
          response.end("Temporary failure");
        } else {
          html(response, "Recovered");
        }
        return;
      }
    }
  });

  try {
    origin = await listen(server);
  } catch (error) {
    if (trapOrigin !== null) await close(trapServer);
    throw error;
  }

  let closed = false;
  return Object.freeze({
    kind,
    origin,
    trapOrigin,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await close(server);
      if (trapOrigin !== null) await close(trapServer);
    },
    requestCount(path?: string): number {
      return path === undefined
        ? records.length
        : records.filter((record) => record.path === path).length;
    },
    requests(): readonly FixtureRequestRecord[] {
      return Object.freeze(records.map((record) => Object.freeze({ ...record })));
    },
    trapRequestCount(path?: string): number {
      return path === undefined
        ? trapRecords.length
        : trapRecords.filter((record) => record.path === path).length;
    },
  });
}
