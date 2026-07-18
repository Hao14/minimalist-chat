import { CrawlError } from "./errors.js";
import type {
  CrawlClock,
  CrawlScope,
  DiscoverySource,
  FrontierEntry,
  QueryParameterPolicy,
} from "./types.js";
import { hashNormalizedUrl, isUrlInScope, normalizeCrawlUrl, urlVariantKey } from "./url.js";

export interface FrontierLimits {
  readonly excludePatterns: readonly string[];
  readonly includePatterns: readonly string[];
  readonly maxDepth: number;
  readonly maxDiscoveredUrls: number;
  readonly maxPages: number;
  readonly maxQueryVariantsPerPath: number;
  readonly queryPolicy: QueryParameterPolicy;
}

export interface FrontierCandidate {
  readonly countsTowardPageLimit?: boolean;
  readonly depth: number;
  readonly discoverySource: DiscoverySource;
  readonly requestedUrl: string;
}

export interface FrontierInitialState {
  readonly discoveredCount: number;
  readonly processedCount?: number;
}

export type FrontierAddResult =
  | Readonly<{ accepted: true; entry: FrontierEntry }>
  | Readonly<{
      accepted: false;
      reason: "depth" | "discovery_limit" | "duplicate" | "pattern" | "query_variants" | "scope";
    }>;

function globMatch(pattern: string, candidate: string): boolean {
  let patternIndex = 0;
  let candidateIndex = 0;
  let starIndex = -1;
  let starCandidateIndex = -1;
  while (candidateIndex < candidate.length) {
    const token = pattern[patternIndex];
    if (token === "?" || token === candidate[candidateIndex]) {
      patternIndex += 1;
      candidateIndex += 1;
      continue;
    }
    if (token === "*") {
      starIndex = patternIndex;
      starCandidateIndex = candidateIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starCandidateIndex += 1;
      candidateIndex = starCandidateIndex;
      continue;
    }
    return false;
  }
  while (pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

function validatePatterns(patterns: readonly string[]): readonly string[] {
  if (patterns.length > 50) throw new TypeError("A crawl may use at most 50 URL patterns.");
  return Object.freeze(
    patterns.map((pattern) => {
      const trimmed = pattern.trim();
      const hasControl = [...trimmed].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      });
      if (trimmed.length === 0 || trimmed.length > 256 || hasControl) {
        throw new TypeError("Crawl URL patterns must contain 1 to 256 safe characters.");
      }
      return trimmed;
    }),
  );
}

function matchesRules(
  normalizedUrl: string,
  includePatterns: readonly string[],
  excludePatterns: readonly string[],
): boolean {
  const url = new URL(normalizedUrl);
  const path = `${url.pathname}${url.search}`;
  const matches = (pattern: string): boolean =>
    globMatch(
      pattern,
      pattern.startsWith("http://") || pattern.startsWith("https://") ? normalizedUrl : path,
    );
  if (excludePatterns.some(matches)) return false;
  return includePatterns.length === 0 || includePatterns.some(matches);
}

function validateLimits(limits: FrontierLimits): Readonly<FrontierLimits> {
  if (!Number.isInteger(limits.maxPages) || limits.maxPages < 1 || limits.maxPages > 10_000) {
    throw new TypeError("maxPages must be between 1 and 10000.");
  }
  if (!Number.isInteger(limits.maxDepth) || limits.maxDepth < 0 || limits.maxDepth > 20) {
    throw new TypeError("maxDepth must be between 0 and 20.");
  }
  if (
    !Number.isInteger(limits.maxDiscoveredUrls) ||
    limits.maxDiscoveredUrls < limits.maxPages ||
    limits.maxDiscoveredUrls > 100_000
  ) {
    throw new TypeError("maxDiscoveredUrls must be bounded and no lower than maxPages.");
  }
  if (
    !Number.isInteger(limits.maxQueryVariantsPerPath) ||
    limits.maxQueryVariantsPerPath < 1 ||
    limits.maxQueryVariantsPerPath > 100
  ) {
    throw new TypeError("maxQueryVariantsPerPath must be between 1 and 100.");
  }
  return Object.freeze({
    ...limits,
    excludePatterns: validatePatterns(limits.excludePatterns),
    includePatterns: validatePatterns(limits.includePatterns),
  });
}

