import { describe, expect, it } from "vitest";
import { inspectVevoVideoProbe, validateVevoVideoProbe, VevoVideoQcError } from "../src/vevo-video-profile.js";

describe("public VEVO video master profile", () => {
  it("accepts a compliant 1080p H.264 MP4 master", () => {
    expect(() => validateVevoVideoProbe({
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      formatBitRate: 20_000_000,
      video: { codecName: "h264", bitRate: 20_000_000, width: 1920, height: 1080, frameRate: "30000/1001", fieldOrder: "progressive" },
      audio: { codecName: "aac", channels: 2, sampleRate: 44_100, bitRate: 320_000 },
    })).not.toThrow();
  });

  it("accepts a compliant 4K ProRes MOV master at 59.94 fps", () => {
    expect(() => validateVevoVideoProbe({
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      formatBitRate: 60_000_000,
      video: { codecName: "prores", pixelFormat: "yuv422p10le", bitRate: 60_000_000, width: 3840, height: 2160, frameRate: "60000/1001", fieldOrder: "progressive" },
      audio: { codecName: "pcm_s24le", channels: 2, sampleRate: 48_000, bitRate: 2_304_000 },
    })).not.toThrow();
  });

  it("accepts the official 1080x1920 vertical profile", () => {
    expect(() => validateVevoVideoProbe({
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      formatBitRate: 20_000_000,
      video: { codecName: "h264", bitRate: 20_000_000, width: 1080, height: 1920, frameRate: "24/1", fieldOrder: "progressive" },
      audio: { codecName: "aac", channels: 2, sampleRate: 44_100, bitRate: 320_000 },
    })).not.toThrow();
  });

  it("fails closed when the video bitrate or field order cannot be verified", () => {
    const result = inspectVevoVideoProbe({
      formatName: "mp4",
      video: { codecName: "h264", width: 1920, height: 1080, frameRate: "24/1", fieldOrder: "unknown" },
      audio: { codecName: "aac", channels: 2, sampleRate: 44_100, bitRate: 320_000 },
    });
    expect(result.compliant).toBe(false);
    expect(result.violations.map(item => item.code)).toEqual(expect.arrayContaining([
      "FIELD_ORDER_UNVERIFIED",
      "VIDEO_BIT_RATE_MISSING",
    ]));
  });

  it("validates the video stream bitrate instead of aggregate container bitrate", () => {
    const result = inspectVevoVideoProbe({
      formatName: "mp4",
      formatBitRate: 8_000_000,
      video: {
        codecName: "h264",
        bitRate: 7_400_000,
        width: 1920,
        height: 1080,
        frameRate: "24/1",
        fieldOrder: "progressive",
      },
      audio: { codecName: "aac", channels: 2, sampleRate: 44_100, bitRate: 320_000 },
    });
    expect(result.compliant).toBe(false);
    expect(result.violations).toContainEqual({ code: "VIDEO_BIT_RATE_TOO_LOW", field: "video.bitRate" });
  });

  it("rejects interlaced or frame-reordered masters with stable error codes", () => {
    expect(() => validateVevoVideoProbe({
      formatName: "mp4",
      formatBitRate: 20_000_000,
      video: { codecName: "h264", bitRate: 20_000_000, width: 1920, height: 1080, frameRate: "24/1", fieldOrder: "tt", hasBFrames: 2 },
      audio: { codecName: "aac", channels: 2, sampleRate: 44_100, bitRate: 320_000 },
    })).toThrowError(VevoVideoQcError);
    const result = inspectVevoVideoProbe({
      formatName: "mp4",
      formatBitRate: 20_000_000,
      video: { codecName: "h264", bitRate: 20_000_000, width: 1920, height: 1080, frameRate: "24/1", fieldOrder: "tt", hasBFrames: 2 },
      audio: { codecName: "aac", channels: 2, sampleRate: 44_100, bitRate: 320_000 },
    });
    expect(result.violations.map(item => item.code)).toEqual(expect.arrayContaining([
      "VIDEO_INTERLACED",
      "FRAME_REORDERING_ENABLED",
    ]));
  });

  it("rejects arbitrary UHD aspect ratios", () => {
    const result = inspectVevoVideoProbe({
      formatName: "mov",
      formatBitRate: 60_000_000,
      video: { codecName: "prores", pixelFormat: "yuv422p10le", bitRate: 60_000_000, width: 3840, height: 2400, frameRate: "24/1", fieldOrder: "progressive" },
      audio: { codecName: "pcm_s24le", channels: 2, sampleRate: 48_000 },
    });
    expect(result.compliant).toBe(false);
    expect(result.violations).toContainEqual({ code: "ASPECT_RATIO_UNSUPPORTED", field: "video.dimensions" });
  });
});
