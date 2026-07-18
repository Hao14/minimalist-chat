const issuedCapabilities = new WeakMap<object, ReadonlySet<string>>();

export interface TestNetworkCapability {
  readonly kind: "searvia-test-network-capability";
}

function endpointKey(url: URL): string {
  const port = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
}

export function issueTestNetworkCapability(
  exactEndpoints: readonly string[],
): TestNetworkCapability {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The crawler test network capability is available only when NODE_ENV=test.");
  }
  if (exactEndpoints.length === 0) {
    throw new TypeError("At least one exact fixture endpoint is required.");
  }

  const keys = new Set<string>();
  for (const endpoint of exactEndpoints) {
    const parsed = new URL(endpoint);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new TypeError("Test endpoints must be exact HTTP(S) origins without credentials.");
    }
    keys.add(endpointKey(parsed));
  }

  const capability = Object.freeze({
    kind: "searvia-test-network-capability" as const,
  });
  issuedCapabilities.set(capability, Object.freeze(keys));
  return capability;
}

export function permitsTestEndpoint(
  capability: TestNetworkCapability | undefined,
  url: URL,
): boolean {
  if (capability === undefined || process.env.NODE_ENV !== "test") return false;
  return issuedCapabilities.get(capability)?.has(endpointKey(url)) === true;
}
