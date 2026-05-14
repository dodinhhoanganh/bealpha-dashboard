"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { PlayArrowIcon, PauseIcon } from "@/components/Icon";
import { getSignedStreamUrl, extractStreamSubPath } from "@/lib/stream-url";

interface VideoPlayerProps {
  videoUrl: string;

  height?: number;
  onReady?: () => void;
  // NEW PROPS FOR PREVIEW
  enablePreviewRegion?: boolean;
  onPreviewRegionChange?: (start: number, end: number) => void;
  initialPreviewStart?: number;
  initialPreviewEnd?: number;
}

export default function VideoPlayer({
  videoUrl,
  height = 360,
  onReady,
  enablePreviewRegion = false,
  onPreviewRegionChange,
  initialPreviewStart = 0,
  initialPreviewEnd = 30,
}: VideoPlayerProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const [previewStart, setPreviewStart] = useState(initialPreviewStart);
  const [previewEnd, setPreviewEnd] = useState(initialPreviewEnd);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const onPreviewRegionChangeRef = useRef(onPreviewRegionChange);
  onPreviewRegionChangeRef.current = onPreviewRegionChange;

  useEffect(() => {
    if (!videoUrl) return;
    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      setLoadProgress(0);

      if (videoUrl.startsWith("blob:")) {
        setObjectUrl(videoUrl);
        return;
      }

      try {
        const subPath = extractStreamSubPath(videoUrl);
        const signedUrl = subPath ? await getSignedStreamUrl("video", subPath) : videoUrl;
        
        if (cancelled) return;

        // Use the signed URL directly to stream the video. 
        // Fetching large videos as Blobs causes Out-Of-Memory (OOM) crashes on Mobile.
        setObjectUrl(signedUrl);
      } catch (err) {
        console.error("Failed to load video signed URL:", err);
        if (!cancelled) setObjectUrl(videoUrl);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  useEffect(() => {
    if (objectUrl && !objectUrl.startsWith("blob:") && objectUrl !== videoUrl) {
      return () => URL.revokeObjectURL(objectUrl);
    }
  }, [objectUrl, videoUrl]);

  useEffect(() => {
    if (!videoRef.current || !objectUrl) return;

    setIsPlaying(false);
    setCurrentTime(0);

    const video = videoRef.current;
    video.src = objectUrl;
    
    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      setIsLoading(false);
      if (onReadyRef.current) onReadyRef.current();

      // Ensure previewEnd doesn't exceed duration
      if (enablePreviewRegion && previewEnd > video.duration) {
        setPreviewEnd(video.duration);
      }
    };

    const updateTime = () => setCurrentTime(video.currentTime);
    const updateDuration = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", updateTime);
    video.addEventListener("durationchange", updateDuration);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", updateTime);
      video.removeEventListener("durationchange", updateDuration);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.pause();
      video.src = "";
    };
  }, [objectUrl, enablePreviewRegion, previewEnd]);

  useEffect(() => {
    if (enablePreviewRegion && onPreviewRegionChangeRef.current) {
      onPreviewRegionChangeRef.current(previewStart, previewEnd);
    }
  }, [previewStart, previewEnd, enablePreviewRegion]);

  const togglePlayPause = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (val < previewEnd) setPreviewStart(val);
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (val > previewStart) setPreviewEnd(val);
  };

  return (
    <div className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg overflow-hidden flex flex-col shadow-sm">
      {/* Top Header */}
      <div className="flex items-center justify-between p-3 bg-[var(--bg-surface-hover)] border-b border-[var(--border-primary)] text-xs font-mono text-[var(--text-tertiary)]">
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{t("media.videoPlayer", "Video")}</span>
      </div>

      {/* Video Container */}
      <div className="relative w-full bg-black flex justify-center items-center group cursor-pointer" style={{ height: `${height}px` }} onClick={togglePlayPause}>
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
            <div className="w-8 h-8 border-2 border-[#ff5500] border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-xs font-semibold text-[#ff5500]">
              {loadProgress > 0 ? `Loading ${loadProgress}%` : t("media.processing", "Processing...")}
            </span>
          </div>
        )}
        <video 
          ref={videoRef} 
          className="max-w-full max-h-full" 
          playsInline
        />
        <div className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity ${isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}>
          <div className="w-16 h-16 rounded-full bg-[#ff5500]/90 text-white flex items-center justify-center shadow-lg backdrop-blur-md">
            {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
          </div>
        </div>
      </div>

      {/* Preview Region Selector */}
      {enablePreviewRegion && duration > 0 && (
        <div className="p-4 bg-[var(--bg-surface)] border-t border-[var(--border-primary)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">Preview Region</span>
            <span className="text-[10px] font-mono bg-[#ff5500]/10 text-[#ff5500] px-2 py-0.5 rounded">
              {formatTime(previewStart)} - {formatTime(previewEnd)}
            </span>
          </div>
          
          {/* Custom Dual Slider */}
          <div className="relative w-full h-8 flex items-center">
            {/* Track Background */}
            <div className="absolute left-0 right-0 h-2 bg-[var(--bg-surface-hover)] rounded-full"></div>
            
            {/* Selected Range Highlight */}
            <div 
              className="absolute h-2 bg-[#ff5500]/50 rounded-full"
              style={{
                left: `${(previewStart / duration) * 100}%`,
                width: `${((previewEnd - previewStart) / duration) * 100}%`
              }}
            ></div>

            {/* Start Thumb */}
            <input 
              type="range" 
              min={0} 
              max={duration} 
              step="0.1"
              value={previewStart} 
              onChange={handleStartChange}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ff5500] [&::-webkit-slider-thumb]:shadow-md z-20"
            />
            
            {/* End Thumb */}
            <input 
              type="range" 
              min={0} 
              max={duration} 
              step="0.1"
              value={previewEnd} 
              onChange={handleEndChange}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ff5500] [&::-webkit-slider-thumb]:shadow-md z-20"
            />
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] text-center">
            Drag the two handles to select the preview segment for social media.
          </p>
        </div>
      )}
    </div>
  );
}