export class BreadthFirstFrontier {
  readonly #buckets = new Map<number, FrontierEntry[]>();
  readonly #chargedDiscoveries = new Set<string>();
  readonly #discarded = new Set<string>();
  readonly #limits: Readonly<FrontierLimits>;
  readonly #scope: CrawlScope;
  readonly #seen = new Set<string>();
  readonly #variantCounts = new Map<string, number>();
  #dequeued = 0;
  #dequeuedTowardPageLimit = 0;
  #discovered = 0;
  #queued = 0;
  #queuedOutsidePageLimit = 0;
  #remainingRestoreCount = 0;
  #sequence = 0;

  constructor(
    scope: CrawlScope,
    limits: FrontierLimits,
    initialState: FrontierInitialState = { discoveredCount: 0 },
  ) {
    this.#scope = Object.freeze({ ...scope });
    this.#limits = validateLimits(limits);
    if (
      !Number.isInteger(initialState.discoveredCount) ||
      initialState.discoveredCount < 0 ||
      initialState.discoveredCount > this.#limits.maxDiscoveredUrls
    ) {
      throw new TypeError(
        "The initial discovery count must be within the crawl-wide discovery limit.",
      );
    }
    this.#discovered = initialState.discoveredCount;
    const processedCount = initialState.processedCount ?? 0;
    if (
      !Number.isInteger(processedCount) ||
      processedCount < 0 ||
      processedCount > this.#limits.maxPages
    ) {
      throw new TypeError("The initial processed count must be within the crawl page limit.");
    }
    this.#dequeuedTowardPageLimit = processedCount;
    this.#remainingRestoreCount = initialState.discoveredCount;
    this.#sequence = initialState.discoveredCount;
  }

  get dequeuedCount(): number {
    return this.#dequeued;
  }

  get discoveredCount(): number {
    return this.#discovered;
  }

  get queuedCount(): number {
    return this.#queued;
  }

  get pageLimitReached(): boolean {
    return (
      this.#dequeuedTowardPageLimit >= this.#limits.maxPages && this.#queuedOutsidePageLimit === 0
    );
  }

  add(candidate: FrontierCandidate): FrontierAddResult {
    return this.#insert(candidate, true);
  }

  restore(candidate: FrontierCandidate): FrontierAddResult {
    return this.#insert(candidate, false);
  }

