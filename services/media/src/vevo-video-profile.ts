import { VEVO_VIDEO_PROFILE_VERSION } from "@bealpha/contracts";

export { VEVO_VIDEO_PROFILE_VERSION };

export type VevoVideoProfile = "HD_LANDSCAPE" | "HD_VERTICAL" | "UHD_2K" | "UHD_4K";

export type VevoVideoQcViolationCode =
  | "VIDEO_STREAM_MISSING"
  | "AUDIO_STREAM_MISSING"
  | "CONTAINER_UNSUPPORTED"
  | "DIMENSIONS_UNSUPPORTED"
  | "ASPECT_RATIO_UNSUPPORTED"
  | "VIDEO_CODEC_UNSUPPORTED"
  | "PRORES_CHROMA_UNSUPPORTED"
  | "FRAME_RATE_UNSUPPORTED"
  | "FIELD_ORDER_UNVERIFIED"
  | "VIDEO_INTERLACED"
  | "FRAME_REORDERING_ENABLED"
  | "VIDEO_BIT_RATE_MISSING"
  | "VIDEO_BIT_RATE_TOO_LOW"
  | "AUDIO_CODEC_UNSUPPORTED"
  | "AUDIO_CHANNELS_UNSUPPORTED"
  | "AUDIO_SAMPLE_RATE_UNSUPPORTED"
  | "AUDIO_BIT_RATE_MISSING"
  | "AUDIO_BIT_RATE_TOO_LOW";

export interface VevoVideoProbe {
  formatName?: string;
  formatBitRate?: number;
  video?: {
    codecName?: string;
    pixelFormat?: string;
    bitRate?: number;
    width?: number;
    height?: number;
    frameRate?: string;
    fieldOrder?: string;
    hasBFrames?: number;
  };
  audio?: {
    codecName?: string;
    channels?: number;
    sampleRate?: number;
    bitRate?: number;
  };
}

export interface VevoVideoQcViolation {
  code: VevoVideoQcViolationCode;
  field: string;
}

export interface VevoVideoQcResult {
  compliant: boolean;
  profile: VevoVideoProfile | null;
  profileVersion: typeof VEVO_VIDEO_PROFILE_VERSION;
  violations: VevoVideoQcViolation[];
}

export class VevoVideoQcError extends Error {
  readonly code = "VIDEO_MASTER_SPEC_INVALID";

  constructor(readonly result: VevoVideoQcResult) {
    super("VIDEO_MASTER_SPEC_INVALID");
    this.name = "VevoVideoQcError";
  }
}

