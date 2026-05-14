"use client";

import { useEffect, useRef, useState } from "react";

import { PauseIcon, PlayArrowIcon } from "@/components/Icon";
import { getSignedStreamUrl, extractStreamSubPath } from "@/lib/stream-url";

interface CanvasPreviewProps {
  videoUrl: string;
  height?: number;
}

export default function CanvasPreview({
  videoUrl,
  height = 400,
}: CanvasPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!videoRef.current || !videoUrl) return;

    const video = videoRef.current;
    let cancelled = false;

    const init = async () => {
      setIsLoading(true);

      if (videoUrl.startsWith("blob:")) {
        video.src = videoUrl;
        return;
      }

      try {
        const subPath = extractStreamSubPath(videoUrl);
        const signedUrl = subPath ? await getSignedStreamUrl("canvas", subPath) : videoUrl;
        
        if (cancelled) return;

        // Fetch as Blob to prevent IDM
        const response = await fetch(signedUrl);
        if (!response.ok) throw new Error("Network response was not ok");
        
        const blob = await response.blob();
        if (cancelled) return;
        
        const objectUrl = URL.createObjectURL(blob);
        video.src = objectUrl;

        const handleCanPlay = () => {
          setIsLoading(false);
          video.play().catch(() => setIsPlaying(false)); // Autoplay might fail
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleWaiting = () => setIsLoading(true);
        const handlePlaying = () => setIsLoading(false);

        video.addEventListener("canplay", handleCanPlay);
        video.addEventListener("play", handlePlay);
        video.addEventListener("pause", handlePause);
        video.addEventListener("waiting", handleWaiting);
        video.addEventListener("playing", handlePlaying);

      } catch (err) {
        console.error("Failed to load canvas blob:", err);
        if (!cancelled) video.src = videoUrl;
      }
    };

    init();

    return () => {
      cancelled = true;
      video.pause();
      if (video.src.startsWith("blob:")) {
        URL.revokeObjectURL(video.src);
      }
      video.src = "";
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
          Spotify Canvas
        </div>
        <div className="text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)] px-2 py-0.5 rounded-full border border-[var(--border-primary)]">
          9:16 Loop
        </div>
      </div>
      
      {/* 9:16 Container (e.g. 225x400) */}
      <div 
        className="relative bg-black rounded-md overflow-hidden group cursor-pointer shadow-md"
        style={{ height: `${height}px`, width: `${Math.round((height * 9) / 16)}px` }}
        onClick={togglePlayPause}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="w-6 h-6 border-2 border-[#1db954] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
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
