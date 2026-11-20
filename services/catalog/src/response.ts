import type { FastifyReply } from "fastify";

export function successEnvelope<T>(requestId: string, data: T) { return { data, error: null, requestId }; }
export function sendFailure(reply: FastifyReply, status: number, requestId: string, code: string, message: string, details?: unknown) {
  return reply.code(status).send({ data: null, error: { code, message, ...(details === undefined ? {} : { details }) }, requestId });
}
