import { describe, expect, it } from "vitest";
import { buildVevoManifest } from "../src/vevo-feed.js";

describe("official VEVOXML field mapping", () => {
  it("preserves metadata in the public video profile, not a custom envelope", () => {
    const result = buildVevoManifest({
      purpose: "INSERT", isrc: "USABC2600001", title: "Video & music",
      label: "Fixture Label", genres: ["Pop", "Rock"], mainArtists: ["One", "Two"],
      youtubeChannelName: "FixtureVEVO", startDateTime: "2027-01-01T00:00:00Z",
      territories: ["US", "VN"], videoAssetId: "55555555-5555-4555-8555-555555555555",
      captionAssetId: "66666666-6666-4666-8666-666666666666", captionLanguage: "en",
      madeForKids: false, youtubeUnlisted: true,
    }, { VIDEO: "resources/video.mp4", CAPTION: "resources/captions.srt" });
    for (const field of [
      '<video version="1.0">', '<Action>Insert</Action>', '<VideoISRC>USABC2600001</VideoISRC>',
      '<VideoTitle>Video &amp; music</VideoTitle>', '<Username>FixtureVEVO</Username>',
      '<Url>file://resources/video.mp4</Url>', '<Artists><Artist>One</Artist><Artist>Two</Artist></Artists>',
      '<Genre>Pop</Genre><Genre>Rock</Genre>', '<StartTime>2027-01-01T00:00:00Z</StartTime>',
      '<policy Rule="Share" Include="Include">US VN</policy>',
      '<policy Rule="Block" Include="Exclude">US VN</policy>',
      '<ClosedCaptionUrl>file://resources/captions.srt</ClosedCaptionUrl>',
      '<ClosedCaptionLanguage>en</ClosedCaptionLanguage>', '<MadeForKids>False</MadeForKids>',
      '<YouTubeUnlisted>True</YouTubeUnlisted>',
    ]) expect(result).toContain(field);
    expect(result).not.toContain("VevoFeed");
  });
});
