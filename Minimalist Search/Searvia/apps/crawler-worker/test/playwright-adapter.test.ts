import { describe, expect, it, vi } from "vitest";

import {
  createPlaywrightBrowserEngine,
  type PlaywrightBrowserContextPort,
  type PlaywrightBrowserPort,
  type PlaywrightChromiumLauncherPort,
  type PlaywrightPagePort,
  type PlaywrightRoutePort,
} from "../src/playwright-adapter.js";

describe("injected Playwright browser adapter", () => {
  it("uses an isolated context and exposes an abort-only route for every request", async () => {
    let routeHandler: ((route: PlaywrightRoutePort) => Promise<void>) | undefined;
    let contextOptions: Parameters<PlaywrightBrowserPort["newContext"]>[0] | undefined;
    let launchOptions: Parameters<PlaywrightChromiumLauncherPort["launch"]>[0] | undefined;
    const routeAbort = vi.fn(async () => undefined);
    const page: PlaywrightPagePort = {
      close: vi.fn(async () => undefined),
      content: vi.fn(async () => "<html><body>rendered</body></html>"),
      on: () => undefined,
      setContent: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
    };
    const context: PlaywrightBrowserContextPort = {
      close: vi.fn(async () => undefined),
      newPage: vi.fn(async () => page),
      async route(_pattern, handler) {
        routeHandler = handler;
      },
    };
    const browser: PlaywrightBrowserPort = {
      close: vi.fn(async () => undefined),
      async newContext(options) {
        contextOptions = options;
        return context;
      },
    };
    const chromium: PlaywrightChromiumLauncherPort = {
      async launch(options) {
        launchOptions = options;
        return browser;
      },
    };
    const engine = createPlaywrightBrowserEngine(chromium);
    const instance = await engine.launch({
      executablePath: "C:/browser/chrome.exe",
      maxMemoryMb: 192,
      signal: new AbortController().signal,
    });
    const adaptedPage = await instance.newPage({ signal: new AbortController().signal });
    const observed: string[] = [];
    await adaptedPage.interceptRequests((request) => {
      observed.push(`${request.method} ${request.resourceType} ${request.url}`);
      return { action: "abort", reason: "external_network_blocked" };
    });
    const handler = routeHandler;
    if (handler === undefined) throw new Error("The context-wide route was not installed.");
    await handler({
      abort: routeAbort,
      request: () => ({
        method: () => "GET",
        resourceType: () => "script",
        url: () => "https://cdn.example.test/app.js",
      }),
    });

    expect(observed).toEqual(["GET script https://cdn.example.test/app.js"]);
    expect(routeAbort).toHaveBeenCalledExactlyOnceWith("blockedbyclient");
    expect(contextOptions).toEqual({
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      serviceWorkers: "block",
    });
    expect(launchOptions?.headless).toBe(true);
    expect(launchOptions?.executablePath).toBe("C:/browser/chrome.exe");
    expect(launchOptions?.args).toContain("--disable-background-networking");
    expect(launchOptions?.args).toContain("--js-flags=--max-old-space-size=192");
    expect(launchOptions?.args).not.toContain("--no-sandbox");
    expect(launchOptions?.args).not.toContain("--disable-popup-blocking");

    await adaptedPage.close();
    await instance.close();
    expect(page.close).toHaveBeenCalledExactlyOnceWith({ runBeforeUnload: false });
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
