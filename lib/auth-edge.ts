import { SignJWT, jwtVerify } from "jose";

const jwtSecretValue = process.env.JWT_SECRET;
if (!jwtSecretValue && process.env.NODE_ENV === "production") {
  throw new Error(
    "[FATAL] JWT_SECRET environment variable is required in production!",
  );
}
if (!jwtSecretValue && process.env.NODE_ENV !== "development") {
  throw new Error(
    "[FATAL] JWT_SECRET is not set! Set JWT_SECRET in your .env file. Only development mode allows fallback.",
  );
}
if (!jwtSecretValue) {
  console.error(
    "\x1b[31m[CRITICAL] JWT_SECRET is not set! Using insecure default. Set JWT_SECRET in your .env file!\x1b[0m",
  );
}
const JWT_SECRET = new TextEncoder().encode(
  jwtSecretValue || "bealpha-dev-only-secret-key",
);

export interface UserPayload {
  id: string;
  email: string;
  roles: string[];          // Legacy staff roles from Role table
  entityId: string;         // Primary entity ID
  entityType: string;       // SUPER_ADMIN | SYSTEM_ADMIN | ORGANIZATION | SUB_ACCOUNT
  entityRole: string;       // OWNER | ADMIN | MEMBER
  entityName: string;
  tenantId: string | null;  // Organization ID (null for sys admins)
  entityPath: string;       // Hierarchy path for scoping
  isBanned?: boolean;
}

export async function createTokenEdge(payload: UserPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifyTokenEdge(
  token: string,
): Promise<UserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as UserPayload;
  } catch {
    return null;
  }
}
