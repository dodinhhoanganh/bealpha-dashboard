/**
 * Audio Processing Pipeline
 *
 * Validates, inspects, and processes audio files on upload.
 * Uses native Node.js file inspection (no FFmpeg dependency required).
 * For full transcoding, install ffmpeg and uncomment the relevant sections.
 */

import { readFile, stat } from "fs/promises";
import path from "path";

// ── Types ────────────────────────────────────────────────
export interface AudioMetadata {
  fileName: string;
  fileSize: number; // bytes
  fileSizeHuman: string; // "12.5 MB"
  format: string; // wav, flac, mp3, aac, ogg
  mimeType: string;
  duration?: number; // seconds
  sampleRate?: number; // e.g. 44100, 48000, 96000
  bitDepth?: number; // 16, 24, 32
  channels?: number; // 1 = mono, 2 = stereo
  bitrate?: number; // kbps (for lossy formats)
  codec?: string;
}

export interface AudioValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: AudioMetadata;
}

export interface ProcessingResult {
  success: boolean;
  metadata: AudioMetadata;
  waveform?: number[]; // Normalized amplitude peaks [0-1]
  error?: string;
}

// ── Format Detection ─────────────────────────────────────
const FORMAT_MAP: Record<string, { format: string; mimeType: string }> = {
  ".wav": { format: "wav", mimeType: "audio/wav" },
  ".flac": { format: "flac", mimeType: "audio/flac" },
  ".mp3": { format: "mp3", mimeType: "audio/mpeg" },
  ".aac": { format: "aac", mimeType: "audio/aac" },
  ".m4a": { format: "m4a", mimeType: "audio/mp4" },
  ".ogg": { format: "ogg", mimeType: "audio/ogg" },
  ".opus": { format: "opus", mimeType: "audio/opus" },
  ".aiff": { format: "aiff", mimeType: "audio/aiff" },
  ".aif": { format: "aiff", mimeType: "audio/aiff" },
};

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// ── WAV Header Parser ────────────────────────────────────
function parseWavHeader(buffer: Buffer): Partial<AudioMetadata> {
  if (buffer.length < 44) return {};
  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") return {};

  // Find fmt chunk
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      const audioFormat = buffer.readUInt16LE(offset + 8);
      const channels = buffer.readUInt16LE(offset + 10);
      const sampleRate = buffer.readUInt32LE(offset + 12);
      const byteRate = buffer.readUInt32LE(offset + 16);
      const bitDepth = buffer.readUInt16LE(offset + 22);

      // Find data chunk for duration
      let dataSize = 0;
      let dOffset = offset + 8 + chunkSize;
      while (dOffset < buffer.length - 8) {
        const dChunkId = buffer.toString("ascii", dOffset, dOffset + 4);
        const dChunkSize = buffer.readUInt32LE(dOffset + 4);
        if (dChunkId === "data") {
          dataSize = dChunkSize;
          break;
        }
        dOffset += 8 + dChunkSize;
      }

      const duration = byteRate > 0 ? dataSize / byteRate : undefined;

      return {
        codec:
          audioFormat === 1
            ? "PCM"
            : audioFormat === 3
              ? "IEEE Float"
              : `Format ${audioFormat}`,
        channels,
        sampleRate,
        bitDepth,
        bitrate: Math.round((byteRate * 8) / 1000),
        duration,
      };
    }
    offset += 8 + chunkSize;
  }
  return {};
}

// ── FLAC Header Parser ───────────────────────────────────
function parseFlacHeader(buffer: Buffer): Partial<AudioMetadata> {
  if (buffer.length < 42) return {};
  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== "fLaC") return {};

  // STREAMINFO is always the first metadata block
  // Skip: 1 byte (flags) + 3 bytes (length) = start at byte 8
  const minBlockSize = buffer.readUInt16BE(8);
  const maxBlockSize = buffer.readUInt16BE(10);

  // Bytes 18-21 contain sample rate (20 bits), channels (3 bits), bits per sample (5 bits)
  const sampleRate = (buffer[18] << 12) | (buffer[19] << 4) | (buffer[20] >> 4);
  const channels = ((buffer[20] >> 1) & 0x07) + 1;
  const bitDepth = ((buffer[20] & 0x01) << 4) | ((buffer[21] >> 4) + 1);

  // Total samples: 36 bits starting at byte 21 bit 4
  const totalSamples =
    (buffer[21] & 0x0f) * 2 ** 32 +
    (buffer[22] << 24) +
    (buffer[23] << 16) +
    (buffer[24] << 8) +
    buffer[25];

  const duration = sampleRate > 0 ? totalSamples / sampleRate : undefined;

  return {
    codec: "FLAC",
    channels,
    sampleRate,
    bitDepth,
    duration,
  };
}

