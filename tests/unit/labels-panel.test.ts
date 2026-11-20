import { totalLabelReleaseCount, type LabelSummary } from "@/components/entities/LabelsPanel";

describe("LabelsPanel catalog totals", () => {
  it("counts releases across the complete filtered collection, including zero counts", () => {
    const labels: LabelSummary[] = [
      { id: "a", name: "A", releaseCount: 12 },
      { id: "b", name: "B", releaseCount: 0 },
      { id: "c", name: "C", releaseCount: 8 },
    ];

    expect(totalLabelReleaseCount(labels)).toBe(20);
  });
});
