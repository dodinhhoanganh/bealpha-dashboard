"use client";

import { useEffect, useRef, useState } from "react";

import { PauseIcon, PlayArrowIcon } from "@/components/ui/Icon";
import { getSignedStreamUrl, extractStreamSubPath } from "@/lib/stream-url";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface CanvasPreviewProps {
  videoUrl: string;
  height?: number;
}

export default function CanvasPreview({
  videoUrl,
  height = 400,
}: CanvasPreviewProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current || !videoUrl) return;

    const video = videoRef.current;
    let cancelled = false;
    const listeners: Array<[keyof HTMLVideoElementEventMap, EventListener]> = [];

    const addListener = <K extends keyof HTMLVideoElementEventMap>(
      type: K,
      handler: (ev: HTMLVideoElementEventMap[K]) => void,
    ) => {
      video.addEventListener(type, handler as EventListener);
      listeners.push([type, handler as EventListener]);
    };

    const init = async () => {
      setIsLoading(true);
      setLoadError(null);

      if (videoUrl.startsWith("blob:")) {
        addListener("canplay", () => {
          setIsLoading(false);
          video.play().catch(() => setIsPlaying(false));
        });
        addListener("play", () => setIsPlaying(true));
        addListener("pause", () => setIsPlaying(false));
        addListener("error", () => {
          if (!cancelled) {
            setIsLoading(false);
            setLoadError("Failed to load canvas");
          }
        });
        video.src = videoUrl;
        return;
      }

      // IDM-resistance: don't fetch the entire video into a Blob (that exposes
      // one capturable full-file response). Sign the URL and hand it to the
      // native <video> element so playback uses range requests — capped
      // server-side by MAX_RANGE_BYTES and per-IP concurrent stream limits.
      let signedUrl: string;
      try {
        const subPath = extractStreamSubPath(videoUrl);
        if (!subPath) {
          throw new Error("Unsupported canvas source format");
        }
        signedUrl = await getSignedStreamUrl("canvas", subPath);
      } catch (err) {
        console.error("Failed to sign canvas URL:", err);
        if (!cancelled) {
          setIsLoading(false);
          setLoadError("Failed to load canvas");
        }
        return;
      }

      if (cancelled) return;

      addListener("canplay", () => {
        setIsLoading(false);
        video.play().catch(() => setIsPlaying(false));
      });
      addListener("play", () => setIsPlaying(true));
      addListener("pause", () => setIsPlaying(false));
      addListener("waiting", () => setIsLoading(true));
      addListener("playing", () => setIsLoading(false));
      addListener("error", () => {
        if (!cancelled) {
          setIsLoading(false);
          setLoadError("Failed to load canvas");
        }
      });

      video.src = signedUrl;
    };

    init();

    return () => {
      cancelled = true;
      for (const [type, handler] of listeners) {
        video.removeEventListener(type, handler);
      }
      try { video.pause(); } catch {}
      video.removeAttribute("src");
      try { video.load(); } catch {}
    };
  }, [videoUrl]);

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
    }
  };

  return (
    <div className="flex flex-col items-center w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg overflow-hidden shadow-sm p-4">
      <div className="flex items-center justify-between w-full mb-3">
        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          {t("trackForm.spotifyCanvas", "Spotify Canvas")}
        </div>
        <div className="text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)] px-2 py-0.5 rounded-full border border-[var(--border-primary)]">
          {t("ui.canvasPreview.value916Loop", "9:16 Loop")}
        </div>
      </div>
      
      {/* 9:16 Container (e.g. 225x400) */}
      <div 
        className="relative bg-black rounded-md overflow-hidden group cursor-pointer shadow-md"
        style={{ height: `${height}px`, width: `${Math.round((height * 9) / 16)}px` }}
        onClick={togglePlayPause}
      >
        {loadError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
            <span className="text-xs font-semibold text-red-400 px-3 text-center">{loadError}</span>
          </div>
        ) : isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="w-6 h-6 border-2 border-[#1db954] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : null}
        <video 
          ref={videoRef} 
          className="w-full h-full object-cover" 
          loop
          muted // Spotify canvas is muted
          playsInline
        />
        <div className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity ${isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}>
          <div className="w-12 h-12 rounded-full bg-[#1db954]/90 text-white flex items-center justify-center shadow-lg backdrop-blur-md">
            {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
          </div>
        </div>
      </div>
    </div>
  );
}


