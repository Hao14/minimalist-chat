import { Buffer } from "node:buffer";

export type BrowserResourceType =
  | "document"
  | "stylesheet"
  | "image"
  | "media"
  | "font"
  | "script"
  | "xhr"
  | "fetch"
  | "websocket"
  | "other";

export interface BrowserNetworkRequest {
  readonly method: string;
  readonly resourceType: BrowserResourceType;
  readonly url: string;
}

export interface BrowserRequestAbortDecision {
  readonly action: "abort";
  readonly reason: "external_network_blocked" | "request_limit_exceeded";
}

export interface BrowserPageEvent {
  readonly type: "console_error" | "page_error";
}

export interface BrowserPagePort {
  interceptRequests(
    handler: (request: BrowserNetworkRequest) => BrowserRequestAbortDecision,
  ): Promise<void>;
  onError(handler: (event: BrowserPageEvent) => void): void;
  setContent(
    html: string,
    options: Readonly<{ signal: AbortSignal; timeoutMs: number }>,
  ): Promise<void>;
  waitForSettled(
    options: Readonly<{ signal: AbortSignal; timeoutMs: number; quietWindowMs: number }>,
  ): Promise<void>;
  content(options: Readonly<{ signal: AbortSignal }>): Promise<string>;
  close(force?: boolean): Promise<void>;
}

export interface BrowserInstancePort {
  newPage(options: Readonly<{ signal: AbortSignal }>): Promise<BrowserPagePort>;
  close(force?: boolean): Promise<void>;
}

export interface BrowserEnginePort {
  launch(
    options: Readonly<{
      executablePath: string;
      maxMemoryMb: number;
      signal: AbortSignal;
    }>,
  ): Promise<BrowserInstancePort>;
}

export interface BrowserRenderLimits {
  readonly executablePath: string;
  readonly timeoutMs: number;
  readonly settleTimeoutMs: number;
  readonly quietWindowMs: number;
  readonly maxRawHtmlBytes: number;
  readonly maxRenderedHtmlBytes: number;
  readonly maxBlockedRequests: number;
  readonly maxMemoryMb: number;
  readonly closeTimeoutMs: number;
}

export interface BrowserRenderInput {
  readonly url: string;
  readonly rawHtml: string;
  readonly signal?: AbortSignal;
}

export interface BlockedBrowserRequest {
  readonly method: string;
  readonly resourceType: BrowserResourceType;
  readonly url: string;
  readonly reason: BrowserRequestAbortDecision["reason"];
}

export type BrowserRenderingErrorCode =
  | "browser_error"
  | "console_error"
  | "external_request_blocked"
  | "page_error"
  | "render_cancelled"
  | "render_input_too_large"
  | "render_output_too_large"
  | "render_request_limit"
  | "render_timeout";

export interface BrowserRenderingError {
  readonly code: BrowserRenderingErrorCode;
  readonly message: string;
}

export interface BrowserRenderResult {
  readonly status: "rendered" | "failed" | "cancelled";
  readonly renderedHtml: string | null;
  readonly blockedRequests: readonly BlockedBrowserRequest[];
  readonly blockedRequestCount: number;
  readonly errors: readonly BrowserRenderingError[];
  readonly durationMs: number;
}

export interface RenderEligibilitySignals {
  readonly meaningfulTextCharacters: number;
  readonly hasCriticalMetadata: boolean;
  readonly clientRendered: boolean;
}

export type RenderReason =
  "client_rendered" | "critical_metadata_missing" | "no_meaningful_content";

export function shouldRenderPage(
  enabled: boolean,
  signals: RenderEligibilitySignals,
): RenderReason | null {
  if (!enabled) return null;
  if (signals.clientRendered) return "client_rendered";
  if (signals.meaningfulTextCharacters < 80) return "no_meaningful_content";
  if (!signals.hasCriticalMetadata) return "critical_metadata_missing";
  return null;
}

function renderingError(code: BrowserRenderingErrorCode): BrowserRenderingError {
  const messages: Readonly<Record<BrowserRenderingErrorCode, string>> = Object.freeze({
    browser_error: "The isolated browser could not render the page.",
    console_error: "The page emitted an error-level console event while rendering.",
    external_request_blocked: "An external browser request was blocked.",
    page_error: "The page emitted a script error while rendering.",
    render_cancelled: "Page rendering was cancelled.",
    render_input_too_large: "The raw HTML exceeded the rendering input limit.",
    render_output_too_large: "The rendered HTML exceeded the rendering output limit.",
    render_request_limit: "The page exceeded the blocked-request limit.",
    render_timeout: "Page rendering exceeded its time limit.",
  });
  return Object.freeze({ code, message: messages[code] });
}

function sanitizedRequestUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    const serialized = parsed.toString();
    return serialized.length <= 2_048 ? serialized : `${serialized.slice(0, 2_045)}...`;
  } catch {
    return "<invalid-url>";
  }
}

function validateLimits(limits: BrowserRenderLimits): Readonly<BrowserRenderLimits> {
  if (limits.executablePath.trim() === "" || limits.executablePath.length > 2_048) {
    throw new TypeError("Rendering requires an explicit browser executable path.");
  }
  const boundedIntegers: readonly [number, number, number, string][] = [
    [limits.timeoutMs, 500, 30_000, "timeoutMs"],
    [limits.settleTimeoutMs, 0, 10_000, "settleTimeoutMs"],
    [limits.quietWindowMs, 0, 5_000, "quietWindowMs"],
    [limits.maxRawHtmlBytes, 1_024, 10 * 1_024 * 1_024, "maxRawHtmlBytes"],
    [limits.maxRenderedHtmlBytes, 1_024, 10 * 1_024 * 1_024, "maxRenderedHtmlBytes"],
    [limits.maxBlockedRequests, 1, 1_000, "maxBlockedRequests"],
    [limits.maxMemoryMb, 64, 2_048, "maxMemoryMb"],
    [limits.closeTimeoutMs, 100, 10_000, "closeTimeoutMs"],
  ];
  for (const [value, minimum, maximum, name] of boundedIntegers) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new TypeError(`The rendering ${name} value is outside the supported bounds.`);
    }
  }
  return Object.freeze({ ...limits, executablePath: limits.executablePath.trim() });
}

function timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(message)), milliseconds);
    handle.unref();
    void promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      operation();
    };
    const onAbort = (): void => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

function result(
  status: BrowserRenderResult["status"],
  renderedHtml: string | null,
  blockedRequests: readonly BlockedBrowserRequest[],
  blockedRequestCount: number,
  errors: readonly BrowserRenderingError[],
  startedAt: number,
): BrowserRenderResult {
  return Object.freeze({
    status,
    renderedHtml,
    blockedRequests: Object.freeze([...blockedRequests]),
    blockedRequestCount,
    errors: Object.freeze([...errors]),
    durationMs: Math.max(0, performance.now() - startedAt),
  });
}

