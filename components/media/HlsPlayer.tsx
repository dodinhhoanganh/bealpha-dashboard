"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { extractStreamSubPath, getSignedStreamUrl } from "@/lib/stream-url";

export interface HlsPlayerHandle {
  play(): Promise<void> | void;
  pause(): void;
  seek(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
}

export interface HlsPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  loop?: boolean;
  className?: string;
  streamKind?: "audio" | "video";
  onReady?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * HLS player wrapper. Uses native playback where the browser supports HLS
 * (Safari, iOS) and falls back to hls.js everywhere else. Tracks the active
 * hls.js instance so it can be destroyed on src change/unmount — without
 * that, hls.js keeps the underlying MSE buffer alive and leaks memory + a
 * background fragment loader on every navigation.
 */
const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(function HlsPlayer(
  {
    src,
    poster,
    autoPlay = false,
    muted = false,
    controls = true,
    loop = false,
    className,
    streamKind = "video",
    onReady,
    onError,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      play: () => videoRef.current?.play() ?? Promise.resolve(),
      pause: () => videoRef.current?.pause(),
      seek: (s: number) => {
        if (videoRef.current) videoRef.current.currentTime = s;
      },
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      getDuration: () => videoRef.current?.duration ?? 0,
    }),
    [],
  );

  // Resolve signed URL up-front so the player gets a stable URL it can keep
  // for the whole session (signed URLs expire — caller is responsible for
  // remounting with a fresh src if playback spans the TTL).
  useEffect(() => {
    if (!src) {
      setResolvedSrc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const subPath = extractStreamSubPath(src);
        if (!subPath) {
          throw new Error("Unsupported HLS source format");
        }
        const signed = await getSignedStreamUrl(streamKind, subPath);
        if (!cancelled) setResolvedSrc(signed);
      } catch (err) {
        // Sign failure: do not attempt the unsigned URL — the server rejects
        // unsigned /stream/* requests anyway, and falling back here would
        // leave a misleading hung playback state. Surface the error instead.
        if (!cancelled) {
          setResolvedSrc(null);
          onError?.(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, streamKind, onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedSrc) return;

    let hlsInstance: { destroy: () => void } | null = null;
    let cancelled = false;

    const handleReady = () => onReady?.();
    video.addEventListener("loadedmetadata", handleReady);

    const isM3u8 = /\.m3u8(\?|$)/i.test(resolvedSrc);
    const canPlayNative =
      isM3u8 && video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (!isM3u8 || canPlayNative) {
      video.src = resolvedSrc;
      if (autoPlay) video.play().catch(() => {});
    } else {
      (async () => {
        try {
          const mod = await import("hls.js");
          if (cancelled) return;
          const Hls = mod.default;
          if (!Hls.isSupported()) {
            video.src = resolvedSrc;
            if (autoPlay) video.play().catch(() => {});
            return;
          }
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hlsInstance = hls;
          hls.loadSource(resolvedSrc);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) onError?.(data);
          });
          if (autoPlay) {
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {});
            });
          }
        } catch (err) {
          // hls.js missing or failed to init — fall back to native and let
          // the error surface via onError so callers can show a message.
          video.src = resolvedSrc;
          if (autoPlay) video.play().catch(() => {});
          onError?.(err);
        }
      })();
    }

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", handleReady);
      try {
        hlsInstance?.destroy();
      } catch {
        // ignore
      }
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // ignore
      }
    };
  }, [resolvedSrc, autoPlay, onReady, onError]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      muted={muted}
      controls={controls}
      loop={loop}
      playsInline
      className={className}
    />
  );
});

export default HlsPlayer;