export function parseFrameRate(value?: string): number | null {
  if (!value) return null;
  const [numerator, denominator = "1"] = value.split("/");
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function approximate(value: number, expected: number, tolerance = 0.02): boolean {
  return Math.abs(value - expected) <= tolerance;
}

function classifyProfile(width?: number, height?: number): VevoVideoProfile | null {
  if (width === 1920 && height === 1080) return "HD_LANDSCAPE";
  if (width === 1080 && height === 1920) return "HD_VERTICAL";
  if (!width || !height || width <= height) return null;
  if (width >= 3840) return "UHD_4K";
  if (width >= 2560) return "UHD_2K";
  return null;
}

function violation(code: VevoVideoQcViolationCode, field: string): VevoVideoQcViolation {
  return { code, field };
}

/**
 * Validates the machine-verifiable requirements in VEVO's public Music Video Specs.
 * Editorial checks such as slates/title cards still require human review and are not
 * represented as a successful technical QC result.
 */
export function inspectVevoVideoProbe(probe: VevoVideoProbe): VevoVideoQcResult {
  const violations: VevoVideoQcViolation[] = [];
  const video = probe.video;
  const audio = probe.audio;
  const profile = classifyProfile(video?.width, video?.height);
  const formatNames = new Set(probe.formatName?.split(",").map(value => value.trim().toLowerCase()));

  if (!video) violations.push(violation("VIDEO_STREAM_MISSING", "video"));
  if (!audio) violations.push(violation("AUDIO_STREAM_MISSING", "audio"));
  if (!formatNames.has("mov") && !formatNames.has("mp4")) {
    violations.push(violation("CONTAINER_UNSUPPORTED", "formatName"));
  }
  if (!profile) violations.push(violation("DIMENSIONS_UNSUPPORTED", "video.dimensions"));

  if (video && profile) {
    const isUhd = profile === "UHD_2K" || profile === "UHD_4K";
    const isProRes = video.codecName?.toLowerCase() === "prores";
    const isH264 = video.codecName?.toLowerCase() === "h264";
    const fps = parseFrameRate(video.frameRate);

    if (isUhd) {
      const aspectRatio = (video.width ?? 0) / (video.height ?? 1);
      const supportedAspectRatios = [16 / 9, 1.85, 2, 2.35, 2.39, 2.4];
      if (!supportedAspectRatios.some(value => approximate(aspectRatio, value, 0.03))) {
        violations.push(violation("ASPECT_RATIO_UNSUPPORTED", "video.dimensions"));
      }
      if (!isProRes) violations.push(violation("VIDEO_CODEC_UNSUPPORTED", "video.codecName"));
      const supportedFps = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
      if (fps === null || !supportedFps.some(value => approximate(fps, value))) {
        violations.push(violation("FRAME_RATE_UNSUPPORTED", "video.frameRate"));
      }
    } else {
      if (!isProRes && !isH264) violations.push(violation("VIDEO_CODEC_UNSUPPORTED", "video.codecName"));
      if (fps === null || fps < 23.98) violations.push(violation("FRAME_RATE_UNSUPPORTED", "video.frameRate"));
    }

    if (isProRes && !video.pixelFormat?.toLowerCase().includes("422")) {
      violations.push(violation("PRORES_CHROMA_UNSUPPORTED", "video.pixelFormat"));
    }
    if (!video.fieldOrder || video.fieldOrder === "unknown") {
      violations.push(violation("FIELD_ORDER_UNVERIFIED", "video.fieldOrder"));
    } else if (video.fieldOrder !== "progressive") {
      violations.push(violation("VIDEO_INTERLACED", "video.fieldOrder"));
    }
    if ((video.hasBFrames ?? 0) > 0) {
      violations.push(violation("FRAME_REORDERING_ENABLED", "video.hasBFrames"));
    }

    const minimumBitRate = profile === "UHD_4K" ? 60_000_000 : profile === "UHD_2K" ? 30_000_000 : 7_500_000;
    if (!video.bitRate) {
      violations.push(violation("VIDEO_BIT_RATE_MISSING", "video.bitRate"));
    } else if (video.bitRate < minimumBitRate) {
      violations.push(violation("VIDEO_BIT_RATE_TOO_LOW", "video.bitRate"));
    }

    if (audio) {
      if (audio.channels !== 2) violations.push(violation("AUDIO_CHANNELS_UNSUPPORTED", "audio.channels"));
      if (isUhd) {
        if (!audio.codecName?.toLowerCase().startsWith("pcm_")) {
          violations.push(violation("AUDIO_CODEC_UNSUPPORTED", "audio.codecName"));
        }
        if (audio.sampleRate !== 48_000) {
          violations.push(violation("AUDIO_SAMPLE_RATE_UNSUPPORTED", "audio.sampleRate"));
        }
      } else {
        if (audio.codecName?.toLowerCase() !== "aac") {
          violations.push(violation("AUDIO_CODEC_UNSUPPORTED", "audio.codecName"));
        }
        if (audio.sampleRate !== 44_100) {
          violations.push(violation("AUDIO_SAMPLE_RATE_UNSUPPORTED", "audio.sampleRate"));
        }
        if (!audio.bitRate) {
          violations.push(violation("AUDIO_BIT_RATE_MISSING", "audio.bitRate"));
        } else if (audio.bitRate < 320_000) {
          violations.push(violation("AUDIO_BIT_RATE_TOO_LOW", "audio.bitRate"));
        }
      }
    }
  }

  return {
    compliant: violations.length === 0,
    profile,
    profileVersion: VEVO_VIDEO_PROFILE_VERSION,
    violations,
  };
}

export function validateVevoVideoProbe(probe: VevoVideoProbe): VevoVideoQcResult {
  const result = inspectVevoVideoProbe(probe);
  if (!result.compliant) throw new VevoVideoQcError(result);
  return result;
}
