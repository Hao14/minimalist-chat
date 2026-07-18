import {
  logLevelSchema,
  runtimeEnvironmentSchema,
  serviceNameSchema,
  type LogLevel,
  type RuntimeEnvironment,
  type SafeLogMetadata,
} from "@searvia/shared-types";
import pino, { type DestinationStream, type Logger } from "pino";

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|secret|session|token|api[-_]?key)/i;
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/giu;
const BEARER_VALUE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu;
const LABELED_SECRET =
  /\b(password|secret|token|api[-_]?key|authorization)\s*([=:])\s*([^\s,;]+)/giu;

export interface ServiceLoggerOptions {
  readonly service: string;
  readonly environment: RuntimeEnvironment;
  readonly level?: LogLevel;
}

function sanitizeText(value: string): string {
  return value
    .replace(CREDENTIAL_URL, `$1${REDACTED}@`)
    .replace(BEARER_VALUE, `$1${REDACTED}`)
    .replace(LABELED_SECRET, `$1$2${REDACTED}`);
}

function sanitizeValue(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const safeError: Record<string, unknown> = {
      type: value.name,
      message: sanitizeText(value.message),
    };

    if (value.stack !== undefined) {
      safeError.stack = sanitizeText(value.stack);
    }

    if ("code" in value && value.code !== undefined) {
      safeError.code = sanitizeValue(value.code, seen);
    }

    return safeError;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }

    seen.add(value);
    return value.map((entry) => sanitizeValue(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return CIRCULAR;
    }

    seen.add(value);
    const safeObject: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      safeObject[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(nestedValue, seen);
    }

    return safeObject;
  }

  return String(value);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const safeRecord: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    safeRecord[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeValue(nestedValue, new WeakSet<object>([value]));
  }

  return safeRecord;
}

function sanitizeSerializedLog(serialized: string): string {
  try {
    const parsed: unknown = JSON.parse(serialized);
    const sanitized = sanitizeValue(parsed);
    return `${JSON.stringify(sanitized)}\n`;
  } catch {
    return `${JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      msg: "A log record could not be serialized safely.",
    })}\n`;
  }
}

export function toSafeErrorMetadata(error: unknown): SafeLogMetadata {
  return Object.freeze({ error: sanitizeValue(error) });
}

export function createServiceLogger(
  options: ServiceLoggerOptions,
  destination?: DestinationStream,
): Logger {
  const service = serviceNameSchema.parse(options.service);
  const environment = runtimeEnvironmentSchema.parse(options.environment);
  const level = logLevelSchema.parse(options.level ?? "info");

  return pino(
    {
      base: { service, environment },
      level,
      formatters: {
        level: (label) => ({ level: label }),
        log: sanitizeRecord,
      },
      hooks: {
        streamWrite: sanitizeSerializedLog,
      },
      redact: {
        paths: ["authorization", "cookie", "credentials", "password", "secret", "session", "token"],
        censor: REDACTED,
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    destination,
  );
}
