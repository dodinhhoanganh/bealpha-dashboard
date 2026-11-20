import { createHmac, timingSafeEqual } from "node:crypto";

function signature(jobId: string, expires: number, key: Buffer) {
  return createHmac("sha256", key).update(`${jobId}.${expires}`).digest("base64url");
}

export function createExportToken(jobId: string, ttlSeconds: number, key: Buffer) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${expires}.${signature(jobId, expires, key)}`;
}

export function verifyExportToken(jobId: string, token: string, key: Buffer) {
  const [expiresValue, supplied] = token.split(".", 2);
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !supplied) return false;
  const expected = signature(jobId, expires, key);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
