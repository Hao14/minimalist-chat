import type {
  BrowserEnginePort,
  BrowserInstancePort,
  BrowserNetworkRequest,
  BrowserPageEvent,
  BrowserPagePort,
  BrowserRequestAbortDecision,
  BrowserResourceType,
} from "./renderer.js";

export interface PlaywrightRequestPort {
  method(): string;
  resourceType(): string;
  url(): string;
}

export interface PlaywrightRoutePort {
  abort(errorCode?: "blockedbyclient"): Promise<void>;
  request(): PlaywrightRequestPort;
}

export interface PlaywrightConsoleMessagePort {
  type(): string;
}

export interface PlaywrightPagePort {
  close(options?: Readonly<{ runBeforeUnload?: boolean }>): Promise<void>;
  content(): Promise<string>;
  on(event: "console", handler: (message: PlaywrightConsoleMessagePort) => void): unknown;
  on(event: "pageerror", handler: (error: unknown) => void): unknown;
  setContent(
    html: string,
    options: Readonly<{ timeout: number; waitUntil: "domcontentloaded" }>,
  ): Promise<void>;
  waitForTimeout(milliseconds: number): Promise<void>;
}

export interface PlaywrightBrowserContextPort {
  close(): Promise<void>;
  newPage(): Promise<PlaywrightPagePort>;
  route(pattern: "**/*", handler: (route: PlaywrightRoutePort) => Promise<void>): Promise<unknown>;
}

export interface PlaywrightBrowserPort {
  close(): Promise<void>;
  newContext(
    options: Readonly<{
      acceptDownloads: false;
      bypassCSP: false;
      ignoreHTTPSErrors: false;
      javaScriptEnabled: true;
      serviceWorkers: "block";
    }>,
  ): Promise<PlaywrightBrowserContextPort>;
}

export interface PlaywrightChromiumLauncherPort {
  launch(
    options: Readonly<{
      args: string[];
      executablePath: string;
      headless: true;
    }>,
  ): Promise<PlaywrightBrowserPort>;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

function resourceType(value: string): BrowserResourceType {
  switch (value) {
    case "document":
    case "stylesheet":
    case "image":
    case "media":
    case "font":
    case "script":
    case "xhr":
    case "fetch":
    case "websocket":
      return value;
    default:
      return "other";
  }
}

class InjectedPlaywrightPage implements BrowserPagePort {
  readonly #context: PlaywrightBrowserContextPort;
  readonly #page: PlaywrightPagePort;

  constructor(context: PlaywrightBrowserContextPort, page: PlaywrightPagePort) {
    this.#context = context;
    this.#page = page;
  }

  async interceptRequests(
    handler: (request: BrowserNetworkRequest) => BrowserRequestAbortDecision,
  ): Promise<void> {
    await this.#context.route("**/*", async (route) => {
      const request = route.request();
      handler(
        Object.freeze({
          method: request.method(),
          resourceType: resourceType(request.resourceType()),
          url: request.url(),
        }),
      );
      // The adapter deliberately exposes no continue/fulfill path. Chromium may
      // execute inline JavaScript, but it cannot establish an outbound request.
      await route.abort("blockedbyclient");
    });
  }

  onError(handler: (event: BrowserPageEvent) => void): void {
    this.#page.on("console", (message) => {
      if (message.type() === "error") handler(Object.freeze({ type: "console_error" }));
    });
    this.#page.on("pageerror", () => handler(Object.freeze({ type: "page_error" })));
  }

  setContent(
    html: string,
    options: Readonly<{ signal: AbortSignal; timeoutMs: number }>,
  ): Promise<void> {
    return abortable(
      this.#page.setContent(html, {
        timeout: options.timeoutMs,
        waitUntil: "domcontentloaded",
      }),
      options.signal,
    );
  }

  waitForSettled(
    options: Readonly<{ signal: AbortSignal; timeoutMs: number; quietWindowMs: number }>,
  ): Promise<void> {
    const waitMs = Math.min(options.timeoutMs, options.quietWindowMs);
    return waitMs === 0
      ? Promise.resolve()
      : abortable(this.#page.waitForTimeout(waitMs), options.signal);
  }

  content(options: Readonly<{ signal: AbortSignal }>): Promise<string> {
    return abortable(this.#page.content(), options.signal);
  }

  async close(force = false): Promise<void> {
    if (force) {
      await this.#context.close();
      return;
    }
    try {
      await this.#page.close({ runBeforeUnload: false });
    } finally {
      await this.#context.close();
    }
  }
}

class InjectedPlaywrightBrowser implements BrowserInstancePort {
  readonly #browser: PlaywrightBrowserPort;

  constructor(browser: PlaywrightBrowserPort) {
    this.#browser = browser;
  }

  async newPage(options: Readonly<{ signal: AbortSignal }>): Promise<BrowserPagePort> {
    const context = await abortable(
      this.#browser.newContext({
        acceptDownloads: false,
        bypassCSP: false,
        ignoreHTTPSErrors: false,
        javaScriptEnabled: true,
        serviceWorkers: "block",
      }),
      options.signal,
    );
    try {
      const page = await abortable(context.newPage(), options.signal);
      return new InjectedPlaywrightPage(context, page);
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  close(): Promise<void> {
    return this.#browser.close();
  }
}

export function createPlaywrightBrowserEngine(
  chromium: PlaywrightChromiumLauncherPort,
): BrowserEnginePort {
  return Object.freeze({
    async launch(options: Parameters<BrowserEnginePort["launch"]>[0]) {
      const launch = chromium.launch({
        executablePath: options.executablePath,
        headless: true,
        args: [
          "--disable-background-networking",
          "--disable-breakpad",
          "--disable-client-side-phishing-detection",
          "--disable-component-update",
          "--disable-default-apps",
          "--disable-dev-shm-usage",
          "--disable-extensions",
          "--disable-features=MediaRouter,OptimizationHints,Translate",
          "--disable-hang-monitor",
          "--disable-prompt-on-repost",
          "--disable-renderer-backgrounding",
          "--disable-sync",
          "--metrics-recording-only",
          "--no-default-browser-check",
          "--no-first-run",
          `--js-flags=--max-old-space-size=${options.maxMemoryMb}`,
        ],
      });
      void launch
        .then((browser) => {
          if (options.signal.aborted) void browser.close().catch(() => undefined);
        })
        .catch(() => undefined);
      const browser = await abortable(launch, options.signal);
      return new InjectedPlaywrightBrowser(browser);
    },
  });
}
