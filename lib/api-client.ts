import type { UserSession } from "@/lib/types";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

interface ApiEnvelope<T> {
  data: T | null;
  error: ApiErrorBody | null;
  requestId: string;
}

interface AuthSessionResponse {
  accessToken: string;
  expiresIn: number;
  user: IdentityUser;
}

interface IdentityUser {
  id: string;
  email: string;
  name: string | null;
  stageName: string | null;
  entityId: string;
  entityType: string;
  entityRole: string;
  entityName: string;
  entityPath: string;
  tenantId: string | null;
  staffRoles: string[];
}

export interface IdentityProfile {
  id: string;
  email: string;
  name: string | null;
  stageName: string | null;
  phone: string | null;
  avatar: string | null;
  twoFactorEnabled: boolean;
  language: string;
  timezone: string;
  currency: string;
  theme: string;
  notifyReleases: boolean;
  notifyRoyalties: boolean;
  notifyNews: boolean;
  notifyMarketing: boolean;
  staffRoles: string[];
  createdAt: string;
  updatedAt: string;
  membership: {
    entityId: string;
    entityType: string;
    entityRole: string;
    entityName: string;
    entityPath: string;
    tenantId: string | null;
  } | null;
}

export interface IdentitySession {
  id: string;
  deviceName: string | null;
  deviceType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
let accessToken: string | null = null;
let authGeneration = 0;
let authLifetime = new AbortController();
let sessionPromise: Promise<AuthSessionResponse> | null = null;
let sessionController: AbortController | null = null;

function requireCurrentSession(generation: number): void {
  if (generation !== authGeneration) {
    throw new ApiClientError(401, "AUTH_SESSION_CHANGED", "Authentication session changed");
  }
}

export function captureAuthSession() {
  const generation = authGeneration;
  return { signal: authLifetime.signal, requireCurrent: () => requireCurrentSession(generation) };
}

function endpoint(path: string): string {
  if (!path.startsWith("/api/v1/")) {
    throw new Error("API path must start with /api/v1/");
  }
  return `${API_BASE_URL}${path}`;
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError(response.status, "INVALID_RESPONSE", "Invalid API response");
  }
}

async function send<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(endpoint(path), {
    ...init,
    headers,
    credentials: "include",
  });
  const envelope = await readEnvelope<T>(response);
  if (!response.ok || envelope.error || envelope.data === null) {
    const error = envelope.error ?? {
      code: "REQUEST_FAILED",
      message: `Request failed with status ${response.status}`,
    };
    throw new ApiClientError(
      response.status,
      error.code,
      error.message,
      error.details,
      envelope.requestId,
    );
  }
  return envelope.data;
}

function requestAuthSession(
  path: "/api/v1/auth/login" | "/api/v1/auth/2fa/verify" | "/api/v1/auth/refresh",
  body: unknown,
): Promise<AuthSessionResponse> {
  const generation = authGeneration;
  const controller = new AbortController();
  sessionController = controller;
  const pending: Promise<AuthSessionResponse> = send<AuthSessionResponse>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((session) => {
      requireCurrentSession(generation);
      accessToken = session.accessToken;
      return session;
    })
    .catch((error) => {
      requireCurrentSession(generation);
      accessToken = null;
      throw error;
    })
    .finally(() => {
      if (sessionPromise === pending) {
        sessionPromise = null;
        sessionController = null;
      }
    });
  sessionPromise = pending;
  return pending;
}

export async function refreshAccessToken(): Promise<AuthSessionResponse> {
  return sessionPromise ?? requestAuthSession("/api/v1/auth/refresh", {});
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const generation = authGeneration;
  if (!accessToken) await refreshAccessToken();
  requireCurrentSession(generation);
  try {
    const data = await send<T>(path, init, accessToken);
    requireCurrentSession(generation);
    return data;
  } catch (error) {
    requireCurrentSession(generation);
    if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
    await refreshAccessToken();
    requireCurrentSession(generation);
    const data = await send<T>(path, init, accessToken);
    requireCurrentSession(generation);
    return data;
  }
}

export async function publicApiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return send<T>(path, init);
}

export async function startAuthSession(
  path: "/api/v1/auth/login" | "/api/v1/auth/2fa/verify",
  body: unknown,
): Promise<AuthSessionResponse> {
  clearAccessToken();
  return requestAuthSession(path, body);
}

