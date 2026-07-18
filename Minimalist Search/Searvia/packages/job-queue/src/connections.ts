import { Redis, type RedisOptions } from "ioredis";

export interface RedisConnectionConfiguration {
  readonly url: string;
  readonly connectTimeoutMs: number;
}

function validateRedisConnectionConfiguration(
  configuration: RedisConnectionConfiguration,
): RedisConnectionConfiguration {
  const parsed = new URL(configuration.url);
  if ((parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") || !parsed.hostname) {
    throw new TypeError("Redis must use a redis:// or rediss:// URL with a hostname.");
  }

  if (
    !Number.isInteger(configuration.connectTimeoutMs) ||
    configuration.connectTimeoutMs < 100 ||
    configuration.connectTimeoutMs > 60_000
  ) {
    throw new RangeError("Redis connect timeout must be between 100 and 60000 milliseconds.");
  }

  return Object.freeze({ ...configuration });
}

export function producerRedisOptions(connectTimeoutMs: number): RedisOptions {
  return {
    connectTimeout: connectTimeoutMs,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => (attempt <= 3 ? Math.min(attempt * 250, 1_000) : null),
  };
}

export function workerRedisOptions(connectTimeoutMs: number): RedisOptions {
  return {
    connectTimeout: connectTimeoutMs,
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(Math.max(1, attempt) * 1_000, 20_000),
  };
}

export function createProducerRedisConnection(configuration: RedisConnectionConfiguration): Redis {
  const validated = validateRedisConnectionConfiguration(configuration);
  return new Redis(validated.url, producerRedisOptions(validated.connectTimeoutMs));
}

export function createWorkerRedisConnection(configuration: RedisConnectionConfiguration): Redis {
  const validated = validateRedisConnectionConfiguration(configuration);
  return new Redis(validated.url, workerRedisOptions(validated.connectTimeoutMs));
}

export async function closeOwnedRedisConnection(redis: Redis): Promise<void> {
  if (redis.status === "ready") {
    await redis.quit();
    return;
  }

  redis.disconnect(false);
}
