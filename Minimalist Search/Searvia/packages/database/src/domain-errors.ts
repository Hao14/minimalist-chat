export const DATABASE_DOMAIN_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVITATION_INVALID",
  "RATE_LIMITED",
] as const;

export type DatabaseDomainErrorCode = (typeof DATABASE_DOMAIN_ERROR_CODES)[number];

export class DatabaseDomainError extends Error {
  readonly code: DatabaseDomainErrorCode;

  constructor(code: DatabaseDomainErrorCode, message: string) {
    super(message);
    this.name = "DatabaseDomainError";
    this.code = code;
  }
}

export function isDatabaseDomainError(error: unknown): error is DatabaseDomainError {
  return error instanceof DatabaseDomainError;
}