export function clearAccessToken(): void {
  authGeneration += 1;
  accessToken = null;
  sessionPromise = null;
  const previousController = sessionController;
  sessionController = null;
  const previousLifetime = authLifetime;
  authLifetime = new AbortController();
  previousController?.abort();
  previousLifetime.abort();
}

const ALL_PERMISSIONS = [
  "release.create", "release.read", "release.update", "release.delete",
  "release.approve", "release.deny", "release.submit",
  "artist.create", "artist.read", "artist.update", "artist.delete",
  "label.create", "label.read", "label.update", "label.delete",
  "entity.create", "entity.read", "entity.update", "entity.delete", "entity.invite",
  "user.create", "user.read", "user.update", "user.delete", "user.ban",
  "finance.view", "finance.export", "finance.payout",
  "ticket.view", "ticket.respond", "ticket.close",
  "analytics.view", "analytics.export", "system.settings", "system.logs",
] as const;

const ENTITY_PERMISSIONS: Record<string, readonly string[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  SYSTEM_ADMIN: ALL_PERMISSIONS,
  ORGANIZATION: ALL_PERMISSIONS.filter((permission) =>
    !["entity.delete", "user.delete", "user.ban", "finance.payout", "ticket.respond", "ticket.close", "system.settings", "system.logs"].includes(permission),
  ),
  SUB_ACCOUNT: [
    "entity.read", "entity.invite", "user.read", "user.update",
    "release.create", "release.read", "release.update", "release.delete", "release.submit",
    "artist.read", "label.read", "analytics.view", "finance.view", "ticket.view",
  ],
};

const MEMBER_DENIED = new Set([
  "entity.create", "entity.update", "entity.delete", "entity.invite",
  "label.create", "label.update", "label.delete",
  "user.create", "user.update", "user.delete", "user.ban",
  "release.delete", "release.approve", "release.deny",
  "finance.export", "finance.payout", "system.settings", "system.logs",
]);

const ACCOUNTANT_ALLOWED = new Set([
  "release.read",
  "artist.read",
  "label.read",
  "finance.view",
  "finance.export",
  "analytics.view",
  "analytics.export",
]);

const REVIEWER_ALLOWED = new Set([
  "release.read",
  "release.approve",
  "release.deny",
  "artist.read",
  "label.read",
]);

const STAFF_PERMISSIONS: Record<string, readonly string[]> = {
  admin: ALL_PERMISSIONS,
  moderator: ["release.read", "release.approve", "release.deny", "artist.read", "label.read"],
  supporter: ["ticket.view", "ticket.respond", "ticket.close", "user.read", "artist.read", "label.read", "release.read"],
  finance: ["finance.view", "finance.export", "analytics.view", "analytics.export", "label.read", "artist.read", "release.read"],
};

export function permissionsForIdentity(
  entityType: string,
  entityRole: string,
  staffRoles: readonly string[],
): string[] {
  const base = ENTITY_PERMISSIONS[entityType] ?? [];
  const scopedBase = entityRole === "REVIEWER"
    ? base.filter((item) => REVIEWER_ALLOWED.has(item))
    : entityRole === "ACCOUNTANT"
    ? base.filter((item) => ACCOUNTANT_ALLOWED.has(item))
    : entityRole === "MEMBER"
      ? base.filter((item) => !MEMBER_DENIED.has(item))
      : base;
  const permissions = new Set(scopedBase);
  for (const role of staffRoles) {
    for (const permission of STAFF_PERMISSIONS[role] ?? []) permissions.add(permission);
  }
  return [...permissions];
}

export async function getCurrentUser(): Promise<UserSession> {
  const profile = await getIdentityProfile();
  if (!profile.membership) {
    throw new ApiClientError(403, "NO_ENTITY_ASSIGNED", "No entity membership assigned");
  }
  const membership = profile.membership;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name ?? undefined,
    stageName: profile.stageName ?? undefined,
    phone: profile.phone ?? undefined,
    avatar: profile.avatar ?? undefined,
    roles: profile.staffRoles,
    permissions: permissionsForIdentity(
      membership.entityType,
      membership.entityRole,
      profile.staffRoles,
    ),
    entityId: membership.entityId,
    entityType: membership.entityType,
    entityRole: membership.entityRole,
    entityName: membership.entityName,
    entityPath: membership.entityPath,
    tenantId: membership.tenantId,
    language: profile.language,
    timezone: profile.timezone,
    currency: profile.currency,
    theme: profile.theme,
  };
}

export function getIdentityProfile(): Promise<IdentityProfile> {
  return apiRequest<IdentityProfile>("/api/v1/auth/profile");
}
