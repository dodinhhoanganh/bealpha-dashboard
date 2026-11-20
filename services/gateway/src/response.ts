import type { ApiErrorCode, ApiFailure } from "@bealpha/contracts";
import type { FastifyReply } from "fastify";

export function failureEnvelope(
  requestId: string,
  code: ApiErrorCode,
  message: string,
  details?: unknown
): ApiFailure {
  return {
    data: null,
    error: details === undefined ? { code, message } : { code, message, details },
    requestId
  };
}

export function sendFailure(
  reply: FastifyReply,
  statusCode: number,
  requestId: string,
  code: ApiErrorCode,
  message: string,
  details?: unknown
) {
  return reply
    .code(statusCode)
    .send(failureEnvelope(requestId, code, message, details));
}