// ── MP3 Header Parser (basic) ────────────────────────────
function parseMp3Header(buffer: Buffer): Partial<AudioMetadata> {
  // Find first sync word (0xFF 0xFB/FA/F3/F2)
  let offset = 0;
  // Skip ID3v2 tag if present
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const tagSize =
      (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
    offset = tagSize + 10;
  }

  for (let i = offset; i < Math.min(buffer.length - 4, offset + 4096); i++) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      const version = (buffer[i + 1] >> 3) & 0x03; // 0=2.5, 2=2, 3=1
      const layer = (buffer[i + 1] >> 1) & 0x03; // 1=III, 2=II, 3=I
      const bitrateIdx = (buffer[i + 2] >> 4) & 0x0f;
      const sampleIdx = (buffer[i + 2] >> 2) & 0x03;
      const channels = ((buffer[i + 3] >> 6) & 0x03) < 3 ? 2 : 1;

      // MPEG1 Layer III bitrate table
      const bitrates = [
        0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
      ];
      const sampleRates: Record<number, number[]> = {
        3: [44100, 48000, 32000], // MPEG1
        2: [22050, 24000, 16000], // MPEG2
        0: [11025, 12000, 8000], // MPEG2.5
      };

      const bitrate = bitrates[bitrateIdx] || 128;
      const sampleRate = sampleRates[version]?.[sampleIdx] || 44100;

      return {
        codec: `MPEG${version === 3 ? "1" : "2"} Layer ${["", "III", "II", "I"][layer] || "III"}`,
        channels,
        sampleRate,
        bitrate,
      };
    }
  }
  return { codec: "MP3" };
}

// ── Main: Inspect Audio File ─────────────────────────────
export async function inspectAudioFile(
  filePath: string,
): Promise<AudioMetadata> {
  const ext = path.extname(filePath).toLowerCase();
  const info = FORMAT_MAP[ext];
  const fileStat = await stat(filePath);

  const metadata: AudioMetadata = {
    fileName: path.basename(filePath),
    fileSize: fileStat.size,
    fileSizeHuman: humanFileSize(fileStat.size),
    format: info?.format || ext.replace(".", ""),
    mimeType: info?.mimeType || "application/octet-stream",
  };

  // Read first 64KB for header parsing
  const buffer = Buffer.alloc(65536);
  const fd = await readFile(filePath);
  fd.copy(buffer, 0, 0, Math.min(fd.length, 65536));

  let parsed: Partial<AudioMetadata> = {};

  switch (metadata.format) {
    case "wav":
      parsed = parseWavHeader(buffer);
      break;
    case "flac":
      parsed = parseFlacHeader(buffer);
      break;
    case "mp3":
      parsed = parseMp3Header(buffer);
      // Estimate duration from file size and bitrate
      if (parsed.bitrate && !parsed.duration) {
        parsed.duration = (fileStat.size * 8) / (parsed.bitrate * 1000);
      }
      break;
    case "aiff":
      parsed = { codec: "AIFF" }; // Basic detection
      break;
    default:
      break;
  }

  return { ...metadata, ...parsed };
}

