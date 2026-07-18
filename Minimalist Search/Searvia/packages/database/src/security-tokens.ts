import { createHash, randomBytes } from "node:crypto";

const INVITATION_TOKEN_BYTES = 32;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z\d_-]{43}$/u;

export interface InvitationTokenPair {
  readonly rawToken: string;
  readonly tokenHash: string;
}

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateInvitationToken(): InvitationTokenPair {
  const rawToken = randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");

  return Object.freeze({ rawToken, tokenHash: hashInvitationToken(rawToken) });
}

export function isInvitationTokenSyntaxValid(rawToken: string): boolean {
  return INVITATION_TOKEN_PATTERN.test(rawToken);
}

export function createOpaqueRateLimitKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex");
}
