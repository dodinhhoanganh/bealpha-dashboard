"use client";

import { useState, useRef } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import SearchableArtistSelect from "./SearchableArtistSelect";
import WaveformPlayer from "./WaveformPlayer";
import VideoPlayer from "./VideoPlayer";
import CanvasPreview from "./CanvasPreview";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { LANGUAGES } from "@/lib/languages";
import { LocalizedInput } from "./LocalizedInput";
import { AddIcon, DeleteIcon, CloudUploadIcon } from "@/components/Icon";
import { useUploadProgress } from "@/components/UploadProgress";

interface Artist {
  id: string;
  name: string;
  spotifyId?: string;
  appleMusicId?: string;
}

interface Contributor {
  name: string;
  role: string;
  artistId?: string;
}

interface LocalizedField {
  language: string;
  value: string;
}

interface AssetFormData {
  // File
  fileUrl: string;
  fileName: string;
  type: "AUDIO" | "VIDEO" | "CANVAS";

  // Metadata fields (same as track)
  snippetStart: string;
  snippetEnd: string;
  title: string;
  titleLocalized?: LocalizedField[];
  version: string;
  versionLocalized?: LocalizedField[];
  lyricsLanguage: string;
  explicitContent: "NONE" | "EXPLICIT" | "CLEAN";
  lyrics: string;
  primaryArtists: string[];
  featuringArtists: string[];
  remixer: string;
  composer: string;
  producer: string;
  contributors: {
    performers: Contributor[];
    studioPersonnel: Contributor[];
    labelPersonnel: Contributor[];
    compositional: Contributor[];
  };
  cLine: string;
  pLine: string;
  isrc: string;
  isrcAutoGenerate: boolean;
  ownership:
    | "ORIGINAL_MASTER"
    | "ACQUIRED"
    | "EXCLUSIVE_LICENSEE"
    | "NON_EXCLUSIVE_LICENSEE"
    | "NO_MASTER_RIGHTS";
  countryOfRecording: string;
  nationalityOfOwner: string;
}

interface AssetFormProps {
  asset?: AssetFormData | null;
  artists: Artist[];
  onSubmit: (data: AssetFormData) => Promise<void>;
  onCancel: () => void;
  onCreateArtist: (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }) => Promise<string>;
}

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

