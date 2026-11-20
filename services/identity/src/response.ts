import type { ApiErrorCode, ApiFailure, ApiSuccess } from "@bealpha/contracts";
import type { FastifyReply } from "fastify";

export function successEnvelope<T>(requestId: string, data: T): ApiSuccess<T> {
  return { data, error: null, requestId };
}

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
