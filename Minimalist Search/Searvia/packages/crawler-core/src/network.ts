import { promises as dns } from "node:dns";
import { isIPv4, isIPv6, type LookupFunction } from "node:net";

import { CrawlError, throwIfAborted } from "./errors.js";
import { permitsTestEndpoint, type TestNetworkCapability } from "./test-access.js";
import type { DnsAddress, DnsResolver } from "./types.js";
import { assertSafeWebPort } from "./url.js";

const BLOCKED_HOSTNAMES = new Set([
  "instance-data",
  "instance-data.ec2.internal",
  "localhost",
  "localhost.localdomain",
  "metadata.azure.internal",
  "metadata.google.internal",
  "metadata.goog",
]);

const IPV4_BLOCKS: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV6_BLOCKS: readonly [string, number][] = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

function ipv4Number(address: string): number {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new CrawlError("dns_failure", "DNS returned an invalid IPv4 address.");
  }
  return (
    ((parts[0] ?? 0) * 2 ** 24 +
      (parts[1] ?? 0) * 2 ** 16 +
      (parts[2] ?? 0) * 256 +
      (parts[3] ?? 0)) >>>
    0
  );
}

function ipv6Number(address: string): bigint {
  const withoutZone = address.split("%")[0] ?? "";
  let normalized = withoutZone;
  const ipv4Tail = normalized.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/u)?.[1];
  if (ipv4Tail !== undefined) {
    const value = ipv4Number(ipv4Tail);
    normalized =
      normalized.slice(0, -ipv4Tail.length) +
      `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2)
    throw new CrawlError("dns_failure", "DNS returned an invalid IPv6 address.");
  const left = (halves[0] ?? "").split(":").filter(Boolean);
  const right = (halves[1] ?? "").split(":").filter(Boolean);
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    throw new CrawlError("dns_failure", "DNS returned an invalid IPv6 address.");
  }
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/iu.test(group))) {
    throw new CrawlError("dns_failure", "DNS returned an invalid IPv6 address.");
  }
  return groups.reduce((value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

function inIpv4Cidr(address: string, network: string, prefix: number): boolean {
  const value = ipv4Number(address);
  const base = ipv4Number(network);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function inIpv6Cidr(address: string, network: string, prefix: number): boolean {
  const value = ipv6Number(address);
  const base = ipv6Number(network);
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.replace(/\.$/u, "").toLowerCase();
  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost");
}

export function isBlockedIpAddress(address: string): boolean {
  if (isIPv4(address)) {
    return IPV4_BLOCKS.some(([network, prefix]) => inIpv4Cidr(address, network, prefix));
  }
  if (isIPv6(address)) {
    // Fail closed: currently allocated globally routable unicast space is 2000::/3.
    if (!inIpv6Cidr(address, "2000::", 3)) return true;
    return IPV6_BLOCKS.some(([network, prefix]) => inIpv6Cidr(address, network, prefix));
  }
  return true;
}

export const systemDnsResolver: DnsResolver = Object.freeze({
  async lookup(hostname: string): Promise<readonly DnsAddress[]> {
    const answers = await dns.lookup(hostname, { all: true, order: "verbatim" });
    return answers.flatMap((answer): readonly DnsAddress[] => {
      if (answer.family === 4 || answer.family === 6) {
        return [{ address: answer.address, family: answer.family }];
      }
      return [];
    });
  },
});

function resolveWithDeadline(
  resolver: DnsResolver,
  hostname: string,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<readonly DnsAddress[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    const succeed = (answers: readonly DnsAddress[]): void => {
      if (cleanup()) resolve(answers);
    };
    const fail = (error: unknown): void => {
      if (cleanup()) reject(error);
    };
    const onAbort = (): void => {
      fail(
        signal?.reason instanceof CrawlError
          ? signal.reason
          : new CrawlError("cancelled", "The crawl was cancelled.", { cause: signal?.reason }),
      );
    };
    const timeout = setTimeout(() => {
      fail(new CrawlError("dns_timeout", "DNS resolution timed out.", { transient: true }));
    }, milliseconds);
    timeout.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    void resolver.lookup(hostname).then(succeed, fail);
  });
}

export interface ValidatedDestination {
  readonly addresses: readonly DnsAddress[];
  readonly dnsMs: number;
  readonly url: URL;
}

export async function validateDestination(
  url: URL,
  resolver: DnsResolver,
  dnsTimeoutMs: number,
  signal?: AbortSignal,
  testCapability?: TestNetworkCapability,
): Promise<ValidatedDestination> {
  throwIfAborted(signal);
  const isTestEndpoint = permitsTestEndpoint(testCapability, url);

  const hostname = url.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  if (!isTestEndpoint && isBlockedHostname(hostname)) {
    throw new CrawlError("blocked_hostname", "The crawl hostname is not publicly routable.");
  }

  const started = performance.now();
  let addresses: readonly DnsAddress[];
  if (isIPv4(hostname)) addresses = [{ address: hostname, family: 4 }];
  else if (isIPv6(hostname)) addresses = [{ address: hostname, family: 6 }];
  else {
    try {
      addresses = await resolveWithDeadline(resolver, hostname, dnsTimeoutMs, signal);
    } catch (error) {
      if (error instanceof CrawlError) throw error;
      throw new CrawlError("dns_failure", "The crawl hostname could not be resolved.", {
        cause: error,
        transient: true,
      });
    }
  }
  throwIfAborted(signal);

  if (addresses.length === 0) {
    throw new CrawlError("dns_failure", "The crawl hostname returned no usable addresses.", {
      transient: true,
    });
  }

  for (const answer of addresses) {
    if (
      (answer.family === 4 && !isIPv4(answer.address)) ||
      (answer.family === 6 && !isIPv6(answer.address))
    ) {
      throw new CrawlError("dns_failure", "DNS returned an invalid address.");
    }
    if (!isTestEndpoint && isBlockedIpAddress(answer.address)) {
      throw new CrawlError("blocked_address", "The crawl destination is not publicly routable.");
    }
  }
  if (!isTestEndpoint) assertSafeWebPort(url);

  return Object.freeze({
    addresses: Object.freeze([...addresses]),
    dnsMs: performance.now() - started,
    url,
  });
}

export function createPinnedLookup(addresses: readonly DnsAddress[]): LookupFunction {
  const frozen = Object.freeze(addresses.map((answer) => Object.freeze({ ...answer })));
  return (_hostname, options, callback): void => {
    const eligible =
      options.family === 4 || options.family === 6
        ? frozen.filter((answer) => answer.family === options.family)
        : frozen;
    const selected = eligible.length === 0 ? frozen : eligible;
    if (selected.length === 0) {
      const error = new Error("No validated address is available.") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    if (options.all === true) {
      callback(
        null,
        selected.map((answer) => ({ ...answer })),
      );
      return;
    }
    const first = selected[0];
    if (first === undefined) {
      callback(new Error("No validated address is available."), "", 0);
      return;
    }
    callback(null, first.address, first.family);
  };
}
