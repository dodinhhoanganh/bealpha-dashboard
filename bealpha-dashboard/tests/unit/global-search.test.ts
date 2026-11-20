jest.mock("@/lib/api-client", () => ({ apiRequest: jest.fn() }));

import { apiRequest } from "@/lib/api-client";
import { searchAcrossServices } from "@/lib/global-search";

describe("searchAcrossServices", () => {
  it("combines scoped microservice results without legacy search API", async () => {
    (apiRequest as jest.Mock).mockImplementation((path: string) => Promise.resolve(
      path.includes("artists") ? [{ id: "a1", name: "Alpha Artist" }] :
      path.includes("releases") ? [{ id: "r1", title: "Alpha Album", ean: "123" }] :
      path.includes("assets") ? [{ id: "m1", fileName: "alpha.wav", type: "AUDIO" }] :
      [{ id: "l1", name: "Alpha Label" }],
    ));

    const results = await searchAcrossServices("alpha", "ALL", new AbortController().signal);

    expect(results.map((item) => item.type)).toEqual(["ARTIST", "RELEASE", "ASSET", "LABEL"]);
    expect(apiRequest).toHaveBeenCalledTimes(4);
  });
});