// ── Validate Audio for Distribution ──────────────────────
export async function validateAudioFile(
  filePath: string,
): Promise<AudioValidation> {
  const metadata = await inspectAudioFile(filePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Format check
  const losslessFormats = ["wav", "flac", "aiff"];
  const lossyFormats = ["mp3", "aac", "m4a", "ogg", "opus"];
  const allFormats = [...losslessFormats, ...lossyFormats];

  if (!allFormats.includes(metadata.format)) {
    errors.push(
      `Unsupported format: ${metadata.format}. Use WAV, FLAC, MP3, AAC, or OGG.`,
    );
  }

  // Prefer lossless for distribution
  if (lossyFormats.includes(metadata.format)) {
    warnings.push(
      `Lossy format (${metadata.format.toUpperCase()}) detected. Lossless (WAV/FLAC) recommended for distribution.`,
    );
  }

  // Sample rate
  if (metadata.sampleRate) {
    if (metadata.sampleRate < 44100) {
      errors.push(
        `Sample rate ${metadata.sampleRate}Hz is below minimum 44100Hz.`,
      );
    }
    if (metadata.sampleRate > 192000) {
      warnings.push(
        `Very high sample rate (${metadata.sampleRate}Hz). Most DSPs accept up to 96kHz.`,
      );
    }
  }

  // Bit depth (for lossless)
  if (metadata.bitDepth && losslessFormats.includes(metadata.format)) {
    if (metadata.bitDepth < 16) {
      errors.push(
        `Bit depth ${metadata.bitDepth}-bit is below minimum 16-bit.`,
      );
    }
  }

  // Channels
  if (metadata.channels) {
    if (metadata.channels > 2) {
      warnings.push(
        `${metadata.channels} channels detected. Most DSPs require stereo (2ch) or mono (1ch).`,
      );
    }
  }

  // File size
  if (metadata.fileSize > 500 * 1024 * 1024) {
    warnings.push(
      `Large file (${metadata.fileSizeHuman}). Consider optimizing.`,
    );
  }

  // Duration bounds
  if (metadata.duration) {
    if (metadata.duration < 1) {
      errors.push("Audio duration is less than 1 second.");
    }
    if (metadata.duration > 7200) {
      warnings.push("Audio is longer than 2 hours.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata,
  };
}

// ── Generate Waveform Peaks (WAV only) ───────────────────
export async function generateWaveformPeaks(
  filePath: string,
  peakCount: number = 200,
): Promise<number[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".wav") {
    // For non-WAV, return flat placeholder
    return Array(peakCount).fill(0.5);
  }

  const fileBuffer = await readFile(filePath);

  // Find data chunk
  let dataOffset = 44; // default for standard WAV
  let dataSize = fileBuffer.length - 44;

  let offset = 12;
  while (offset < fileBuffer.length - 8) {
    const chunkId = fileBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = fileBuffer.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  // Parse fmt for bit depth
  const bitDepth = fileBuffer.readUInt16LE(34) || 16;
  const bytesPerSample = bitDepth / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const samplesPerPeak = Math.max(1, Math.floor(totalSamples / peakCount));

  const peaks: number[] = [];

  for (let i = 0; i < peakCount; i++) {
    let maxAmplitude = 0;
    const start = dataOffset + i * samplesPerPeak * bytesPerSample;

    for (
      let j = 0;
      j < samplesPerPeak && start + j * bytesPerSample < dataOffset + dataSize;
      j++
    ) {
      const pos = start + j * bytesPerSample;
      let sample = 0;

      if (bytesPerSample === 2) {
        sample = fileBuffer.readInt16LE(pos);
        maxAmplitude = Math.max(maxAmplitude, Math.abs(sample) / 32768);
      } else if (bytesPerSample === 3) {
        sample =
          fileBuffer[pos] |
          (fileBuffer[pos + 1] << 8) |
          (fileBuffer[pos + 2] << 16);
        if (sample & 0x800000) sample |= ~0xffffff;
        maxAmplitude = Math.max(maxAmplitude, Math.abs(sample) / 8388608);
      } else if (bytesPerSample === 4) {
        sample = fileBuffer.readInt32LE(pos);
        maxAmplitude = Math.max(maxAmplitude, Math.abs(sample) / 2147483648);
      }
    }

    peaks.push(Math.min(1, maxAmplitude));
  }

  return peaks;
}

// ── Process Audio File (full pipeline) ───────────────────
export async function processAudioFile(
  filePath: string,
): Promise<ProcessingResult> {
  try {
    const metadata = await inspectAudioFile(filePath);
    let waveform: number[] | undefined;

    try {
      waveform = await generateWaveformPeaks(filePath);
    } catch {
      // Waveform generation is optional
    }

    return { success: true, metadata, waveform };
  } catch (error) {
    return {
      success: false,
      metadata: {
        fileName: path.basename(filePath),
        fileSize: 0,
        fileSizeHuman: "0 B",
        format: "unknown",
        mimeType: "application/octet-stream",
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
