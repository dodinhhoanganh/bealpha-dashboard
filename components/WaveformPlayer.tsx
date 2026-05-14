"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { PlayArrowIcon, PauseIcon } from "@/components/Icon";
import { getSignedStreamUrl, extractStreamSubPath } from "@/lib/stream-url";

interface WaveformPlayerProps {
  audioUrl: string;
  height?: number;
  waveColor?: string;
  progressColor?: string;
  cursorColor?: string;
  onReady?: () => void;
  enablePreviewRegion?: boolean;
  onPreviewRegionChange?: (start: number, end: number) => void;
  initialPreviewStart?: number;
  initialPreviewEnd?: number;
}

export default function WaveformPlayer({
  audioUrl,
  height = 80,
  waveColor = "#60a5fa", // Lighter blue for unplayed
  progressColor = "#2563eb", // Deep blue for played
  cursorColor = "#ffffff",
  onReady,
  enablePreviewRegion = false,
  onPreviewRegionChange,
  initialPreviewStart = 0,
  initialPreviewEnd = 30,
}: WaveformPlayerProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const activeRegionRef = useRef<any>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  
  const [isPreviewMode, setIsPreviewMode] = useState(enablePreviewRegion);
  const [volume, setVolume] = useState(1);
  const [isHoveringVolume, setIsHoveringVolume] = useState(false);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const onPreviewRegionChangeRef = useRef(onPreviewRegionChange);
  onPreviewRegionChangeRef.current = onPreviewRegionChange;

  const isPreviewModeRef = useRef(isPreviewMode);
  useEffect(() => {
    isPreviewModeRef.current = isPreviewMode;
  }, [isPreviewMode]);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    let cancelled = false;
    let ws: WaveSurfer | null = null;

    const init = async () => {
      setIsLoading(true);
      setLoadProgress(0);

      let finalMediaUrl = audioUrl;
      let fetchedBlob: Blob | null = null;

      if (!audioUrl.startsWith("blob:")) {
        try {
          const subPath = extractStreamSubPath(audioUrl);
          const signedUrl = subPath ? await getSignedStreamUrl("audio", subPath) : audioUrl;
          
          if (cancelled) return;

          const response = await fetch(signedUrl);
          if (!response.ok) throw new Error("Network response was not ok");
          
          const contentLength = response.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : 0;
          
          let loaded = 0;
          const reader = response.body?.getReader();
          const chunks = [];
          
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                loaded += value.length;
                if (total) {
                  setLoadProgress(Math.round((loaded / total) * 100));
                }
              }
            }
          }
          
          if (cancelled) return;
          fetchedBlob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
        } catch (err) {
          console.error("Failed to load audio blob:", err);
          finalMediaUrl = audioUrl;
        }
      }

      if (cancelled) return;

      const wsRegions = RegionsPlugin.create();
      regionsRef.current = wsRegions;

      // Premium visual touch: using bar width and gap
      ws = WaveSurfer.create({
        container: containerRef.current!,
        waveColor,
        progressColor,
        cursorColor,
        height,
        normalize: true,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 2,
        plugins: enablePreviewRegion ? [wsRegions] : [],
      });

      wavesurferRef.current = ws;
      ws.setVolume(volume);

      ws.on("ready", () => {
        if (cancelled) return;
        setIsLoading(false);
        setDuration(ws!.getDuration());
        if (onReadyRef.current) onReadyRef.current();

        if (enablePreviewRegion) {
          const wsDuration = ws!.getDuration();
          const end = Math.min(initialPreviewEnd, wsDuration);
          
          const region = wsRegions.addRegion({
            start: initialPreviewStart,
            end: end,
            color: 'rgba(37, 99, 235, 0.25)', // Deep blue transparent
            drag: true,
            resize: true,
          });
          activeRegionRef.current = region;

          wsRegions.on('region-updated', (r: any) => {
            if (onPreviewRegionChangeRef.current) {
              onPreviewRegionChangeRef.current(r.start, r.end);
            }
          });

          wsRegions.on('region-out', (r: any) => {
            if (isPreviewModeRef.current && r === activeRegionRef.current) {
              r.play();
            }
          });
        }
      });

      ws.on("timeupdate", (time) => setCurrentTime(time));
      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => setIsPlaying(false));

      if (fetchedBlob) {
        ws.loadBlob(fetchedBlob);
      } else {
        ws.load(finalMediaUrl);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (ws) ws.destroy();
    };
  }, [audioUrl, height, waveColor, progressColor, cursorColor, enablePreviewRegion]);

  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volume);
    }
  }, [volume]);

  const togglePlayPause = () => {
    if (!wavesurferRef.current) return;
    if (isPlaying) {
      wavesurferRef.current.pause();
    } else {
      if (isPreviewMode && activeRegionRef.current) {
        activeRegionRef.current.play();
      } else {
        wavesurferRef.current.play();
      }
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full bg-gradient-to-b from-[var(--bg-surface)] to-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded-xl p-4 flex flex-col gap-5 shadow-sm relative overflow-hidden">
      


      {/* Waveform Container */}
      <div className="relative w-full rounded-lg bg-[var(--bg-surface-elevated)] border border-[var(--border-secondary)] p-3 min-h-[100px] shadow-inner">
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-surface-elevated)]/80 backdrop-blur-sm z-10 rounded-lg">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mb-3 shadow-sm" />
            <span className="text-xs font-semibold tracking-wide text-blue-500">
              {loadProgress > 0 ? `Loading ${loadProgress}%` : t("media.processing", "Processing...")}
            </span>
          </div>
        )}
        <div ref={containerRef} className="w-full" />
      </div>

      {/* Controls Section */}
      <div className="flex items-center justify-between px-1">
        
        {/* Left: Play/Time */}
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={togglePlayPause}
            disabled={isLoading}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-gradient-to-b from-blue-500 to-blue-600 text-white hover:from-blue-400 hover:to-blue-500 active:scale-95 transition-all shadow-md shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <div className="transform group-hover:scale-110 transition-transform">
              {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
            </div>
          </button>
          
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--text-tertiary)] uppercase mb-0.5">Time</span>
            <span className="text-sm font-mono font-medium text-[var(--text-primary)] tracking-tight">
              {formatTime(currentTime)} <span className="text-[var(--text-tertiary)] mx-0.5">/</span> {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Right: Toggles and Volume */}
        <div className="flex items-center gap-6">
          
          {/* Segmented Control for Mode */}
          {enablePreviewRegion && (
            <div className="flex items-center bg-[var(--bg-surface-elevated)] p-1 rounded-lg border border-[var(--border-secondary)] shadow-inner">
              <button
                type="button"
                onClick={() => setIsPreviewMode(false)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${!isPreviewMode ? 'bg-[var(--bg-surface)] text-blue-500 shadow-sm ring-1 ring-black/5 dark:ring-white/5' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
              >
                Full Track
              </button>
              <button
                type="button"
                onClick={() => setIsPreviewMode(true)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${isPreviewMode ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 shadow-sm ring-1 ring-blue-500/20' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
              >
                Preview Mode
              </button>
            </div>
          )}

          {/* Volume Control */}
          <div 
            className="flex items-center gap-3 bg-[var(--bg-surface-elevated)] px-3 py-2 rounded-lg border border-[var(--border-secondary)] transition-all duration-300"
            onMouseEnter={() => setIsHoveringVolume(true)}
            onMouseLeave={() => setIsHoveringVolume(false)}
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke={volume === 0 ? "var(--text-disabled)" : "var(--text-secondary)"} 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className={`transition-colors ${isHoveringVolume ? 'text-blue-500' : ''}`}
              onClick={() => setVolume(volume === 0 ? 1 : 0)}
              style={{ cursor: 'pointer' }}
            >
              {volume === 0 ? (
                <>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <line x1="23" y1="9" x2="17" y2="15"></line>
                  <line x1="17" y1="9" x2="23" y2="15"></line>
                </>
              ) : (
                <>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                </>
              )}
            </svg>
            <div className={`transition-all duration-300 overflow-hidden flex items-center ${isHoveringVolume ? 'w-20 opacity-100' : 'w-0 opacity-0'}`}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
