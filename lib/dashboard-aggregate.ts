import { apiRequest } from "@/lib/api-client";
import type { UserSession } from "@/lib/types";
import { canAccessPanel } from "@/lib/ui-capabilities";

export interface DashboardRelease {
  id: string;
  title: string;
  status: string;
  artist?: { name?: string | null } | null;
  label?: { name?: string | null } | null;
}

export async function loadDashboardAggregate(user: UserSession): Promise<{ releases: DashboardRelease[]; available: boolean }> {
  if (!canAccessPanel(user, "releases")) return { releases: [], available: true };
  try {
    const releases = await apiRequest<DashboardRelease[]>("/api/v1/catalog/releases?workQueue=true&limit=50");
    return { releases, available: true };
  } catch {
    return { releases: [], available: false };
  }
}