export class BoundedBrowserRenderer {
  readonly #activeControllers = new Set<AbortController>();
  readonly #engine: BrowserEnginePort;
  readonly #lifecycleController = new AbortController();
  readonly #limits: Readonly<BrowserRenderLimits>;
  #browser: BrowserInstancePort | undefined;
  #launchPromise: Promise<BrowserInstancePort> | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(engine: BrowserEnginePort, limits: BrowserRenderLimits) {
    this.#engine = engine;
    this.#limits = validateLimits(limits);
  }

  async render(input: BrowserRenderInput): Promise<BrowserRenderResult> {
    const startedAt = performance.now();
    if (this.#closePromise !== undefined || this.#lifecycleController.signal.aborted) {
      return result("cancelled", null, [], 0, [renderingError("render_cancelled")], startedAt);
    }
    if (Buffer.byteLength(input.rawHtml, "utf8") > this.#limits.maxRawHtmlBytes) {
      return result("failed", null, [], 0, [renderingError("render_input_too_large")], startedAt);
    }

    const renderController = new AbortController();
    this.#activeControllers.add(renderController);
    const deadlineController = new AbortController();
    const deadline = setTimeout(
      () => deadlineController.abort("render-timeout"),
      this.#limits.timeoutMs,
    );
    deadline.unref();
    const signals = [
      renderController.signal,
      deadlineController.signal,
      this.#lifecycleController.signal,
      ...(input.signal === undefined ? [] : [input.signal]),
    ];
    const signal = AbortSignal.any(signals);
    const blockedRequests: BlockedBrowserRequest[] = [];
    const errors: BrowserRenderingError[] = [];
    const appendError = (code: BrowserRenderingErrorCode): void => {
      if (!errors.some((error) => error.code === code)) errors.push(renderingError(code));
    };
    let blockedRequestCount = 0;
    let requestLimitExceeded = false;
    let page: BrowserPagePort | undefined;

    try {
      const browser = await raceAbort(this.#browserForRendering(), signal);
      if (signal.aborted) throw signal.reason;
      page = await raceAbort(browser.newPage({ signal }), signal);
      page.onError((event) => {
        appendError(event.type);
      });
      await raceAbort(
        page.interceptRequests((request) => {
          blockedRequestCount += 1;
          const reason =
            blockedRequestCount > this.#limits.maxBlockedRequests
              ? "request_limit_exceeded"
              : "external_network_blocked";
          if (blockedRequests.length < this.#limits.maxBlockedRequests) {
            blockedRequests.push(
              Object.freeze({
                method: request.method.slice(0, 16).toUpperCase(),
                resourceType: request.resourceType,
                url: sanitizedRequestUrl(request.url),
                reason,
              }),
            );
          }
          if (reason === "request_limit_exceeded" && !requestLimitExceeded) {
            requestLimitExceeded = true;
            appendError("render_request_limit");
            renderController.abort("render-request-limit");
          } else if (reason === "external_network_blocked") {
            appendError("external_request_blocked");
          }
          return Object.freeze({ action: "abort", reason });
        }),
        signal,
      );
      await raceAbort(
        page.setContent(input.rawHtml, { signal, timeoutMs: this.#limits.timeoutMs }),
        signal,
      );
      if (this.#limits.settleTimeoutMs > 0) {
        await raceAbort(
          page.waitForSettled({
            signal,
            timeoutMs: this.#limits.settleTimeoutMs,
            quietWindowMs: this.#limits.quietWindowMs,
          }),
          signal,
        );
      }
      const renderedHtml = await raceAbort(page.content({ signal }), signal);
      if (Buffer.byteLength(renderedHtml, "utf8") > this.#limits.maxRenderedHtmlBytes) {
        return result(
          "failed",
          null,
          blockedRequests,
          blockedRequestCount,
          [...errors, renderingError("render_output_too_large")],
          startedAt,
        );
      }
      return result(
        "rendered",
        renderedHtml,
        blockedRequests,
        blockedRequestCount,
        errors,
        startedAt,
      );
    } catch {
      if (input.signal?.aborted === true || this.#lifecycleController.signal.aborted) {
        return result(
          "cancelled",
          null,
          blockedRequests,
          blockedRequestCount,
          [...errors, renderingError("render_cancelled")],
          startedAt,
        );
      }
      const code: BrowserRenderingErrorCode = deadlineController.signal.aborted
        ? "render_timeout"
        : requestLimitExceeded
          ? "render_request_limit"
          : "browser_error";
      appendError(code);
      return result("failed", null, blockedRequests, blockedRequestCount, errors, startedAt);
    } finally {
      clearTimeout(deadline);
      renderController.abort("render-complete");
      this.#activeControllers.delete(renderController);
      if (page !== undefined) {
        try {
          await timeout(page.close(), this.#limits.closeTimeoutMs, "Browser page close timed out.");
        } catch {
          try {
            await timeout(
              page.close(true),
              this.#limits.closeTimeoutMs,
              "Forced browser page close timed out.",
            );
          } catch {
            // The shared browser is closed by close(); no unbounded wait is permitted here.
          }
        }
      }
    }
  }

  close(): Promise<void> {
    this.#closePromise ??= (async () => {
      this.#lifecycleController.abort("renderer-shutdown");
      for (const controller of this.#activeControllers) controller.abort("renderer-shutdown");
      let browser: BrowserInstancePort | undefined = this.#browser;
      if (browser === undefined && this.#launchPromise !== undefined) {
        try {
          browser = await timeout(
            this.#launchPromise,
            this.#limits.closeTimeoutMs,
            "Browser launch did not stop during shutdown.",
          );
        } catch {
          return;
        }
      }
      if (browser === undefined) return;
      try {
        await timeout(browser.close(), this.#limits.closeTimeoutMs, "Browser close timed out.");
      } catch {
        try {
          await timeout(
            browser.close(true),
            this.#limits.closeTimeoutMs,
            "Forced browser close timed out.",
          );
        } catch {
          // Shutdown remains bounded even when the external browser process is unresponsive.
        }
      } finally {
        this.#browser = undefined;
      }
    })();
    return this.#closePromise;
  }

  #browserForRendering(): Promise<BrowserInstancePort> {
    if (this.#browser !== undefined) return Promise.resolve(this.#browser);
    if (this.#launchPromise !== undefined) return this.#launchPromise;
    const launchSignal = AbortSignal.any([
      this.#lifecycleController.signal,
      AbortSignal.timeout(this.#limits.timeoutMs),
    ]);
    const launch = this.#engine.launch({
      executablePath: this.#limits.executablePath,
      maxMemoryMb: this.#limits.maxMemoryMb,
      signal: launchSignal,
    });
    this.#launchPromise = launch.then(
      (browser) => {
        if (this.#lifecycleController.signal.aborted) {
          void browser.close(true).catch(() => undefined);
          throw new Error("The renderer stopped while the browser was starting.");
        }
        this.#browser = browser;
        this.#launchPromise = undefined;
        return browser;
      },
      (error: unknown) => {
        this.#launchPromise = undefined;
        throw error;
      },
    );
    return this.#launchPromise;
  }
}
