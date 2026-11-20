"use client";

import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { PhotoCameraIcon } from "@/components/ui/Icon";


import { useUploadProgress } from "@/components/ui/UploadProgress";
import { resolveMediaReference } from "@/lib/stream-url";
import SecureImage, { useResolvedImageUrl } from "@/components/ui/SecureImage";

export default function ImageUpload({
  currentUrl,
  onUpload,
  type,
  shape = "square",
  entityName,
  labelName,
  artistName,
  releaseTitle,
}: {
  currentUrl?: string;
  onUpload: (url: string) => void;
  type: "avatars" | "artists" | "labels" | "covers";
  shape?: "square" | "circle";
  entityName?: string;
  labelName?: string;
  artistName?: string;
  releaseTitle?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localObjectUrlRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>();
  const resolvedCurrentUrl = useResolvedImageUrl(currentUrl);
  const displayedPreview = preview ?? resolvedCurrentUrl;
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const { uploadMedia } = useUploadProgress();
  const { t } = useI18n();

  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => {
    if (localObjectUrlRef.current) URL.revokeObjectURL(localObjectUrlRef.current);
  }, []);

  const processFile = (file: File) => {
    setError(null);
    // Validate file type
    if (!file.type.match(/^image\/(jpeg|png)$/i)) {
      setError(t("imageUpload.pleaseUploadJpgPng"));
      return;
    }

    // Validate file size (max 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError(t("imageUpload.imageTooLarge"));
      return;
    }

    // Load image
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    if (localObjectUrlRef.current) URL.revokeObjectURL(localObjectUrlRef.current);
    localObjectUrlRef.current = objectUrl;

    img.onload = async () => {
      let processedFile = file;

      // For covers (artwork): strict validation
      if (type === "covers") {
        // Check if square
        if (img.width !== img.height) {
          URL.revokeObjectURL(objectUrl);
          localObjectUrlRef.current = null;
          setError(t("imageUpload.pleaseUploadSquare"));
          return;
        }

        // Check resolution range
        if (img.width < 3000 || img.width > 6000) {
          URL.revokeObjectURL(objectUrl);
          localObjectUrlRef.current = null;
          setError(
            t("imageUpload.resolutionOutOfRange", `Image resolution must be between 3000x3000 and 6000x6000. Current: ${img.width}x${img.height}.`),
          );
          return;
        }
      }

      // For avatars: auto-crop to square if needed
      if (type === "avatars" && img.width !== img.height) {
        // Crop image to square (center crop)
        const canvas = document.createElement("canvas");
        const size = Math.min(img.width, img.height);
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          const offsetX = (img.width - size) / 2;
          const offsetY = (img.height - size) / 2;
          ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);

          // Convert canvas to blob
          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, file.type, 0.95);
          });

          if (blob) {
            processedFile = new File([blob], file.name, { type: file.type });
          }
        }
      }

      // If validation passes, set preview and upload
      setPreview(objectUrl);
      setUploading(true);
      setProgress(0);

      const extraData: Record<string, string> = {};
      if (entityName) extraData["entityName"] = entityName;
      if (labelName) extraData["labelName"] = labelName;
      if (artistName) extraData["artistName"] = artistName;
      if (releaseTitle) extraData["releaseTitle"] = releaseTitle;

      try {
        const data = await uploadMedia(
          "IMAGE",
          processedFile,
          processedFile.name,
          extraData,
          (p) => setProgress(p),
        );
        if (data && typeof data.url === "string") {
          onUpload(data.url);
          resolveMediaReference("image", data.url)
            .then(url => {
              setPreview(url);
              if (localObjectUrlRef.current) URL.revokeObjectURL(localObjectUrlRef.current);
              localObjectUrlRef.current = null;
            })
            .catch(() => { /* The local object URL remains until media processing is ready. */ });
        }
      } catch (err) {
        console.error("ImageUpload: upload failed", err);
        setError(t("imageUpload.failedUpload"));
      }

      setUploading(false);
      setProgress(0);
      // The local object URL is retained as the immediate private preview. It is
      // revoked when the component replaces it or unmounts.
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      localObjectUrlRef.current = null;
      setError(t("imageUpload.failedLoadImage"));
    };

    img.src = objectUrl;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative cursor-pointer group ${shape === "circle" ? "w-24 h-24 rounded-full" : "w-64 h-64 rounded-lg"} ${isDragging ? "bg-[var(--bg-surface-hover)] border-green-500" : "bg-[var(--bg-elevated)] border-[var(--border-primary)]"} border-2 border-dashed hover:border-green-500 overflow-hidden transition-colors`}
      >
        {displayedPreview ? (
          <SecureImage
            src={displayedPreview}
            alt={t("media.preview", "Preview")}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <PhotoCameraIcon size={48} color="#525252" />
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <PhotoCameraIcon size={32} color="#fff" />
        </div>
        {uploading && (
          <div className="absolute left-0 right-0 bottom-0 px-2 pb-2">
            <div className="h-2 bg-[var(--bg-elevated)] rounded overflow-hidden">
              <div
                className="h-2 bg-[var(--accent)] text-white"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="text-red-500 text-xs mt-1 text-center max-w-[250px]">
          {error}
        </p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png"
        className="hidden"
        onChange={handleFileChange}
      />
      <span className="text-xs text-[var(--text-disabled)]">
        {type === "covers" 
          ? t("imageUpload.clickToUploadSquare")
          : t("imageUpload.clickToUpload")}
      </span>
    </div>
  );
}
