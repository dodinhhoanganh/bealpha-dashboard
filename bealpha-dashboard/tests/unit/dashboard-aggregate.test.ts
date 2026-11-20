jest.mock("@/lib/api-client", () => ({ apiRequest: jest.fn() }));

import { apiRequest } from "@/lib/api-client";
import { loadDashboardAggregate } from "@/lib/dashboard-aggregate";
import type { UserSession } from "@/lib/types";

function session(overrides: Partial<UserSession> = {}): UserSession {
  return { id: "user-1", email: "user@example.com", roles: [], permissions: ["release.read"], entityId: "entity-1", entityType: "ORGANIZATION", entityRole: "OWNER", entityName: "Label", entityPath: "root.system.org", tenantId: "entity-1", ...overrides };
}

describe("loadDashboardAggregate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("loads only the scoped release work queue", async () => {
    (apiRequest as jest.Mock).mockResolvedValue([{ id: "r1", status: "PENDING_ORG_APPROVAL" }]);
    await expect(loadDashboardAggregate(session())).resolves.toEqual({ releases: [{ id: "r1", status: "PENDING_ORG_APPROVAL" }], available: true });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/catalog/releases?workQueue=true&limit=50");
  });

  it("reports the work queue unavailable without inventing zero tasks", async () => {
    (apiRequest as jest.Mock).mockRejectedValue(new Error("catalog down"));
    await expect(loadDashboardAggregate(session())).resolves.toEqual({ releases: [], available: false });
  });

  it("makes no domain request when releases are outside the current capability", async () => {
    await expect(loadDashboardAggregate(session({ permissions: [] }))).resolves.toEqual({ releases: [], available: true });
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
