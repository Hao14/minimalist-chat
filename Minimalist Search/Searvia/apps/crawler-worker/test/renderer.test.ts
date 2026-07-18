import { describe, expect, it, vi } from "vitest";

import {
  BoundedBrowserRenderer,
  shouldRenderPage,
  type BrowserEnginePort,
  type BrowserInstancePort,
  type BrowserNetworkRequest,
  type BrowserPageEvent,
  type BrowserPagePort,
  type BrowserRequestAbortDecision,
} from "../src/renderer.js";

class FakePage implements BrowserPagePort {
  readonly requests: readonly BrowserNetworkRequest[];
  readonly renderedHtml: string;
  readonly events: readonly BrowserPageEvent[];
  closeCalls: readonly boolean[] = [];
  decisions: BrowserRequestAbortDecision[] = [];
  #handler: ((request: BrowserNetworkRequest) => BrowserRequestAbortDecision) | undefined;
  #onError: ((event: BrowserPageEvent) => void) | undefined;

  constructor(
    renderedHtml: string,
    requests: readonly BrowserNetworkRequest[] = [],
    events: readonly BrowserPageEvent[] = [],
  ) {
    this.renderedHtml = renderedHtml;
    this.requests = requests;
    this.events = events;
  }

  async interceptRequests(
    handler: (request: BrowserNetworkRequest) => BrowserRequestAbortDecision,
  ): Promise<void> {
    this.#handler = handler;
  }

  onError(handler: (event: BrowserPageEvent) => void): void {
    this.#onError = handler;
  }

  async setContent(
    _html: string,
    options: Readonly<{ signal: AbortSignal; timeoutMs: number }>,
  ): Promise<void> {
    for (const request of this.requests) {
      const handler = this.#handler;
      if (handler === undefined) throw new Error("Request interception was not installed.");
      this.decisions.push(handler(request));
    }
    for (const event of this.events) this.#onError?.(event);
    if (options.signal.aborted) throw options.signal.reason;
  }

  async waitForSettled(): Promise<void> {}

  async content(): Promise<string> {
    return this.renderedHtml;
  }

  async close(force = false): Promise<void> {
    this.closeCalls = [...this.closeCalls, force];
  }
}

class FakeBrowser implements BrowserInstancePort {
  readonly page: FakePage;
  closeCalls: readonly boolean[] = [];

  constructor(page: FakePage) {
    this.page = page;
  }

  async newPage(): Promise<BrowserPagePort> {
    return this.page;
  }

  async close(force = false): Promise<void> {
    this.closeCalls = [...this.closeCalls, force];
  }
}

function engineFor(browser: FakeBrowser): BrowserEnginePort & { launchCalls: number } {
  return {
    launchCalls: 0,
    async launch(options) {
      this.launchCalls += 1;
      expect(options.executablePath).toBe("C:/browser/chrome.exe");
      expect(options.maxMemoryMb).toBe(256);
      return browser;
    },
  };
}

function limits() {
  return {
    executablePath: "C:/browser/chrome.exe",
    timeoutMs: 500,
    settleTimeoutMs: 100,
    quietWindowMs: 25,
    maxRawHtmlBytes: 1_024,
    maxRenderedHtmlBytes: 1_024,
    maxBlockedRequests: 2,
    maxMemoryMb: 256,
    closeTimeoutMs: 100,
  } as const;
}

describe("render eligibility", () => {
  it("renders only enabled pages that meet a bounded fallback condition", () => {
    expect(
      shouldRenderPage(false, {
        meaningfulTextCharacters: 0,
        hasCriticalMetadata: false,
        clientRendered: true,
      }),
    ).toBeNull();
    expect(
      shouldRenderPage(true, {
        meaningfulTextCharacters: 500,
        hasCriticalMetadata: true,
        clientRendered: true,
      }),
    ).toBe("client_rendered");
    expect(
      shouldRenderPage(true, {
        meaningfulTextCharacters: 10,
        hasCriticalMetadata: true,
        clientRendered: false,
      }),
    ).toBe("no_meaningful_content");
    expect(
      shouldRenderPage(true, {
        meaningfulTextCharacters: 500,
        hasCriticalMetadata: false,
        clientRendered: false,
      }),
    ).toBe("critical_metadata_missing");
    expect(
      shouldRenderPage(true, {
        meaningfulTextCharacters: 500,
        hasCriticalMetadata: true,
        clientRendered: false,
      }),
    ).toBeNull();
  });
});

