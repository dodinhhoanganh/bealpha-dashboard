import type { FastifyReply } from "fastify";
export function successEnvelope<T>(requestId: string, data: T) { return { data, error: null, requestId }; }
export function sendFailure(reply: FastifyReply, status: number, requestId: string, code: string, message: string) { return reply.code(status).send({ data: null, error: { code, message }, requestId }); }
