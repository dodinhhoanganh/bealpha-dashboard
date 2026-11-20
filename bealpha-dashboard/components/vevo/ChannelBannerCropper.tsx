"use client";

import React, { useRef, useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { CloudUploadIcon } from "@/components/ui/Icon";

interface ChannelBannerCropperProps {
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

type Point = { x: number; y: number };

export default function ChannelBannerCropper({ onCrop, onCancel }: ChannelBannerCropperProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string>("");

  const CANVAS_WIDTH = 2560;
  const CANVAS_HEIGHT = 1440;
  const SAFE_WIDTH = 1546;
  const SAFE_HEIGHT = 423;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError(t("imageUpload.pleaseUploadImage"));
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    const releaseBlobUrl = () => URL.revokeObjectURL(objectUrl);
    img.src = objectUrl;
    img.onload = () => {
      setImage(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError("");
      releaseBlobUrl();
    };
    img.onerror = () => {
      releaseBlobUrl();
      setError(t("error.imageDecodeFailed", "Failed to load banner image."));
    };
  };

  const getCanvasScale = () => {
    const canvas = canvasRef.current;
    if (!canvas) return { scaleX: 1, scaleY: 1 };
    return {
      scaleX: CANVAS_WIDTH / Math.max(canvas.clientWidth, 1),
      scaleY: CANVAS_HEIGHT / Math.max(canvas.clientHeight, 1),
    };
  };

  const eventToPoint = (clientX: number, clientY: number): Point => {
    const { scaleX, scaleY } = getCanvasScale();
    return { x: clientX * scaleX, y: clientY * scaleY };
  };

  const beginDrag = (clientX: number, clientY: number) => {
    const point = eventToPoint(clientX, clientY);
    setIsDragging(true);
    setDragStart({ x: point.x - offset.x, y: point.y - offset.y });
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    const point = eventToPoint(clientX, clientY);
    setOffset({
      x: point.x - dragStart.x,
      y: point.y - dragStart.y,
    });
  };

  useEffect(() => {
    if (!image || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Calculate initial scale to cover the canvas
    const scale = Math.max(CANVAS_WIDTH / image.width, CANVAS_HEIGHT / image.height) * zoom;

    // Calculate drawn image dimensions
    const imgW = image.width * scale;
    const imgH = image.height * scale;

    // Draw the image centered with offset
    const dx = (CANVAS_WIDTH - imgW) / 2 + offset.x;
    const dy = (CANVAS_HEIGHT - imgH) / 2 + offset.y;

    ctx.drawImage(image, dx, dy, imgW, imgH);

    // Draw dark overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Clear the "Safe Zone" area
    const safeX = (CANVAS_WIDTH - SAFE_WIDTH) / 2;
    const safeY = (CANVAS_HEIGHT - SAFE_HEIGHT) / 2;

    ctx.clearRect(safeX, safeY, SAFE_WIDTH, SAFE_HEIGHT);

    // Draw the image again ONLY inside the safe zone (to bypass the dark overlay)
    ctx.save();
    ctx.beginPath();
    ctx.rect(safeX, safeY, SAFE_WIDTH, SAFE_HEIGHT);
    ctx.clip();
    ctx.drawImage(image, dx, dy, imgW, imgH);
    ctx.restore();

    // Draw Safe Zone Border
    ctx.strokeStyle = "#4ade80"; // var(--accent)
    ctx.lineWidth = 4;
    ctx.strokeRect(safeX, safeY, SAFE_WIDTH, SAFE_HEIGHT);

    // Draw guide text
    ctx.fillStyle = "#4ade80";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TV & Desktop Safe Zone (1546 x 423)", CANVAS_WIDTH / 2, safeY - 20);

  }, [image, zoom, offset]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    beginDrag(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    updateDrag(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    beginDrag(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    updateDrag(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleSave = () => {
    if (!canvasRef.current || !image) return;

    // Create a temporary canvas without the overlay for saving
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const scale = Math.max(CANVAS_WIDTH / image.width, CANVAS_HEIGHT / image.height) * zoom;
    const imgW = image.width * scale;
    const imgH = image.height * scale;
    const dx = (CANVAS_WIDTH - imgW) / 2 + offset.x;
    const dy = (CANVAS_HEIGHT - imgH) / 2 + offset.y;

    ctx.drawImage(image, dx, dy, imgW, imgH);

    exportCanvas.toBlob((blob) => {
      if (blob) onCrop(blob);
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="flex flex-col items-center w-full p-6 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-primary)] shadow-lg">
      <h2 className="text-xl font-bold mb-4 text-[var(--text-primary)]">{t("heading.vEVOChannelBannerCropper", "VEVO Channel Banner Cropper")}</h2>
      <p className="text-sm text-[var(--text-secondary)] mb-6 text-center max-w-2xl">
        {t("ui.channelBannerCropper.uploadAHighResolutionImageAtLeast", "Upload a high-resolution image (at least 2560x1440). Drag to reposition and use the slider to zoom. Ensure your artist name and logo fit within the green safe zone to guarantee it is visible on all devices (TVs, Desktops, and Mobiles).")}
      </p>

      {!image ? (
        <div className="w-full max-w-xl border-2 border-dashed border-[var(--border-primary)] rounded-xl p-12 text-center hover:bg-[var(--bg-surface-hover)] transition-colors">
          <label className="cursor-pointer flex flex-col items-center">
            <CloudUploadIcon size={48} className="mb-4 text-[var(--text-tertiary)]" />
            <span className="text-lg font-medium text-[var(--accent-text)]">{t("channels.clickToUploadBanner")}</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center">
          {/* Display canvas dynamically scaled via CSS but maintaining internal 2560x1440 resolution */}
          <div className="w-full max-w-5xl rounded-lg overflow-hidden border-2 border-[var(--border-input)] cursor-grab active:cursor-grabbing mb-6" style={{ aspectRatio: '2560/1440' }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              className="w-full h-full object-contain bg-black"
            />
          </div>

          <div className="w-full max-w-xl flex items-center gap-4 mb-8">
            <span className="text-sm text-[var(--text-secondary)]">{t("channels.zoom")}</span>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">{(zoom * 100).toFixed(0)}%</span>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setImage(null)}
              className="px-6 py-3 text-sm font-medium rounded-lg text-[var(--text-primary)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] transition-colors"
            >
              {t("ui.channelBannerCropper.chooseDifferentImage", "Choose Different Image")}
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-3 text-sm font-medium rounded-lg text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors"
            >
              {t("ui.channelBannerCropper.cropContinue", "Crop & Continue")}
            </button>
            <button
              onClick={onCancel}
              className="px-6 py-3 text-sm font-medium rounded-lg text-[var(--status-error)] bg-[var(--status-error)]/10 hover:bg-[var(--status-error)]/20 transition-colors"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[var(--status-error)] mt-4">{error}</p>}
    </div>
  );
}
