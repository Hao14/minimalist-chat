import { createSafeHttpClientInternal, type SafeHttpClientOptions } from "./safe-http.js";
import { issueTestNetworkCapability } from "./test-access.js";
import type { SafeHttpClient } from "./types.js";

export interface TestSafeHttpClientOptions extends SafeHttpClientOptions {
  readonly exactEndpoints: readonly string[];
}

/**
 * Test-only loopback access. The production entry point cannot receive this
 * capability, and the opaque capability is accepted only if this module issued it.
 */
export function createTestSafeHttpClient(options: TestSafeHttpClientOptions): SafeHttpClient {
  const { exactEndpoints, ...clientOptions } = options;
  const capability = issueTestNetworkCapability(exactEndpoints);
  return createSafeHttpClientInternal(clientOptions, capability);
}
