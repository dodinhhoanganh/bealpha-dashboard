import type { ApiErrorCode } from "@bealpha/contracts";

export class IdentityError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "IdentityError";
  }
}