const formatToHHMMSS = (seconds: number) => {
  if (isNaN(seconds)) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const parseHHMMSSToSeconds = (timeStr?: string) => {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
};

export default function AssetForm({
  asset,
  artists,
  onSubmit,
  onCancel,
  onCreateArtist,
}: AssetFormProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<
    "PERFORMERS" | "STUDIO" | "LABEL" | "COMPOSITIONAL"
  >("PERFORMERS");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { uploadFile } = useUploadProgress();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<AssetFormData>(
    asset
      ? {
          ...asset,
          fileUrl: asset.fileUrl || "",
          fileName: asset.fileName || "",
          snippetStart: asset.snippetStart || "00:00:00",
          snippetEnd: (asset as any).snippetEnd || "00:00:30",
          title:
            typeof asset.title === "string"
              ? asset.title
              : Array.isArray(asset.title as any) &&
                  (asset.title as any).length > 0
                ? (asset.title as any)[0].value
                : "",
          titleLocalized: asset.titleLocalized || [],
          version:
            typeof asset.version === "string"
              ? asset.version
              : Array.isArray(asset.version as any) &&
                  (asset.version as any).length > 0
                ? (asset.version as any)[0].value
                : "",
          versionLocalized: asset.versionLocalized || [],
          lyricsLanguage: asset.lyricsLanguage || "",
          lyrics: asset.lyrics || "",
          primaryArtists: asset.primaryArtists || [],
          featuringArtists: asset.featuringArtists || [],
          remixer: asset.remixer || "",
          composer: asset.composer || "",
          producer: asset.producer || "",
          contributors: asset.contributors || {
            performers: [],
            studioPersonnel: [],
            labelPersonnel: [],
            compositional: [],
          },
          cLine: asset.cLine || "",
          pLine: asset.pLine || "",
          isrc: asset.isrc || "",
          countryOfRecording: asset.countryOfRecording || "",
          nationalityOfOwner: asset.nationalityOfOwner || "",
        }
      : {
          fileUrl: "",
          fileName: "",
          type: "AUDIO",
          snippetStart: "00:00:00",
          snippetEnd: "00:00:30",
          title: "",
          titleLocalized: [],
          version: "",
          versionLocalized: [],
          lyricsLanguage: "",
          explicitContent: "NONE",
          lyrics: "",
          primaryArtists: [],
          featuringArtists: [],
          remixer: "",
          composer: "",
          producer: "",
          contributors: {
            performers: [],
            studioPersonnel: [],
            labelPersonnel: [],
            compositional: [],
          },
          cLine: "",
          pLine: "",
          isrc: "",
          isrcAutoGenerate: false,
          ownership: "ORIGINAL_MASTER",
          countryOfRecording: "",
          nationalityOfOwner: "",
        },
  );

  const updateFormData = (updates: Partial<AssetFormData>) => {
    setFormData({ ...formData, ...updates });
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement> | File,
  ) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append("file", file);

      const type = file.type.startsWith("audio/") ? "audio" : "video";
      const enTitle =
        formData.title ||
        formData.titleLocalized?.find((t: any) => t.language === "en")?.value ||
        formData.titleLocalized?.[0]?.value;
      const titleContext = enTitle || file.name.replace(/\.[^/.]+$/, "");

      if (type === "audio") {
        formDataUpload.append("trackTitle", titleContext);
        if (formData.isrc) formDataUpload.append("isrc", formData.isrc);

        if (formData.primaryArtists && formData.primaryArtists.length > 0) {
          const primaryNames = formData.primaryArtists
            .map((id) => artists?.find((a: any) => a.id === id)?.name)
            .filter(Boolean)
            .join(", ");
          if (primaryNames) {
            formDataUpload.append("artistName", primaryNames);
          }
          formDataUpload.append("artistId", formData.primaryArtists[0]);
        }
      } else {
        formDataUpload.append("entityName", titleContext);
      }

      // Đánh dấu đây là file temp, đợi khi Submit form mới chuyển về thư mục chính thức
      formDataUpload.append("isTemp", "true");

      // Convert FormData to Record<string, string> for extraData
      const extraData: Record<string, string> = {};
      formDataUpload.forEach((value, key) => {
        if (key !== "file" && typeof value === "string") {
          extraData[key] = value;
        }
      });

      const uploadUrl = `/api/proxy_upload/${type}`;
      const data = await uploadFile(uploadUrl, file, file.name, extraData);

      updateFormData({
        fileUrl: data.url,
        fileName: data.storagePath || data.filename,
        type: type === "audio" ? "AUDIO" : "VIDEO",
        title:
          formData.title ||
          (formData.titleLocalized?.some((t: any) => t.value)
            ? formData.titleLocalized[0]?.value
            : file.name.replace(/\.[^/.]+$/, "")),
      });
      setUploading(false);
    } catch (error) {
      console.error("Upload error:", error);
      alert(error instanceof Error ? t(error.message, error.message) : t("error.uploadFailed", "Upload failed"));
      setUploading(false);
    }
  };

  const addContributor = (category: keyof AssetFormData["contributors"]) => {
    const newContributors = { ...formData.contributors };
    newContributors[category] = [
      ...newContributors[category],
      { name: "", role: "", artistId: "" },
    ];
    updateFormData({ contributors: newContributors });
  };

  const updateContributor = (
    category: keyof AssetFormData["contributors"],
    index: number,
    field: keyof Contributor,
    value: string,
  ) => {
    const newContributors = { ...formData.contributors };
    newContributors[category][index] = {
      ...newContributors[category][index],
      [field]: value,
    };
    updateFormData({ contributors: newContributors });
  };

  const deleteContributor = (
    category: keyof AssetFormData["contributors"],
    index: number,
  ) => {
    const newContributors = { ...formData.contributors };
    newContributors[category] = newContributors[category].filter(
      (_, i) => i !== index,
    );
    updateFormData({ contributors: newContributors });
  };

  const contributorRoles = {
    PERFORMERS: [
      "Vocalist",
      "Lead Vocals",
      "Background Vocals",
      "Rapper",
      "Instrumentalist",
      "Guitarist",
      "Bassist",
      "Drummer",
      "Pianist",
      "DJ",
    ],
    STUDIO: [
      "Recording Engineer",
      "Mixing Engineer",
      "Mastering Engineer",
      "Assistant Engineer",
      "Studio",
    ],
    LABEL: [
      "A&R",
      "Product Manager",
      "Marketing",
      "Artwork Design",
      "Photography",
    ],
    COMPOSITIONAL: [
      "Songwriter",
      "Composer",
      "Lyricist",
      "Arranger",
      "Publisher",
    ],
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: string[] = [];

    if (!formData.fileUrl)
      errors.push("Audio file is required - please upload a file first");
    const enTitle =
      formData.title ||
      formData.titleLocalized?.find((t: any) => t.language === "en")?.value ||
      formData.titleLocalized?.[0]?.value ||
      "";
    if (!enTitle.trim()) errors.push("Track Name is required");
    if (formData.primaryArtists.length === 0)
      errors.push("At least one Primary Artist is required");
    if (
      formData.isrc &&
      !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(formData.isrc.toUpperCase())
    ) {
      errors.push(
        "ISRC format invalid - must be 12 characters (e.g. USRC12345678)",
      );
    }

    if (errors.length > 0) {
      alert(errors.join("\n"));
      return;
    }

    let finalData = { ...formData };
    await onSubmit(finalData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File Upload */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
          {t("form.audioVideoFile", "Audio/Video File *")}
        </label>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${isDragging ? "bg-[var(--bg-surface-hover)] border-green-500" : "border-[var(--border-primary)]"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileUpload(file);
          }}
        >
          {!formData.fileUrl ? (
            <>
              <CloudUploadIcon size={48} color="#525252" className="mb-2" />
              <p className="text-[var(--text-tertiary)] mb-4">
                {uploading
                  ? "Processing..."
                  : "Click or drag to upload Video/Audio"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-transparent disabled:text-[var(--text-disabled)] text-white rounded transition-colors"
              >
                {uploading ? "Uploading..." : "Select File"}
              </button>
            </>
          ) : (
            <div className="w-full">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[var(--accent)] rounded-lg flex items-center justify-center text-white">
                    <CloudUploadIcon size={24} color="#fff" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">
                      {decodeURIComponent(formData.fileName?.split(/[\\/]/).pop() || "")}
                    </p>
                    <p className="text-sm text-[var(--text-disabled)]">
                      {formData.type}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    updateFormData({ fileUrl: "", fileName: "" });
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="px-3 py-1 text-sm text-[var(--status-error)] hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              </div>

              {formData.type === "CANVAS" ? (
                <div className="mt-4 bg-transparent rounded-lg p-2 max-w-sm mx-auto">
                  <CanvasPreview
                    videoUrl={formData.fileUrl || ""}
                  />
                </div>
              ) : formData.type === "VIDEO" ? (
                <div className="mt-4 bg-transparent rounded-lg p-2 max-w-3xl mx-auto">
                  <VideoPlayer
                    videoUrl={formData.fileUrl || ""}
                    enablePreviewRegion={true}
                    initialPreviewStart={parseHHMMSSToSeconds(formData.snippetStart)}
                    initialPreviewEnd={parseHHMMSSToSeconds(formData.snippetEnd)}
                    onPreviewRegionChange={(start, end) => {
                      updateFormData({
                        snippetStart: formatToHHMMSS(start),
                        snippetEnd: formatToHHMMSS(end),
                      });
                    }}
                  />
                </div>
              ) : formData.type === "AUDIO" && (
                <div className="mt-4 bg-transparent rounded-lg p-2">
                  <WaveformPlayer
                    audioUrl={formData.fileUrl || ""}
                    enablePreviewRegion={true}
                    initialPreviewStart={parseHHMMSSToSeconds(formData.snippetStart)}
                    initialPreviewEnd={parseHHMMSSToSeconds(formData.snippetEnd)}
                    onPreviewRegionChange={(start, end) => {
                      updateFormData({
                        snippetStart: formatToHHMMSS(start),
                        snippetEnd: formatToHHMMSS(end),
                      });
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview Range (Start + End) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.previewStartHHMMSS", "Preview Start (HH:MM:SS)")}
          </label>
          <input
            type="text"
            value={formData.snippetStart}
            onChange={(e) => updateFormData({ snippetStart: e.target.value })}
            placeholder={t("form.placeholder.000000", "00:00:00")}
            pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.previewEndHHMMSS", "Preview End (HH:MM:SS)")}
          </label>
          <input
            type="text"
            value={formData.snippetEnd}
            onChange={(e) => updateFormData({ snippetEnd: e.target.value })}
            placeholder={t("form.placeholder.000030", "00:00:30")}
            pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      {/* Track Name & Version */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.trackName", "Track Name *")}
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => updateFormData({ title: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={t("form.placeholder.trackTitle", "Track title")}
          />
          <div className="mt-4">
            <LocalizedInput
              label={t("trackForm.localizedTrackNames")}
              value={formData.titleLocalized || []}
              onChange={(val) => updateFormData({ titleLocalized: val })}
              placeholder={t("form.placeholder.eGJapaneseKorean", "e.g. Japanese, Korean")}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.version", "Version")}
          </label>
          <input
            type="text"
            value={formData.version}
            onChange={(e) => updateFormData({ version: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={t("form.placeholder.eGRadioEditExtendedMix", "e.g. Radio Edit, Extended Mix")}
          />
          <div className="mt-4">
            <LocalizedInput
              label={t("trackForm.localizedVersions")}
              value={formData.versionLocalized || []}
              onChange={(val) => updateFormData({ versionLocalized: val })}
              placeholder={t("form.placeholder.eGRadioEditJP", "e.g. Radio Edit (JP)")}
            />
          </div>
        </div>
      </div>

      {/* Lyrics Language & Explicit Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.lyricsLanguage", "Lyrics Language")}
          </label>
          <select
            value={formData.lyricsLanguage}
            onChange={(e) => updateFormData({ lyricsLanguage: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="">{t("trackForm.noLyricsInstrumental")}</option>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.explicitContent", "Explicit Content *")}
          </label>
          <div className="flex gap-4 pt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="explicit"
                value="NONE"
                checked={formData.explicitContent === "NONE"}
                onChange={() => updateFormData({ explicitContent: "NONE" })}
                className="w-4 h-4 text-[var(--accent)]"
              />
              <span className="text-sm">{t("common.none")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="explicit"
                value="EXPLICIT"
                checked={formData.explicitContent === "EXPLICIT"}
                onChange={() => updateFormData({ explicitContent: "EXPLICIT" })}
                className="w-4 h-4 text-[var(--accent)]"
              />
              <span className="text-sm">{t("trackForm.explicit")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="explicit"
                value="CLEAN"
                checked={formData.explicitContent === "CLEAN"}
                onChange={() => updateFormData({ explicitContent: "CLEAN" })}
                className="w-4 h-4 text-[var(--accent)]"
              />
              <span className="text-sm">{t("trackForm.clean")}</span>
            </label>
          </div>
        </div>
      </div>

      {/* Track Lyrics */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
          {t("form.trackLyrics", "Track Lyrics")}
        </label>
        <textarea
          value={formData.lyrics}
          onChange={(e) => updateFormData({ lyrics: e.target.value })}
          rows={6}
          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          placeholder={t("form.placeholder.enterFullLyricsHere", "Enter full lyrics here...")}
        />
      </div>

      {/* Primary Artists */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
          {t("form.primaryArtistS", "Primary Artist(s) *")}
        </label>
        <div className="space-y-2">
          {formData.primaryArtists.map((artistId, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableArtistSelect
                  value={artistId}
                  onChange={(newArtistId) => {
                    const newArtists = [...formData.primaryArtists];
                    newArtists[index] = newArtistId;
                    updateFormData({ primaryArtists: newArtists });
                  }}
                  artists={artists}
                  onCreateArtist={onCreateArtist}
                  placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const newArtists = formData.primaryArtists.filter(
                    (_, i) => i !== index,
                  );
                  updateFormData({ primaryArtists: newArtists });
                }}
                className="p-3 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded-lg text-[var(--status-error)] transition-colors"
              >
                <DeleteIcon size={20} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              updateFormData({
                primaryArtists: [...formData.primaryArtists, ""],
              })
            }
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
          >
            <AddIcon size={18} />
            Add Artist
          </button>
        </div>
      </div>

      {/* Featuring Artists */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
          {t("form.featuringArtistS", "Featuring Artist(s)")}
        </label>
        <div className="space-y-2">
          {formData.featuringArtists.map((artistId, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableArtistSelect
                  value={artistId}
                  onChange={(newArtistId) => {
                    const newArtists = [...formData.featuringArtists];
                    newArtists[index] = newArtistId;
                    updateFormData({ featuringArtists: newArtists });
                  }}
                  artists={artists}
                  onCreateArtist={onCreateArtist}
                  placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const newArtists = formData.featuringArtists.filter(
                    (_, i) => i !== index,
                  );
                  updateFormData({ featuringArtists: newArtists });
                }}
                className="p-3 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded-lg text-[var(--status-error)] transition-colors"
              >
                <DeleteIcon size={20} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              updateFormData({
                featuringArtists: [...formData.featuringArtists, ""],
              })
            }
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
          >
            <AddIcon size={18} />
            Add Featuring Artist
          </button>
        </div>
      </div>

      {/* Remixer, Composer, Producer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.remixer", "Remixer")}
          </label>
          <input
            type="text"
            value={formData.remixer}
            onChange={(e) => updateFormData({ remixer: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.composer", "Composer")}
          </label>
          <input
            type="text"
            value={formData.composer}
            onChange={(e) => updateFormData({ composer: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.producer", "Producer")}
          </label>
          <input
            type="text"
            value={formData.producer}
            onChange={(e) => updateFormData({ producer: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      {/* Contributors Tabs */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-3">
          {t("form.contributors", "Contributors")}
        </label>

        {/* Tab Headers */}
        <div className="flex gap-2 border-b border-[var(--border-primary)] mb-4">
          {(["PERFORMERS", "STUDIO", "LABEL", "COMPOSITIONAL"] as const).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "text-[var(--accent-text)] border-b-2 border-green-400"
                    : "text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {tab.charAt(0) + tab.slice(1).toLowerCase().replace("_", " ")}
              </button>
            ),
          )}
        </div>

        {/* Tab Content */}
        <div className="space-y-3">
          {activeTab === "PERFORMERS" &&
            formData.contributors.performers.map((contributor, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-[var(--bg-surface)] rounded-lg"
              >
                <input
                  type="text"
                  value={contributor.name}
                  onChange={(e) =>
                    updateContributor(
                      "performers",
                      index,
                      "name",
                      e.target.value,
                    )
                  }
                  placeholder={t("form.placeholder.name", "Name")}
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <select
                  value={contributor.role}
                  onChange={(e) =>
                    updateContributor(
                      "performers",
                      index,
                      "role",
                      e.target.value,
                    )
                  }
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("dashboard.selectRole")}</option>
                  {contributorRoles.PERFORMERS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => deleteContributor("performers", index)}
                  className="px-3 py-2 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded text-[var(--status-error)] text-sm transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}

          {activeTab === "STUDIO" &&
            formData.contributors.studioPersonnel.map((contributor, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-transparent rounded-lg"
              >
                <input
                  type="text"
                  value={contributor.name}
                  onChange={(e) =>
                    updateContributor(
                      "studioPersonnel",
                      index,
                      "name",
                      e.target.value,
                    )
                  }
                  placeholder={t("form.placeholder.name", "Name")}
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <select
                  value={contributor.role}
                  onChange={(e) =>
                    updateContributor(
                      "studioPersonnel",
                      index,
                      "role",
                      e.target.value,
                    )
                  }
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("dashboard.selectRole")}</option>
                  {contributorRoles.STUDIO.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => deleteContributor("studioPersonnel", index)}
                  className="px-3 py-2 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded text-[var(--status-error)] text-sm transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}

          {activeTab === "LABEL" &&
            formData.contributors.labelPersonnel.map((contributor, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-transparent rounded-lg"
              >
                <input
                  type="text"
                  value={contributor.name}
                  onChange={(e) =>
                    updateContributor(
                      "labelPersonnel",
                      index,
                      "name",
                      e.target.value,
                    )
                  }
                  placeholder={t("form.placeholder.name", "Name")}
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <select
                  value={contributor.role}
                  onChange={(e) =>
                    updateContributor(
                      "labelPersonnel",
                      index,
                      "role",
                      e.target.value,
                    )
                  }
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("dashboard.selectRole")}</option>
                  {contributorRoles.LABEL.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => deleteContributor("labelPersonnel", index)}
                  className="px-3 py-2 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded text-[var(--status-error)] text-sm transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}

          {activeTab === "COMPOSITIONAL" &&
            formData.contributors.compositional.map((contributor, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-transparent rounded-lg"
              >
                <input
                  type="text"
                  value={contributor.name}
                  onChange={(e) =>
                    updateContributor(
                      "compositional",
                      index,
                      "name",
                      e.target.value,
                    )
                  }
                  placeholder={t("form.placeholder.name", "Name")}
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <select
                  value={contributor.role}
                  onChange={(e) =>
                    updateContributor(
                      "compositional",
                      index,
                      "role",
                      e.target.value,
                    )
                  }
                  className="px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("dashboard.selectRole")}</option>
                  {contributorRoles.COMPOSITIONAL.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => deleteContributor("compositional", index)}
                  className="px-3 py-2 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded text-[var(--status-error)] text-sm transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}

          {/* Add Contributor Button */}
          <button
            type="button"
            onClick={() =>
              addContributor(
                activeTab === "PERFORMERS"
                  ? "performers"
                  : activeTab === "STUDIO"
                    ? "studioPersonnel"
                    : activeTab === "LABEL"
                      ? "labelPersonnel"
                      : "compositional",
              )
            }
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
          >
            <AddIcon size={18} />
            Add {activeTab.charAt(0) + activeTab.slice(1).toLowerCase()}{" "}
            Contributor
          </button>
        </div>
      </div>

      {/* C-Line & P-Line */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.Line", "© Line")}
          </label>
          <input
            type="text"
            value={formData.cLine || ""}
            onChange={(e) => updateFormData({ cLine: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={t("form.placeholder.2026CopyrightOwner", "2026 Copyright Owner")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.Line", "℗ Line")}
          </label>
          <input
            type="text"
            value={formData.pLine || ""}
            onChange={(e) => updateFormData({ pLine: e.target.value })}
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={t("form.placeholder.2026LabelName", "℗ 2026 Label Name")}
          />
        </div>
      </div>

      {/* ISRC */}
      {/* ISRC */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-[var(--text-tertiary)]">
            {t("form.iSRC", "ISRC")}
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isrcAutoGenerate}
              onChange={(e) =>
                updateFormData({
                  isrcAutoGenerate: e.target.checked,
                  isrc: e.target.checked ? "" : formData.isrc,
                })
              }
              className="w-4 h-4 text-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-tertiary)]">
              I don't have ISRC
            </span>
          </label>
        </div>
        <input
          type="text"
          value={formData.isrc || ""}
          onChange={(e) => updateFormData({ isrc: e.target.value })}
          disabled={formData.isrcAutoGenerate}
          placeholder={t("form.placeholder.eGISRC", "e.g. ISRC")}
          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Ownership */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
          {t("form.ownershipForThisSoundRecording", "Ownership for this sound recording *")}
        </label>
        <select
          value={formData.ownership}
          onChange={(e) =>
            updateFormData({
              ownership: e.target.value as AssetFormData["ownership"],
            })
          }
          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <option value="ORIGINAL_MASTER">
            I am the original master copyright owner
          </option>
          <option value="ACQUIRED">I acquired the master copyright</option>
          <option value="EXCLUSIVE_LICENSEE">
            I am the exclusive licensee (not the owner)
          </option>
          <option value="NON_EXCLUSIVE_LICENSEE">
            I am a non-exclusive licensee (not the owner)
          </option>
          <option value="NO_MASTER_RIGHTS">I have no master rights</option>
        </select>
      </div>

      {/* Country of Recording & Nationality */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.countryOfRecording", "Country of Recording")}
          </label>
          <select
            value={formData.countryOfRecording}
            onChange={(e) =>
              updateFormData({ countryOfRecording: e.target.value })
            }
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="">{t("trackForm.selectCountry")}</option>
            {COUNTRY_CODES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
            {t("form.nationalityOfOriginalCopyrightOwner", "Nationality of Original Copyright Owner")}
          </label>
          <select
            value={formData.nationalityOfOwner}
            onChange={(e) =>
              updateFormData({ nationalityOfOwner: e.target.value })
            }
            className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="">{t("trackForm.selectCountry")}</option>
            {COUNTRY_CODES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-primary)]">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-3 bg-transparent hover:bg-[var(--bg-elevated-hover)] text-[var(--text-primary)] rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={uploading || !formData.fileUrl}
          className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-disabled)] text-white rounded-lg font-medium transition-colors"
        >
          {asset ? t("trackForm.updateAsset") : "Create Asset"}
        </button>
      </div>
    </form>
  );
}
