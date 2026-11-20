import { parseSearchParam, parseSortOrder } from "@/lib/request-params";

describe("parseSortOrder", () => {
  it("accepts only asc or desc and falls back otherwise", () => {
    expect(parseSortOrder("asc", "desc")).toBe("asc");
    expect(parseSortOrder("DESC", "asc")).toBe("desc");
    expect(parseSortOrder("drop", "desc")).toBe("desc");
    expect(parseSortOrder(null, "asc")).toBe("asc");
  });
});

describe("parseSearchParam", () => {
  it("trims search and rejects empty or oversized queries", () => {
    expect(parseSearchParam("  label  ")).toBe("label");
    expect(parseSearchParam("   ")).toBeNull();
    expect(parseSearchParam("x".repeat(101))).toBeNull();
  });
});
