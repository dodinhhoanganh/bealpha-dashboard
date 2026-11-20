import { buildEarningsQueries } from "@/components/analytics/EarningsPanel";

describe("EarningsPanel finance queries", () => {
  it("keeps pagination parameters off the strict summary endpoint", () => {
    const queries = buildEarningsQueries("spotify", "processed");

    expect(queries.reports).toBe("platform=spotify&status=processed&limit=100");
    expect(queries.summary).toBe("platform=spotify&status=processed");
    expect(queries.summary).not.toContain("limit=");
    expect(queries.summary).not.toContain("cursor=");
  });

  it("omits the summary query when no filters are selected", () => {
    expect(buildEarningsQueries("all", "all")).toEqual({
      reports: "limit=100",
      summary: "",
    });
  });
});