describe("bounded browser rendering", () => {
  it("uses raw setContent output while aborting and recording every external request", async () => {
    const page = new FakePage(
      "<html><body><main>Inline JavaScript result</main></body></html>",
      [
        { method: "GET", resourceType: "script", url: "https://cdn.example.test/app.js" },
        {
          method: "GET",
          resourceType: "image",
          url: "https://user:password@images.example.test/pixel.png",
        },
      ],
      [{ type: "console_error" }],
    );
    const browser = new FakeBrowser(page);
    const renderer = new BoundedBrowserRenderer(engineFor(browser), limits());

    const rendered = await renderer.render({
      url: "https://example.test/",
      rawHtml: "<html><script>document.body.innerHTML='<main>result</main>'</script></html>",
    });

    expect(rendered).toMatchObject({
      status: "rendered",
      blockedRequestCount: 2,
      renderedHtml: expect.stringContaining("Inline JavaScript result"),
    });
    expect(page.decisions).toEqual([
      { action: "abort", reason: "external_network_blocked" },
      { action: "abort", reason: "external_network_blocked" },
    ]);
    expect(rendered.blockedRequests[1]?.url).toBe("https://images.example.test/pixel.png");
    expect(rendered.errors.map((error) => error.code)).toEqual([
      "external_request_blocked",
      "console_error",
    ]);
    expect(page.closeCalls).toEqual([false]);
    await renderer.close();
    await renderer.close();
    expect(browser.closeCalls).toEqual([false]);
  });

  it("fails the render when hostile markup exceeds the request-interception cap", async () => {
    const page = new FakePage(
      "<html></html>",
      Array.from({ length: 3 }, (_, index) => ({
        method: "GET",
        resourceType: "fetch" as const,
        url: `https://example.test/request-${index}`,
      })),
    );
    const renderer = new BoundedBrowserRenderer(engineFor(new FakeBrowser(page)), limits());

    const rendered = await renderer.render({ url: "https://example.test/", rawHtml: "<p>x</p>" });

    expect(rendered.status).toBe("failed");
    expect(rendered.blockedRequestCount).toBe(3);
    expect(rendered.blockedRequests).toHaveLength(2);
    expect(rendered.errors.some((error) => error.code === "render_request_limit")).toBe(true);
    await renderer.close();
  });

  it("rejects oversized input without launching a browser", async () => {
    const browser = new FakeBrowser(new FakePage("<html></html>"));
    const engine = engineFor(browser);
    const renderer = new BoundedBrowserRenderer(engine, limits());

    const rendered = await renderer.render({
      url: "https://example.test/",
      rawHtml: "x".repeat(1_025),
    });

    expect(rendered.status).toBe("failed");
    expect(rendered.errors).toEqual([expect.objectContaining({ code: "render_input_too_large" })]);
    expect(engine.launchCalls).toBe(0);
    await renderer.close();
  });

  it("does not return rendered HTML that exceeds its storage-facing byte cap", async () => {
    const page = new FakePage("x".repeat(1_025));
    const renderer = new BoundedBrowserRenderer(engineFor(new FakeBrowser(page)), limits());

    const rendered = await renderer.render({ url: "https://example.test/", rawHtml: "<p>x</p>" });

    expect(rendered.status).toBe("failed");
    expect(rendered.renderedHtml).toBeNull();
    expect(rendered.errors).toContainEqual(
      expect.objectContaining({ code: "render_output_too_large" }),
    );
    await renderer.close();
  });

  it("bounds a browser operation even when an adapter ignores its abort signal", async () => {
    vi.useFakeTimers();
    try {
      const page = new FakePage("<html></html>");
      page.setContent = () => new Promise<void>(() => {});
      const renderer = new BoundedBrowserRenderer(engineFor(new FakeBrowser(page)), limits());
      const pending = renderer.render({ url: "https://example.test/", rawHtml: "<p>x</p>" });

      await vi.advanceTimersByTimeAsync(500);
      const rendered = await pending;

      expect(rendered.status).toBe("failed");
      expect(rendered.errors).toEqual([expect.objectContaining({ code: "render_timeout" })]);
      await renderer.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
