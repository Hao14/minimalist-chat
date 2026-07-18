import {
  parseWorkerEnvironment,
  type EnvironmentSource,
  type WorkerEnvironment,
} from "@searvia/config/worker";

export const WORKER_SERVICE_NAME = "report-worker" as const;

export function createWorkerStartupConfiguration(source?: EnvironmentSource): WorkerEnvironment {
  return parseWorkerEnvironment(WORKER_SERVICE_NAME, source);
}