  #insert(candidate: FrontierCandidate, chargeDiscovery: boolean): FrontierAddResult {
    if (candidate.depth < 0 || candidate.depth > this.#limits.maxDepth) {
      return Object.freeze({ accepted: false, reason: "depth" });
    }
    if (chargeDiscovery && this.#discovered >= this.#limits.maxDiscoveredUrls) {
      return Object.freeze({ accepted: false, reason: "discovery_limit" });
    }
    if (!chargeDiscovery && this.#remainingRestoreCount === 0) {
      return Object.freeze({ accepted: false, reason: "discovery_limit" });
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeCrawlUrl(candidate.requestedUrl, {
        queryPolicy: this.#limits.queryPolicy,
      });
    } catch {
      return Object.freeze({ accepted: false, reason: "scope" });
    }
    if (!isUrlInScope(normalizedUrl, this.#scope)) {
      return Object.freeze({ accepted: false, reason: "scope" });
    }
    if (this.#seen.has(normalizedUrl)) {
      return Object.freeze({ accepted: false, reason: "duplicate" });
    }
    if (!matchesRules(normalizedUrl, this.#limits.includePatterns, this.#limits.excludePatterns)) {
      return Object.freeze({ accepted: false, reason: "pattern" });
    }

    const variantKey = urlVariantKey(normalizedUrl);
    const variants = this.#variantCounts.get(variantKey) ?? 0;
    if (variants >= this.#limits.maxQueryVariantsPerPath) {
      return Object.freeze({ accepted: false, reason: "query_variants" });
    }

    const entry = Object.freeze({
      countsTowardPageLimit: candidate.countsTowardPageLimit ?? true,
      depth: candidate.depth,
      discoverySource: candidate.discoverySource,
      normalizedUrl,
      requestedUrl: candidate.requestedUrl,
      sequence: this.#sequence,
      urlHash: hashNormalizedUrl(normalizedUrl),
    });
    this.#sequence += 1;
    this.#seen.add(normalizedUrl);
    this.#variantCounts.set(variantKey, variants + 1);
    if (chargeDiscovery) {
      this.#chargedDiscoveries.add(normalizedUrl);
      this.#discovered += 1;
    } else {
      this.#remainingRestoreCount -= 1;
    }
    this.#queued += 1;
    if (!entry.countsTowardPageLimit) this.#queuedOutsidePageLimit += 1;
    const bucket = this.#buckets.get(candidate.depth) ?? [];
    bucket.push(entry);
    this.#buckets.set(candidate.depth, bucket);
    return Object.freeze({ accepted: true, entry });
  }

  discardPersisted(entry: FrontierEntry): void {
    this.discard(entry);
    if (this.#chargedDiscoveries.delete(entry.normalizedUrl)) {
      this.#discovered = Math.max(0, this.#discovered - 1);
    }
  }

  discard(entry: FrontierEntry): void {
    if (this.#discarded.has(entry.normalizedUrl)) return;
    this.#discarded.add(entry.normalizedUrl);
    this.#queued = Math.max(0, this.#queued - 1);
    if (!entry.countsTowardPageLimit) {
      this.#queuedOutsidePageLimit = Math.max(0, this.#queuedOutsidePageLimit - 1);
    }
  }

  nextBatch(limit: number): readonly FrontierEntry[] {
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError("Batch limit must be positive.");
    if (this.pageLimitReached || this.#queued === 0) return [];

    const result: FrontierEntry[] = [];
    const availableDepths = [...this.#buckets.keys()].sort((left, right) => left - right);
    for (const depth of availableDepths) {
      const bucket = this.#buckets.get(depth);
      if (bucket === undefined) continue;
      const deferred: FrontierEntry[] = [];
      while (bucket.length > 0 && result.length < limit) {
        const entry = bucket.shift();
        if (entry === undefined) break;
        if (this.#discarded.delete(entry.normalizedUrl)) continue;
        if (entry.countsTowardPageLimit && this.#dequeuedTowardPageLimit >= this.#limits.maxPages) {
          deferred.push(entry);
          continue;
        }
        result.push(entry);
        this.#queued -= 1;
        this.#dequeued += 1;
        if (entry.countsTowardPageLimit) this.#dequeuedTowardPageLimit += 1;
        else this.#queuedOutsidePageLimit = Math.max(0, this.#queuedOutsidePageLimit - 1);
      }
      if (deferred.length > 0) bucket.unshift(...deferred);
      if (bucket.length === 0) this.#buckets.delete(depth);
      if (result.length > 0) break;
    }
    return Object.freeze(result);
  }
}

export const systemCrawlClock: CrawlClock = Object.freeze({
  now: () => Date.now(),
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason ?? new CrawlError("cancelled", "The crawl was cancelled."));
        return;
      }
      const handle = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      handle.unref();
      const onAbort = (): void => {
        clearTimeout(handle);
        reject(signal?.reason ?? new CrawlError("cancelled", "The crawl was cancelled."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
});

interface HostState {
  active: number;
  nextStartAt: number;
  readonly waiters: Array<{ readonly release: () => void }>;
  startGate: Promise<void>;
}

export class HostRequestScheduler {
  readonly #clock: CrawlClock;
  readonly #concurrency: number;
  readonly #delayMs: number;
  readonly #states = new Map<string, HostState>();

  constructor(clock: CrawlClock, concurrency: number, delayMs: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
      throw new TypeError("Per-host concurrency must be between 1 and 16.");
    }
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
      throw new TypeError("Per-host delay must be between 0 and 60000 ms.");
    }
    this.#clock = clock;
    this.#concurrency = concurrency;
    this.#delayMs = delayMs;
  }

  async run<T>(hostname: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const state = this.#states.get(hostname) ?? {
      active: 0,
      nextStartAt: 0,
      startGate: Promise.resolve(),
      waiters: [],
    };
    this.#states.set(hostname, state);
    if (state.active >= this.#concurrency) {
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          release: (): void => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        const onAbort = (): void => {
          const index = state.waiters.indexOf(waiter);
          if (index >= 0) state.waiters.splice(index, 1);
          reject(signal?.reason ?? new CrawlError("cancelled", "The crawl was cancelled."));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        state.waiters.push(waiter);
        if (signal?.aborted === true) onAbort();
      });
    }
    if (signal?.aborted === true) {
      throw signal.reason ?? new CrawlError("cancelled", "The crawl was cancelled.");
    }
    state.active += 1;

    const previousGate = state.startGate;
    state.startGate = (async () => {
      await previousGate;
      const waitMs = Math.max(0, state.nextStartAt - this.#clock.now());
      await this.#clock.sleep(waitMs, signal);
      state.nextStartAt = this.#clock.now() + this.#delayMs;
    })();

    try {
      await state.startGate;
      return await operation();
    } finally {
      state.active -= 1;
      state.waiters.shift()?.release();
    }
  }
}
