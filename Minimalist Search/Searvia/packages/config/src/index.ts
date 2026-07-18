export {
  EnvironmentValidationError,
  type EnvironmentIssue,
  type EnvironmentSource,
} from "./environment.js";

export const configFoundation = Object.freeze({
  milestone: "M0",
  entryPoints: ["client", "server", "worker"] as const,
});
