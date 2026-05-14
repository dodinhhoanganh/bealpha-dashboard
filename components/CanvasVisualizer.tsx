"use client";

import React, { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { AlertTriangle, Info, Monitor, Smartphone } from "lucide-react";

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

interface CanvasVisualizerProps {
  videoUrl: string; // Raw DB fileUrl — will be proxied through stream server
  type: "CANVAS" | "MOTION"; // CANVAS = 9:16, MOTION = 3:4 or 1:1
}

/**
 * Build a stream proxy URL from the raw DB fileUrl.
 * Prevents direct file access and routes through authenticated stream endpoint.
 */
function buildStreamUrl(fileUrl: string, type: "CANVAS" | "MOTION"): string {
  if (!fileUrl) return "";
  const marker = "/uploads/";
  const idx = fileUrl.indexOf(marker);
  if (idx !== -1) {
    const subPath = fileUrl.substring(idx + marker.length);
    const streamType = type === "CANVAS" ? "canvas" : "video";
    return `${UPLOAD_SERVER}/stream/${streamType}/${subPath}`;
  }
  return fileUrl;
}

export default function CanvasVisualizer({
  videoUrl,
  type,
}: CanvasVisualizerProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [viewMode, setViewMode] = useState<"MOBILE" | "DESKTOP">("MOBILE");

  // For Spotify Canvas (9:16), it's mobile only.
  // For Apple Motion, 3:4 is mobile, 1:1 is desktop/tv.
  const isCanvas = type === "CANVAS";
  const streamUrl = buildStreamUrl(videoUrl, type);

  return (
    <div className="bg-zinc-900 rounded-lg p-6 mt-4 border border-zinc-800">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            {isCanvas ? "Spotify Canvas Visualizer" : "Apple Motion Visualizer"}
            <span className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400 font-mono">
              {isCanvas ? "9:16" : "3:4 / 1:1"}
            </span>
          </h3>
          <p className="text-sm text-zinc-400 mt-1">
            Preview your artwork to ensure critical elements remain in the safe zones.
          </p>
        </div>
        {!isCanvas && (
          <div className="flex bg-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode("MOBILE")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === "MOBILE" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Mobile (3:4)
            </button>
            <button
              onClick={() => setViewMode("DESKTOP")}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === "DESKTOP" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              <Monitor className="w-4 h-4" />
              Desktop/TV (1:1)
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-center bg-black/50 p-8 rounded-lg overflow-hidden border border-zinc-800/50">
        <div
          className="relative overflow-hidden bg-black shadow-2xl"
          style={{
            width: isCanvas || viewMode === "MOBILE" ? "300px" : "400px",
            aspectRatio: isCanvas ? "9/16" : viewMode === "MOBILE" ? "3/4" : "1/1",
          }}
        >
          {/* Video Player */}
          <video
            ref={videoRef}
            src={streamUrl}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Safe Area Grilles */}
          <div className="absolute inset-0 pointer-events-none">
            {isCanvas && (
              <>
                {/* Spotify Safe Area Simulation */}
                <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-black/60 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-48 bg-gradient-to-t from-black/80 to-transparent" />
                {/* Safe zone boundary */}
                <div className="absolute inset-x-4 top-20 bottom-32 border border-dashed border-red-500/50" />
                <div className="absolute bottom-12 left-4 right-4 h-16 border border-zinc-700 rounded-md bg-zinc-800/30 backdrop-blur-sm flex items-center px-4">
                  <div className="w-10 h-10 bg-zinc-700 rounded-sm mr-3" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-zinc-600 rounded w-2/3" />
                    <div className="h-2 bg-zinc-700 rounded w-1/3" />
                  </div>
                </div>
              </>
            )}

            {!isCanvas && viewMode === "MOBILE" && (
              <>
                {/* Apple Music Mobile 3:4 Safe Area */}
                <div className="absolute top-0 left-0 w-full h-16 bg-gradient-to-b from-black/50 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-black/70 to-transparent" />
                {/* Safe zone boundary */}
                <div className="absolute inset-x-8 top-16 bottom-24 border border-dashed border-blue-500/50" />
              </>
            )}

            {!isCanvas && viewMode === "DESKTOP" && (
              <>
                {/* Apple Music 1:1 Safe Area - Full frame is mostly safe, but corners might be rounded */}
                <div className="absolute inset-0 border-[16px] border-black rounded-3xl" />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 p-4 bg-zinc-800/50 rounded-lg text-sm text-zinc-300">
        <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-white mb-1">{t("trackForm.safeAreaGuidelines")}</p>
          {isCanvas ? (
            <p>
              Keep important elements (like faces, logos, and text) inside the dashed red rectangle. The top and bottom edges will be overlaid with the app's UI elements like the back button and playback controls.
            </p>
          ) : (
            <p>
              For mobile devices (3:4), ensure all critical typography and faces are centered within the blue dashed lines to prevent being cropped by device notches or interface overlays.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
