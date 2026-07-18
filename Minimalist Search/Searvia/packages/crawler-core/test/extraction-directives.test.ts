import { applicableRobotsDirectives, extractPage } from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("crawler-specific robots directive ownership", () => {
  it("retains source owners and selects only global plus configured-crawler directives", () => {
    const body = `<!doctype html>
      <meta name="robots" content="index, follow">
      <meta name="googlebot" content="noindex">
      <meta name="searviabot" content="noarchive">
      <title>Scoped directives</title><main>Scoped directive fixture content.</main>`;
    const result = extractPage({
      contentType: "text/html; charset=utf-8",
      depth: 0,
      finalUrl: "https://example.com/",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": ["googlebot: noindex, nofollow", "SearviaBot: noarchive", "max-snippet:-1"],
      },
      includeSubdomains: false,
      normalizedUrl: "https://example.com/",
      raw: { body, kind: "raw" },
      redirectChain: [],
      requestedUrl: "https://example.com/",
      responseBytes: Buffer.byteLength(body),
      scopeHostname: "example.com",
      statusCode: 200,
      transferSize: Buffer.byteLength(body),
    });

    expect(result.raw.robots.meta.map(({ userAgent }) => userAgent)).toEqual([
      "robots",
      "googlebot",
      "searviabot",
    ]);
    expect(result.raw.robots.xRobotsTag.map(({ userAgent }) => userAgent)).toEqual([
      "googlebot",
      "searviabot",
      "*",
    ]);
    expect(
      applicableRobotsDirectives(result.raw.robots, "SearviaBot/1.0 (+https://example.com)"),
    ).toEqual({
      meta: ["index", "follow", "noarchive"],
      xRobotsTag: ["noarchive", "max-snippet:-1"],
    });
    expect(applicableRobotsDirectives(result.raw.robots, "Googlebot/2.1")).toEqual({
      meta: ["index", "follow", "noindex"],
      xRobotsTag: ["noindex", "nofollow", "max-snippet:-1"],
    });
  });

  it("reports exact-boundary directive and link extraction as complete", () => {
    const body = `<!doctype html>
      <meta name="robots" content="index">
      <meta name="searviabot" content="follow">
      <a href="/one">One</a><area href="/two" alt="Two">`;
    const result = extractPage(
      {
        contentType: "text/html",
        depth: 0,
        finalUrl: "https://example.com/",
        headers: { "x-robots-tag": ["index", "follow"] },
        includeSubdomains: false,
        normalizedUrl: "https://example.com/",
        raw: { body, kind: "raw" },
        redirectChain: [],
        requestedUrl: "https://example.com/",
        responseBytes: Buffer.byteLength(body),
        scopeHostname: "example.com",
        statusCode: 200,
        transferSize: Buffer.byteLength(body),
      },
      { maxExtractedItems: 2 },
    );

    expect(result.raw.robots).toMatchObject({ complete: true });
    expect(result.raw.robots.meta).toHaveLength(2);
    expect(result.raw.robots.xRobotsTag).toHaveLength(2);
    expect(result.raw.links).toHaveLength(2);
    expect(result.raw.linksComplete).toBe(true);
  });

  it("marks directive and link provenance incomplete when source bounds truncate observations", () => {
    const body = `<!doctype html>
      <meta name="robots" content="index">
      <meta name="searviabot" content="follow">
      <meta name="robots" content="noarchive">
      <a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>`;
    const result = extractPage(
      {
        contentType: "text/html",
        depth: 0,
        finalUrl: "https://example.com/",
        headers: { "x-robots-tag": ["index", "follow", "noarchive"] },
        includeSubdomains: false,
        normalizedUrl: "https://example.com/",
        raw: { body, kind: "raw" },
        redirectChain: [],
        requestedUrl: "https://example.com/",
        responseBytes: Buffer.byteLength(body),
        scopeHostname: "example.com",
        statusCode: 200,
        transferSize: Buffer.byteLength(body),
      },
      { maxExtractedItems: 2 },
    );

    expect(result.raw.robots).toMatchObject({ complete: false });
    expect(result.raw.robots.meta).toHaveLength(2);
    expect(result.raw.robots.xRobotsTag).toHaveLength(2);
    expect(result.raw.links).toHaveLength(2);
    expect(result.raw.linksComplete).toBe(false);
  });
});
