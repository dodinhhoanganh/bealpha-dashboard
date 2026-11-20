import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptGrantToken(token: string, key: Buffer): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptGrantToken(value: string, key: Buffer): string {
  const payload = Buffer.from(value, "base64url");
  if (payload.length < 29) throw new Error("DELIVERY_GRANT_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}
