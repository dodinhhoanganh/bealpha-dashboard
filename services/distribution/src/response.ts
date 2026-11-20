import type { FastifyReply } from "fastify";
export const successEnvelope = <T>(requestId: string, data: T) => ({ data, error: null, requestId });
export function sendFailure(reply: FastifyReply, status: number, requestId: string, code: string, message: string) { return reply.code(status).send({ data: null, error: { code, message }, requestId }); }
