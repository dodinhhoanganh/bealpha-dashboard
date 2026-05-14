"use client";

import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { CloudUploadIcon, DeleteIcon, ReplaceIcon } from "@/components/Icon";
import WaveformPlayer from "./WaveformPlayer";
import VideoPlayer from "./VideoPlayer";

interface MediaUploadWithPreviewProps {
  type?: "AUDIO" | "VIDEO";
  currentMediaUrl?: string;
  currentFilename?: string;
  // onUpload should accept an optional progress callback: (file, onProgress) => Promise<string>
  onUpload: (file: File, onProgress?: (p: number) => void) => Promise<string>;
  onDelete?: () => void;
  label?: string;
}

export default function MediaUploadWithPreview({
  type = "AUDIO",
  currentMediaUrl,
  currentFilename,
  onUpload,
  onDelete,
  label = "Media File",
}: MediaUploadWithPreviewProps) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState(currentMediaUrl || "");
  const [filename, setFilename] = useState(currentFilename || "");
  const [progress, setProgress] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync with external media URL prop
  useEffect(() => {
    if (currentMediaUrl) {
      setMediaUrl(currentMediaUrl);
      setFilename(currentFilename || "");
    } else if (currentMediaUrl === "") {
      setMediaUrl("");
      setFilename("");
    }
  }, [currentMediaUrl, currentFilename]);

  const processFile = async (file: File) => {
    if (!file) return;

    // Don't rely on extension/mimetype for validation; server will verify magic headers.
    if (!file) return;

    setUploading(true);

    try {
      // Create temporary preview URL
      const tempUrl = URL.createObjectURL(file);
      setMediaUrl(tempUrl);
      setFilename(file.name);
      // Upload file with progress callback
      setUploading(true);
      setProgress(0);
      const uploadedUrl = await onUpload(file, (p: number) => setProgress(p));

      // Replace temp URL with actual uploaded URL
      URL.revokeObjectURL(tempUrl);
      setMediaUrl(uploadedUrl);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(t("error.failedToUploadMediaFile", "Failed to upload media file"));
      setMediaUrl("");
      setFilename("");
    } finally {
      setUploading(false);
      setUploading(false);
      setProgress(0);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDelete = () => {
    setMediaUrl("");
    setFilename("");
    if (onDelete) onDelete();
  };

  const handleReplace = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
        {label}
      </label>

      <input
        ref={fileInputRef}
        type="file"
        accept={
          type === "VIDEO"
            ? ".mp4,.mkv,video/mp4,video/x-matroska"
            : ".wav,.flac,audio/wav,audio/flac"
        }
        onChange={handleFileSelect}
        className="hidden"
      />

      {!mediaUrl ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          disabled={uploading}
          className={`w-full p-8 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-3 transition-colors ${isDragging ? "bg-[var(--bg-surface-hover)] border-green-500" : "border-[var(--border-input)] hover:border-green-500 hover:bg-[var(--bg-surface-hover)]"}`}
        >
          <CloudUploadIcon size={48} color="#525252" />
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--text-tertiary)]">
              {uploading
                ? "Uploading..."
                : `Click to upload ${type === "VIDEO" ? "video" : "audio"} file`}
            </p>
            <p className="text-xs text-[var(--text-disabled)] mt-1">
              {type === "VIDEO" ? "MP4, MKV supported" : "WAV, FLAC supported"}
            </p>
          </div>
        </button>
      ) : (
        <div className="space-y-4">
          {/* File info */}
          <div className="flex items-center justify-between px-1">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[70%]">
              {decodeURIComponent(filename?.split(/[\\/]/).pop() || "")}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReplace}
                disabled={uploading}
                className="p-2 hover:bg-[var(--status-info)]/20 rounded-lg text-[var(--status-info)] transition-colors"
                title={t("media.replaceMedia")}
              >
                <ReplaceIcon size={20} />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="p-2 hover:bg-[var(--status-error)]/20 rounded-lg text-[var(--status-error)] transition-colors"
                title={t("media.removeMedia")}
              >
                <DeleteIcon size={20} />
              </button>
            </div>
          </div>

          {uploading && (
            <div className="w-full">
              <div className="h-2 bg-transparent rounded overflow-hidden mt-2">
                <div
                  className="h-2 bg-[var(--accent)] text-white"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-disabled)] mt-1">
                Uploading: {progress}%
              </p>
            </div>
          )}

          {type === "VIDEO" ? (
            <div className="max-w-3xl mx-auto rounded overflow-hidden">
              <VideoPlayer
                videoUrl={mediaUrl || ""}
              />
            </div>
          ) : (
            <WaveformPlayer
              audioUrl={mediaUrl || ""}
            />
          )}
        </div>
      )}
    </div>
  );
}
