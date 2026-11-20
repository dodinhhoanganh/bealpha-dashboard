"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import SearchableArtistSelect from "@/components/ui/SearchableArtistSelect";
import MediaUploadWithPreview from "@/components/media/MediaUploadWithPreview";
import WaveformPlayer from "@/components/media/WaveformPlayer";
import VideoPlayer from "@/components/media/VideoPlayer";
import CanvasPreview from "@/components/media/CanvasPreview";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { useUploadProgress } from "@/components/ui/UploadProgress";
import { LANGUAGES } from "@/lib/languages";
import { LocalizedInput, Localization } from "@/components/ui/LocalizedInput";
import { AddIcon, DeleteIcon, CloseIcon } from "@/components/ui/Icon";
import CanvasVisualizer from "@/components/media/CanvasVisualizer";
import PitchingForm from "@/components/releases/PitchingForm";


interface Artist {
  id: string;
  name: string;
  spotifyId?: string;
  appleMusicId?: string;
}

interface Asset {
  id: string;
  fileName: string;
  originalFileName?: string;
  duration?: number;
  type: string;
  fileUrl: string;
}

interface Contributor {
  name: string;
  role: string;
  artistId?: string;
}

interface TrackFormData {
  audioAssetId: string;
  duration?: number;
  snippetStart: string; // MM:SS:TT
  snippetEnd?: string; // MM:SS:TT
  title: string;
  titleLocalized?: Localization[];
  version: string;
  audioLanguage: string;
  lyricsLanguage: string;
  explicitContent: "NONE" | "EXPLICIT" | "CLEAN";
  lyrics: string;
  primaryArtists: string[];
  featuringArtists: string[];
  remixer: string;
  composer: string; // Legacy
  producer: string;
  iswc?: string;
  splits?: Array<{
    name: string;
    role: "Author" | "Composer" | "Arranger" | "Translator";
    ipi: string;
    share: string;
    publisherName: string;
    publisherIpi: string;
    publisherShare: string;
  }>;
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
  canEditIsrc?: boolean;
  ownership:
    | "ORIGINAL_MASTER"
    | "ACQUIRED"
    | "EXCLUSIVE_LICENSEE"
    | "NON_EXCLUSIVE_LICENSEE"
    | "NO_MASTER_RIGHTS";
  countryOfRecording: string;
  nationalityOfOwner: string;
  vevoNoSlatesOrTitleCards?: boolean;
  vevoNoLetterboxing?: boolean;
  
  // Multimedia & Marketing
  canvasAssetId?: string;
  motionAssetId?: string;
  pitchingNote?: string;
  pitchingSpotifyData?: any;
  pitchingAmazonData?: any;
  pitchingTidalData?: any;

  // Apple Digital Masters
  admAssetId?: string;
  masteringEngineerEmail?: string;
}

interface TrackFormProps {
  track: TrackFormData;
  trackNumber: number;
  assets: Asset[];
  artists: Artist[];
  releaseId?: string;
  releaseType?: "AUDIO" | "VIDEO";
  labelId?: string;
  releaseTitle?: string;
  releaseDate?: string;
  onUpdate: (track: TrackFormData) => void;
  onDelete: () => void;
  onCreateArtist: (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }) => Promise<string>;
  onAssetUploaded?: (
    assetId: string,
    filename: string,
    duration?: number,
  ) => void;
}

const formatToMMSSTT = (seconds: number) => {
  if (isNaN(seconds)) return "00:00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const tt = Math.round((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${tt.toString().padStart(2, "0")}`;
};

const parseMMSSTTToSeconds = (timeStr?: string) => {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 100;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
};

export default function TrackForm({
  track,
  trackNumber,
  assets,
  artists,
  releaseId,
  releaseType = "AUDIO",
  labelId,
  releaseTitle,
  releaseDate,
  onUpdate,
  onDelete,
  onCreateArtist,
  onAssetUploaded,
}: TrackFormProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const { uploadMedia } = useUploadProgress();
  const [activeTab, setActiveTab] = useState<
    "PERFORMERS" | "STUDIO" | "LABEL" | "COMPOSITIONAL"
  >("PERFORMERS");
  const [activeMainTab, setActiveMainTab] = useState<"GENERAL" | "VISUALS" | "PITCHING">("GENERAL");
  const [admEnabled, setAdmEnabled] = useState(!!track.admAssetId);
  const [admFileInfo, setAdmFileInfo] = useState<{ bitDepth?: number; sampleRate?: number; codec?: string; duration?: number } | null>(null);
  const [uploadMode, setUploadMode] = useState<"UPLOAD" | "LIBRARY">("UPLOAD");
  const [canvasUploadMode, setCanvasUploadMode] = useState<"UPLOAD" | "LIBRARY">("UPLOAD");
  const [motionUploadMode, setMotionUploadMode] = useState<"UPLOAD" | "LIBRARY">("UPLOAD");

  const updateTrack = (updates: Partial<TrackFormData>) => {
    onUpdate({ ...track, ...updates });
  };

  const addContributor = (category: keyof TrackFormData["contributors"]) => {
    const newContributors = { ...track.contributors };
    newContributors[category] = [
      ...newContributors[category],
      { name: "", role: "", artistId: "" },
    ];
    updateTrack({ contributors: newContributors });
  };

  const updateContributor = (
    category: keyof TrackFormData["contributors"],
    index: number,
    field: keyof Contributor,
    value: string,
  ) => {
    const newContributors = { ...track.contributors };
    newContributors[category][index] = {
      ...newContributors[category][index],
      [field]: value,
    };
    updateTrack({ contributors: newContributors });
  };

  const deleteContributor = (
    category: keyof TrackFormData["contributors"],
    index: number,
  ) => {
    const newContributors = { ...track.contributors };
    newContributors[category] = newContributors[category].filter(
      (_, i) => i !== index,
    );
    updateTrack({ contributors: newContributors });
  };

  const contributorRoles = {
    PERFORMERS: [
      "Vocalist",
      "Lead Vocals",
      "Background Vocals",
      "Choir",
      "Rapper",
      "Beatbox",
      "Instrumentalist",
      "Acoustic Guitar",
      "Electric Guitar",
      "Lead Guitar",
      "Rhythm Guitar",
      "Bass Guitar",
      "Bassist",
      "Drummer",
      "Percussion",
      "Pianist",
      "Keyboard",
      "Synthesizer",
      "Organ",
      "Strings",
      "Violin",
      "Cello",
      "Viola",
      "Harp",
      "Flute",
      "Saxophone",
      "Trumpet",
      "Trombone",
      "Harmonica",
      "Turntables",
      "DJ",
      "Orchestra",
      "Conductor",
      "Choir Director",
      "Frontperson",
    ],
    STUDIO: [
      "Producer",
      "Executive Producer",
      "Co-Producer",
      "Recording Engineer",
      "Mixing Engineer",
      "Mastering Engineer",
      "Immersive Audio Engineer",
      "Assistant Engineer",
      "Sound Designer",
      "Vocal Producer",
      "Programming",
      "Studio",
      "Director",
      "Music Director",
      "A&R",
    ],
    LABEL: [
      "A&R",
      "Product Manager",
      "Marketing",
      "Artwork Design",
      "Photography",
      "Creative Director",
      "Video Director",
      "Choreographer",
    ],
    COMPOSITIONAL: [
      "Songwriter",
      "Composer",
      "Lyricist",
      "Arranger",
      "Translator",
      "Adapter",
      "Publisher",
    ],
  };

  // Track validation warnings (inline)
  const trackWarnings: string[] = [];
  if (!track.title.trim()) trackWarnings.push(t("trackForm.warnTitle", "Title"));
  if (!track.audioAssetId) trackWarnings.push(releaseType === "VIDEO" ? t("trackForm.warnVideoFile", "Video file") : t("trackForm.warnAudioFile", "Audio file"));
  if (track.primaryArtists.length === 0) trackWarnings.push(t("trackForm.warnPrimaryArtist", "Primary Artist"));
  if (!track.isrc && !track.isrcAutoGenerate) trackWarnings.push("ISRC");

  return (
    <div
      className={`border rounded-lg overflow-hidden ${trackWarnings.length > 0 ? "border-amber-500/50" : "border-[var(--border-primary)]"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-[var(--bg-surface)] border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-medium text-[var(--text-tertiary)]">
            {trackNumber}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{track.title || t("trackForm.untitledTrack")}</p>
              {track.admAssetId && (
                <span
                  className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white select-none"
                  style={{ background: 'linear-gradient(135deg, #fb1e5d 0%, #fc6076 50%, #ff9a44 100%)' }}
                  title={t("adm.badgeTooltip")}
                >
                  {t("adm.badge")}
                </span>
              )}
            </div>
            {track.version && (
              <p className="text-sm text-[var(--text-disabled)]">
                {track.version}
              </p>
            )}
            {trackWarnings.length > 0 && (
              <p className="text-xs text-[var(--status-warning)] mt-0.5">
                {t("trackForm.missing")}: {trackWarnings.join(", ")}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="px-3 py-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {expanded ? t("common.collapse") : t("trackForm.expand")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-2 hover:bg-[var(--status-error)]/20 rounded-lg text-[var(--status-error)] transition-colors"
          >
            <DeleteIcon size={20} />
          </button>
        </div>
      </div>

      {/* Form Content */}
      {expanded && (
        <div className="p-6 space-y-6">
          
          {/* Main Content Tabs */}
          <div className="flex space-x-2 border-b border-zinc-800 pb-2 mb-6">
            <button
              onClick={() => setActiveMainTab("GENERAL")}
              className={`px-4 py-2 rounded-md text-sm transition-colors ${
                activeMainTab === "GENERAL" ? "bg-zinc-800 text-white font-medium" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t("trackForm.generalInfoAudio")}
            </button>
            {releaseType === "AUDIO" && (
              <>
                <button
                  onClick={() => setActiveMainTab("VISUALS")}
                  className={`px-4 py-2 rounded-md text-sm transition-colors ${
                    activeMainTab === "VISUALS" ? "bg-zinc-800 text-white font-medium" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {t("trackForm.visualsCanvas")}
                </button>
                <button
                  onClick={() => setActiveMainTab("PITCHING")}
                  className={`px-4 py-2 rounded-md text-sm transition-colors ${
                    activeMainTab === "PITCHING" ? "bg-zinc-800 text-white font-medium" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {t("trackForm.pitchingMarketing")}
                </button>
              </>
            )}
          </div>

          {activeMainTab === "GENERAL" && (
            <div className="space-y-6">
              {/* Audio File Upload & Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="mb-4">
                <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                  {t("form.audioAsset", "Audio Asset *")}
                </label>
                <div className="relative">
                  <select
                    value={
                      uploadMode === "UPLOAD" ? "NEW" : track.audioAssetId || ""
                    }
                    onChange={(e) => {
                      if (e.target.value === "NEW") {
                        setUploadMode("UPLOAD");
                        updateTrack({ audioAssetId: "" });
                      } else {
                        setUploadMode("LIBRARY");
                        const selectedAsset = assets.find(
                          (a) => a.id === e.target.value,
                        );
                        if (selectedAsset) {
                          updateTrack({
                            audioAssetId: selectedAsset.id,
                            duration: selectedAsset.duration,
                            title: selectedAsset.fileName.replace(
                              /\.[^/.]+$/,
                              "",
                            ),
                          });
                        }
                      }
                    }}
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] appearance-none"
                  >
                    <option value="" disabled>
                      {t("trackForm.selectAsset")}
                    </option>
                    <option value="NEW">{t("trackForm.createNewAsset")}</option>
                    <optgroup label={t("assets.libraryAssets")}>
                      {assets
                        .filter((a) => a.type === "AUDIO")
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {decodeURIComponent(asset.fileName?.split(/[\\/]/).pop() || "")} (
                            {asset.duration
                              ? `${Math.floor(asset.duration / 60)}:${(asset.duration % 60).toString().padStart(2, "0")}`
                              : "?"}
                            )
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-[var(--text-tertiary)]">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              {uploadMode === "UPLOAD" ? (
                <MediaUploadWithPreview
                  type={releaseType}
                  currentMediaUrl={
                    track.audioAssetId
                      ? assets.find((a) => a.id === track.audioAssetId)?.fileUrl
                      : undefined
                  }
                  currentFilename={
                    track.audioAssetId
                      ? assets.find((a) => a.id === track.audioAssetId)
                          ?.fileName
                      : undefined
                  }
                  label={t("assets.uploadAudioFile")}
                  onUpload={async (file, onProgress) => {
                    const extraData: Record<string, string> = {};
                    extraData["isTemp"] = "true";
                    if (releaseId) extraData["releaseId"] = releaseId;
                    if (labelId) extraData["labelId"] = labelId;
                    if (releaseTitle) extraData["releaseTitle"] = releaseTitle;
                    if (track.isrc) extraData["isrc"] = track.isrc;
                    // Snippet preview start time (convert MM:SS:TT to seconds)
                    if (track.snippetStart) {
                      const parts = track.snippetStart.split(":").map(Number);
                      let startSec = 0;
                      if (parts.length === 3) startSec = parts[0] * 60 + parts[1] + parts[2] / 100;
                      else if (parts.length === 2) startSec = parts[0] * 60 + parts[1];
                      else if (parts.length === 1) startSec = parts[0];
                      if (!isNaN(startSec) && startSec > 0) {
                        extraData["snippetStart"] = String(startSec);
                      }
                    }
                    // Semantic folder context
                    if (track.title) extraData["trackTitle"] = track.title;
                    if (
                      track.primaryArtists &&
                      track.primaryArtists.length > 0
                    ) {
                      const primaryNames = track.primaryArtists
                        .map(
                          (id) => artists?.find((a: any) => a.id === id)?.name,
                        )
                        .filter(Boolean)
                        .join(", ");
                      if (primaryNames) {
                        extraData["artistName"] = primaryNames;
                      }
                      // Keep the first artistId for backward compatibility if needed by server
                      extraData["artistId"] = track.primaryArtists[0];
                    }

                    const responseData = await uploadMedia(
                      "AUDIO",
                      file,
                      file.name,
                      extraData,
                      onProgress,
                    );

                    const assetId = String(responseData.assetId);

                    // Update track with new asset ID and Filename as title
                    updateTrack({
                      audioAssetId: assetId,
                      duration: responseData.duration,
                      title:
                        track.title ||
                        responseData.originalName?.replace(/\.[^/.]+$/, "") ||
                        responseData.filename?.replace(/\.[^/.]+$/, ""),
                    });

                    // Switch back to Library mode with the new asset selected
                    setUploadMode("LIBRARY");

                    // Notify parent about new asset
                    if (onAssetUploaded) {
                      onAssetUploaded(assetId, responseData.filename, responseData.duration);
                    }

                    return null;
                  }}
                  onDelete={() => updateTrack({ audioAssetId: "", duration: undefined })}
                  //! IDM Bypass: Pass a transform function or prop?
                  // Actually MediaUploadWithPreview handles its own display, but for Library mode `TrackForm` does it.
                  // We need to pass the stream URL to WaveformPlayer below.
                />
              ) : (
                <>
                  {/* Preview Player for Library Mode */}
                  {track.audioAssetId && (
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg p-4 mb-6">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-[var(--status-success-surface)] flex items-center justify-center text-[var(--accent)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium text-sm text-[var(--text-primary)]">
                            {decodeURIComponent(
                              assets.find((a) => a.id === track.audioAssetId)
                                ?.fileName?.split(/[\\/]/).pop() || ""
                            )}
                          </p>
                          <p className="text-xs text-[var(--text-disabled)]">
                            {t("assets.duration")}:{" "}
                            {assets.find((a) => a.id === track.audioAssetId)
                              ?.duration
                              ? `${Math.floor(assets.find((a) => a.id === track.audioAssetId)!.duration! / 60)}:${(assets.find((a) => a.id === track.audioAssetId)!.duration! % 60).toString().padStart(2, "0")}`
                              : t("common.unknown", "Unknown")}
                          </p>
                        </div>
                      </div>
                      {assets.find((a) => a.id === track.audioAssetId)?.type === "CANVAS" ? (
                        <div className="mt-4 bg-transparent rounded-lg p-2 max-w-sm mx-auto">
                          <CanvasPreview
                            videoUrl={(() => {
                              const asset = assets.find((a) => a.id === track.audioAssetId);
                              return asset?.fileUrl || "";
                            })()}
                          />
                        </div>
                      ) : assets.find((a) => a.id === track.audioAssetId)?.type === "VIDEO" ? (
                        <div className="mt-4 bg-transparent rounded-lg p-2 max-w-3xl mx-auto">
                          <VideoPlayer
                            videoUrl={(() => {
                              const asset = assets.find((a) => a.id === track.audioAssetId);
                              return asset?.fileUrl || "";
                            })()}
                            enablePreviewRegion={true}
                            initialPreviewStart={parseMMSSTTToSeconds(track.snippetStart)}
                            initialPreviewEnd={parseMMSSTTToSeconds(track.snippetEnd)}
                            onPreviewRegionChange={(start, end) => {
                              onUpdate({
                                ...track,
                                snippetStart: formatToMMSSTT(start),
                                snippetEnd: formatToMMSSTT(end),
                              });
                            }}
                          />
                        </div>
                      ) : (
                        <WaveformPlayer
                          audioUrl={(() => {
                            const asset = assets.find(
                              (a) => a.id === track.audioAssetId,
                            );
                            return asset?.fileUrl || "";
                          })()}
                          enablePreviewRegion={true}
                          initialPreviewStart={parseMMSSTTToSeconds(track.snippetStart)}
                          initialPreviewEnd={parseMMSSTTToSeconds(track.snippetEnd)}
                          onPreviewRegionChange={(start, end) => {
                            onUpdate({
                              ...track,
                              snippetStart: formatToMMSSTT(start),
                              snippetEnd: formatToMMSSTT(end),
                            });
                          }}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.previewTimeMMSSTT", "Preview Time (MM:SS:TT)")}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-[var(--text-disabled)] mb-1 block">
                    {t("trackForm.startPoint")}
                  </span>
                  <input
                    type="text"
                    value={track.snippetStart || ""}
                    onChange={(e) =>
                      updateTrack({ snippetStart: e.target.value })
                    }
                    placeholder="00:00:00"
                    pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <span className="text-xs text-[var(--text-disabled)] mb-1 block">
                    {t("trackForm.endPoint")}{" "}
                    <span className="font-normal opacity-70">{t("common.optional")}</span>
                  </span>
                  <input
                    type="text"
                    value={track.snippetEnd || ""}
                    onChange={(e) =>
                      updateTrack({ snippetEnd: e.target.value })
                    }
                    placeholder="00:30:00"
                    pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--text-disabled)] mt-2">
                {t("trackForm.snippetHint")}
              </p>
            </div>
          </div>

          {/* Track Name & Version */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-[var(--text-tertiary)]">
                  {t("form.trackName", "Track Name *")}
                </label>
              </div>
              <input
                type="text"
                value={track.title}
                onChange={(e) => updateTrack({ title: e.target.value })}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder={t("form.placeholder.trackTitle", "Track title")}
              />
              <div className="mt-4">
                <LocalizedInput
                  label={t("trackForm.localizedTrackNames")}
                  value={track.titleLocalized || []}
                  onChange={(val) => updateTrack({ titleLocalized: val })}
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
                value={track.version}
                onChange={(e) => updateTrack({ version: e.target.value })}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder={t("form.placeholder.eGRadioEditRemixAcoustic", "e.g., Radio Edit, Remix, Acoustic")}
              />
            </div>
          </div>

          {/* Lyrics Language, Audio Language & Explicit Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {releaseType === "AUDIO" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.vocalsLanguage", "Vocals Language")}
                  </label>
                  <select
                    value={track.audioLanguage || ""}
                    onChange={(e) => updateTrack({ audioLanguage: e.target.value })}
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="">{t("trackForm.instrumental")}</option>
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.lyricsLanguage", "Lyrics Language")}
                  </label>
                  <select
                    value={track.lyricsLanguage || ""}
                    onChange={(e) =>
                      updateTrack({ lyricsLanguage: e.target.value })
                    }
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
              </>
            ) : (
              <div className="hidden"></div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.explicitContent", "Explicit Content *")}
              </label>
              <div className="flex gap-4 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`explicit-${trackNumber}`}
                    value="NONE"
                    checked={track.explicitContent === "NONE"}
                    onChange={() => updateTrack({ explicitContent: "NONE" })}
                    className="w-4 h-4 text-[var(--accent)]"
                  />
                  <span className="text-sm">{t("common.none")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`explicit-${trackNumber}`}
                    value="EXPLICIT"
                    checked={track.explicitContent === "EXPLICIT"}
                    onChange={() =>
                      updateTrack({ explicitContent: "EXPLICIT" })
                    }
                    className="w-4 h-4 text-[var(--accent)]"
                  />
                  <span className="text-sm">{t("trackForm.explicit")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`explicit-${trackNumber}`}
                    value="CLEAN"
                    checked={track.explicitContent === "CLEAN"}
                    onChange={() => updateTrack({ explicitContent: "CLEAN" })}
                    className="w-4 h-4 text-[var(--accent)]"
                  />
                  <span className="text-sm">{t("trackForm.clean")}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Track Lyrics */}
          {releaseType === "AUDIO" && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.trackLyrics", "Track Lyrics")}
              </label>
              <textarea
                value={track.lyrics}
                onChange={(e) => updateTrack({ lyrics: e.target.value })}
                rows={6}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                placeholder={t("form.placeholder.enterFullLyricsHere", "Enter full lyrics here...")}
              />
            </div>
          )}

          {/* Primary Artists */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
              {t("form.primaryArtistS", "Primary Artist(s) *")}
            </label>
            <div className="space-y-2">
              {track.primaryArtists.map((artistId, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1">
                    <SearchableArtistSelect
                      value={artistId}
                      onChange={(newArtistId) => {
                        const newArtists = [...track.primaryArtists];
                        newArtists[index] = newArtistId;
                        updateTrack({ primaryArtists: newArtists });
                      }}
                      artists={artists}
                      onCreateArtist={onCreateArtist}
                      placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newArtists = track.primaryArtists.filter(
                        (_, i) => i !== index,
                      );
                      updateTrack({ primaryArtists: newArtists });
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
                  updateTrack({ primaryArtists: [...track.primaryArtists, ""] })
                }
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
              >
                <AddIcon size={18} />
                {t("form.addArtist", "Add Artist")}
              </button>
            </div>
          </div>

          {/* Featuring Artists */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
              {t("form.featuringArtistS", "Featuring Artist(s)")}
            </label>
            <div className="space-y-2">
              {track.featuringArtists.map((artistId, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1">
                    <SearchableArtistSelect
                      value={artistId}
                      onChange={(newArtistId) => {
                        const newArtists = [...track.featuringArtists];
                        newArtists[index] = newArtistId;
                        updateTrack({ featuringArtists: newArtists });
                      }}
                      artists={artists}
                      onCreateArtist={onCreateArtist}
                      placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newArtists = track.featuringArtists.filter(
                        (_, i) => i !== index,
                      );
                      updateTrack({ featuringArtists: newArtists });
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
                  updateTrack({
                    featuringArtists: [...track.featuringArtists, ""],
                  })
                }
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
              >
                <AddIcon size={18} />
                {t("form.addFeaturingArtist", "Add Featuring Artist")}
              </button>
            </div>
          </div>

          {/* Remixer & Producer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.remixer", "Remixer")}
              </label>
              <input
                type="text"
                value={track.remixer}
                onChange={(e) => updateTrack({ remixer: e.target.value })}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.producer", "Producer")}
              </label>
              <input
                type="text"
                value={track.producer}
                onChange={(e) => updateTrack({ producer: e.target.value })}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>

          {/* Rights & Shares */}
          <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden bg-[var(--bg-surface)] mt-4">
            <div className="p-4 border-b border-[var(--border-primary)] bg-[var(--bg-surface-secondary)] flex justify-between items-center">
              <div>
                <h4 className="text-sm font-medium text-[var(--text-primary)]">
                  {t("form.rightsAndShares", "Rights & Shares (Splits)")}
                </h4>
                <p className="text-xs text-[var(--text-disabled)] mt-1">
                  {t("form.totalSharesMustEqual100", "Total Writer + Publisher shares must equal 100%")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateTrack({
                    splits: [
                      ...(track.splits || []),
                      {
                        name: "",
                        role: "Composer",
                        ipi: "",
                        share: "",
                        publisherName: "",
                        publisherIpi: "",
                        publisherShare: "",
                      },
                    ],
                  })
                }
                className="px-3 py-1.5 bg-[var(--accent)] text-[var(--accent-text)] text-xs font-medium rounded hover:opacity-90"
              >
                + {t("form.addSplit", "Add Split")}
              </button>
            </div>
            <div className="p-4 space-y-4">
              {(track.splits || []).map((split, i) => (
                <div
                  key={i}
                  className="p-4 border border-[var(--border-input)] rounded-lg relative gap-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateTrack({
                        splits: track.splits!.filter((_, idx) => idx !== i),
                      })
                    }
                    className="absolute top-2 right-2 text-[var(--text-disabled)] hover:text-red-500"
                  ></button>

                  {/* Writer Section */}
                  <div className="space-y-3 col-span-1 md:col-span-2 lg:col-span-1">
                    <h5 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      {t("form.writer", "Writer")}
                    </h5>
                    <div>
                      <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                        {t("form.name", "Name *")}
                      </label>
                      <input
                        type="text"
                        value={split.name}
                        onChange={(e) => {
                          const newSplits = [...track.splits!];
                          newSplits[i].name = e.target.value;
                          updateTrack({ splits: newSplits });
                        }}
                        className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                        placeholder={t("form.placeholder.writerName", "Writer name")}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                          {t("form.role", "Role *")}
                        </label>
                        <select
                          value={split.role}
                          onChange={(e) => {
                            const newSplits = [...track.splits!];
                            newSplits[i].role = e.target.value as any;
                            updateTrack({ splits: newSplits });
                          }}
                          className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                        >
                          <option value="Composer">{t("role.composer", "Composer (Music)")}</option>
                          <option value="Author">{t("role.author", "Author (Lyrics)")}</option>
                          <option value="Arranger">{t("role.arranger", "Arranger")}</option>
                          <option value="Translator">{t("roles.translator")}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                          {t("form.iPIOptional", "IPI (Optional)")}
                        </label>
                        <input
                          type="text"
                          value={split.ipi}
                          onChange={(e) => {
                            const newSplits = [...track.splits!];
                            newSplits[i].ipi = e.target.value;
                            updateTrack({ splits: newSplits });
                          }}
                          className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                          placeholder={t("form.placeholder.eG123456789", "e.g. 123456789")}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                        {t("form.writerShare", "Writer Share % *")}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={split.share}
                        onChange={(e) => {
                          const newSplits = [...track.splits!];
                          newSplits[i].share = e.target.value;
                          updateTrack({ splits: newSplits });
                        }}
                        className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                        placeholder={t("form.placeholder.eG50", "e.g. 50")}
                      />
                    </div>
                  </div>

                  {/* Publisher Section */}
                  <div className="space-y-3 col-span-1 md:col-span-2 lg:col-span-2 border-t lg:border-t-0 lg:border-l border-[var(--border-input)] pt-4 lg:pt-0 lg:pl-4">
                    <h5 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      {t("form.publisherOptional", "Publisher (Optional)")}
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                          {t("form.publisherName", "Publisher Name")}
                        </label>
                        <input
                          type="text"
                          value={split.publisherName}
                          onChange={(e) => {
                            const newSplits = [...track.splits!];
                            newSplits[i].publisherName = e.target.value;
                            updateTrack({ splits: newSplits });
                          }}
                          className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                          placeholder={t("form.placeholder.publisherName", "Publisher name")}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                          {t("form.iPIOptional", "IPI (Optional)")}
                        </label>
                        <input
                          type="text"
                          value={split.publisherIpi}
                          onChange={(e) => {
                            const newSplits = [...track.splits!];
                            newSplits[i].publisherIpi = e.target.value;
                            updateTrack({ splits: newSplits });
                          }}
                          className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                          placeholder={t("form.placeholder.eG987654321", "e.g. 987654321")}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                        {t("form.publisherShare", "Publisher Share %")}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={split.publisherShare}
                        onChange={(e) => {
                          const newSplits = [...track.splits!];
                          newSplits[i].publisherShare = e.target.value;
                          updateTrack({ splits: newSplits });
                        }}
                        className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-sm focus:border-[var(--accent)] outline-none"
                        placeholder={t("form.placeholder.eG50", "e.g. 50")}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {(!track.splits || track.splits.length === 0) && (
                <div className="text-center py-6 border border-dashed border-[var(--border-input)] rounded-lg">
                  <p className="text-sm text-[var(--text-tertiary)] mb-2">
                    {t("form.noRightsAdded", "No rights & shares added.")}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      updateTrack({
                        splits: [
                          {
                            name: "",
                            role: "Composer",
                            ipi: "",
                            share: "",
                            publisherName: "",
                            publisherIpi: "",
                            publisherShare: "",
                          },
                        ],
                      })
                    }
                    className="text-sm text-[var(--accent)] hover:underline"
                  >
                    {t("form.addFirstSplit", "Add first split")}
                  </button>
                </div>
              )}
              {/* Validation Warning */}
              {(track.splits || []).length > 0 &&
                (() => {
                  const total = (track.splits || []).reduce(
                    (acc, s) =>
                      acc +
                      (parseFloat(s.share) || 0) +
                      (parseFloat(s.publisherShare) || 0),
                    0,
                  );
                  if (Math.abs(total - 100) > 0.01) {
                    return (
                      <p className="text-sm text-red-500 mt-2">
                        {t(
                          "form.totalShareValidation",
                          { percentage: total.toFixed(2) },
                          `Total share is ${total.toFixed(2)}% (must be exactly 100%)`,
                        )}
                      </p>
                    );
                  }
                  return null;
                })()}
            </div>
          </div>

          {/* Contributors Tabs */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-3">
              {t("form.contributors", "Contributors")}
            </label>

            {/* Tab Headers */}
            <div className="flex gap-2 border-b border-[var(--border-primary)] mb-4">
              {(
                ["PERFORMERS", "STUDIO", "LABEL", "COMPOSITIONAL"] as const
              ).map((tab) => (
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
              ))}
            </div>

            {/* Tab Content */}
            <div className="space-y-3">
              {activeTab === "PERFORMERS" &&
                track.contributors.performers.map((contributor, index) => (
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
                      {t("common.remove", "Remove")}
                    </button>
                  </div>
                ))}

              {activeTab === "STUDIO" &&
                track.contributors.studioPersonnel.map((contributor, index) => (
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
                      onClick={() =>
                        deleteContributor("studioPersonnel", index)
                      }
                      className="px-3 py-2 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded text-[var(--status-error)] text-sm transition-colors"
                    >
                      {t("common.remove", "Remove")}
                    </button>
                  </div>
                ))}

              {activeTab === "LABEL" &&
                track.contributors.labelPersonnel.map((contributor, index) => (
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
                      {t("common.remove", "Remove")}
                    </button>
                  </div>
                ))}

              {activeTab === "COMPOSITIONAL" &&
                track.contributors.compositional.map((contributor, index) => (
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
                      {t("common.remove", "Remove")}
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
                {t("form.addContributor", "Add Contributor")}
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
                value={track.cLine}
                onChange={(e) => updateTrack({ cLine: e.target.value })}
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
                value={track.pLine}
                onChange={(e) => updateTrack({ pLine: e.target.value })}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder={t("form.placeholder.2026LabelName", "℗ 2026 Label Name")}
              />
            </div>
          </div>

          {/* ISRC & ISWC */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-[var(--text-tertiary)]">
                  {t("form.iSRC", "ISRC")}
                </label>
                <label className={`flex items-center gap-2 ${track.canEditIsrc === false ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={track.isrcAutoGenerate}
                    onChange={(e) =>
                      updateTrack({
                        isrcAutoGenerate: e.target.checked,
                        isrc: e.target.checked ? "" : track.isrc,
                      })
                    }
                    disabled={track.canEditIsrc === false}
                    className="w-4 h-4 text-[var(--accent)] disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-[var(--text-tertiary)]">
                    {t("form.iDontHaveISRC", "I don't have ISRC")}
                  </span>
                </label>
              </div>
              <input
                type="text"
                value={track.isrc}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                  updateTrack({ isrc: val });
                }}
                disabled={track.isrcAutoGenerate || track.canEditIsrc === false}
                placeholder={t("form.placeholder.eGISRC", "e.g. ISRC")}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {track.canEditIsrc === false && (
                <p className="text-xs text-[var(--text-disabled)] mt-2">
                  {t("form.isrcLockedAfterSubmission", "ISRC is locked once the release has been submitted. Contact your distributor to make changes.")}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                ISWC{" "}
                <span className="text-[var(--text-disabled)] font-normal text-xs">
                  {t("ui.trackForm.optional", "(Optional)")}
                </span>
              </label>
              <input
                type="text"
                value={track.iswc || ""}
                onChange={(e) => updateTrack({ iswc: e.target.value })}
                placeholder={t("form.placeholder.eGT1234567890", "e.g. T-123456789-0")}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>

          {/* Ownership */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
              {t("form.ownershipForThisSoundRecording", "Ownership for this sound recording *")}
            </label>
            <select
              value={track.ownership}
              onChange={(e) =>
                updateTrack({
                  ownership: e.target.value as TrackFormData["ownership"],
                })
              }
              className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="ORIGINAL_MASTER">
                {t("form.ownershipOriginal", "I am the original master copyright owner")}
              </option>
              <option value="ACQUIRED">{t("form.ownershipAcquired", "I acquired the master copyright")}</option>
              <option value="EXCLUSIVE_LICENSEE">
                {t("form.ownershipExclusive", "I am the exclusive licensee (not the owner)")}
              </option>
              <option value="NON_EXCLUSIVE_LICENSEE">
                {t("form.ownershipNonExclusive", "I am a non-exclusive licensee (not the owner)")}
              </option>
              <option value="NO_MASTER_RIGHTS">{t("form.ownershipNoRights", "I have no master rights")}</option>
            </select>
          </div>

          {/* Country of Recording & Nationality */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.countryOfRecording", "Country of Recording")}
              </label>
              <select
                value={track.countryOfRecording}
                onChange={(e) =>
                  updateTrack({ countryOfRecording: e.target.value })
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
                value={track.nationalityOfOwner}
                onChange={(e) =>
                  updateTrack({ nationalityOfOwner: e.target.value })
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
          </div>
          )}

          {/* APPLE DIGITAL MASTERS SECTION — inside GENERAL tab, after main content */}
          {activeMainTab === "GENERAL" && releaseType === "AUDIO" && (
            <div className="mt-8 border border-zinc-700/60 rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(251,30,93,0.04) 0%, rgba(30,30,30,0) 50%)' }}>
              {/* ADM Header Toggle */}
              <button
                type="button"
                onClick={() => {
                  const next = !admEnabled;
                  setAdmEnabled(next);
                  if (!next) {
                    updateTrack({ admAssetId: "", masteringEngineerEmail: "" });
                    setAdmFileInfo(null);
                  }
                }}
                className="w-full flex items-center justify-between px-6 py-4 group hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {/* Apple-style gradient badge */}
                  <span
                    className="inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-bold tracking-wide text-white select-none"
                    style={{ background: 'linear-gradient(135deg, #fb1e5d 0%, #fc6076 50%, #ff9a44 100%)' }}
                  >
                    {t("adm.badge")}
                  </span>
                  <span className="text-sm font-medium text-white">{t("adm.title")}</span>
                </div>
                {/* Material toggle switch */}
                <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                  admEnabled ? 'bg-gradient-to-r from-[#fb1e5d] to-[#ff9a44]' : 'bg-zinc-700'
                }`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
                    admEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`} />
                </div>
              </button>

              {/* ADM Expanded Content */}
              {admEnabled && (
                <div className="px-6 pb-6 space-y-5">
                  {/* Description & Requirements */}
                  <div className="flex items-start gap-3 p-4 bg-zinc-800/40 border border-zinc-700/50 rounded-lg">
                    <span className="material-symbols-outlined text-[#ff9a44] text-xl mt-0.5" style={{fontVariationSettings: "'FILL' 1, 'wght' 400"}}>verified</span>
                    <div>
                      <p className="text-sm text-zinc-300 mb-2">{t("adm.description")}</p>
                      <div className="space-y-1">
                        <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px] text-emerald-400">check_circle</span>
                          {t("adm.req24bit")}
                        </p>
                        <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px] text-emerald-400">check_circle</span>
                          {t("adm.reqSampleRate")}
                        </p>
                        <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px] text-amber-400">info</span>
                          {t("adm.reqTruePeak")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ADM File Upload */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">{t("adm.uploadMaster")}</label>
                    {track.admAssetId && admFileInfo ? (
                      <div className="flex items-center gap-3 p-4 bg-emerald-900/20 border border-emerald-700/40 rounded-lg">
                        <span className="material-symbols-outlined text-emerald-400 text-xl" style={{fontVariationSettings: "'FILL' 1, 'wght' 400"}}>audio_file</span>
                        <div className="flex-1">
                          <p className="text-sm text-white font-medium">
                            {admFileInfo.bitDepth}-bit {admFileInfo.codec} &bull; {admFileInfo.sampleRate ? (admFileInfo.sampleRate / 1000).toFixed(1) : '?'} kHz
                            {admFileInfo.duration ? ` • ${formatToMMSSTT(admFileInfo.duration)}` : ''}
                          </p>
                          <p className="text-xs text-emerald-400 mt-0.5 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]" style={{fontVariationSettings: "'FILL' 1, 'wght' 400"}}>verified</span>
                            {t("adm.validationSuccess")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            updateTrack({ admAssetId: "" });
                            setAdmFileInfo(null);
                          }}
                          className="p-1.5 hover:bg-zinc-700 rounded-md transition-colors"
                        >
                          <CloseIcon className="w-4 h-4 text-zinc-400" />
                        </button>
                      </div>
                    ) : (
                      <MediaUploadWithPreview
                        type="AUDIO"
                        label={t("adm.uploadMaster")}
                        onUpload={async (file, onProgress) => {
                          const responseData = await uploadMedia("AUDIO", file, file.name, {
                            releaseId: releaseId || "",
                            isrc: track.isrc || "",
                            labelId: labelId || "",
                            trackTitle: track.title || "",
                          }, onProgress);

                          const assetId = String(responseData.assetId);

                          // Set file info for display
                          setAdmFileInfo({
                            bitDepth: responseData.bitDepth,
                            sampleRate: responseData.sampleRate,
                            codec: responseData.codec,
                            duration: responseData.duration,
                          });

                          // Link to track
                          updateTrack({ admAssetId: assetId });
                          if (onAssetUploaded) onAssetUploaded(assetId, responseData.filename, responseData.duration);
                          return null;
                        }}
                      />
                    )}
                  </div>

                  {/* Mastering Engineer Email */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      <span className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-zinc-500">mail</span>
                        {t("adm.masteringEngineerEmail")}
                      </span>
                    </label>
                    <input
                      type="email"
                      value={track.masteringEngineerEmail || ""}
                      onChange={(e) => updateTrack({ masteringEngineerEmail: e.target.value })}
                      placeholder={t("adm.masteringEngineerEmailPlaceholder")}
                      className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#fb1e5d]/50 placeholder-zinc-600 text-sm"
                    />
                    <p className="text-xs text-zinc-600 mt-1.5">{t("adm.masteringEngineerEmailHint")}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VEVO COMPLIANCE — inside GENERAL tab, only for VIDEO releases */}
          {activeMainTab === "GENERAL" && releaseType === "VIDEO" && (
            <div className="mt-8 border border-zinc-700/60 rounded-xl p-6 bg-zinc-900/40">
              <div className="mb-4">
                <h4 className="text-md font-semibold text-white mb-1">
                  {t("trackForm.vevoCompliance", "VEVO Compliance")}
                </h4>
                <p className="text-sm text-zinc-400">
                  {t("trackForm.vevoComplianceDescription", "Required attestations for VEVO video distribution. Both must be true for the release to pass QC.")}
                </p>
              </div>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#fb1e5d] w-4 h-4"
                    checked={track.vevoNoSlatesOrTitleCards ?? false}
                    onChange={(e) => updateTrack({ vevoNoSlatesOrTitleCards: e.target.checked })}
                  />
                  <span className="text-sm text-zinc-300">
                    {t("trackForm.vevoNoSlates", "Video contains no front/end slates, title cards, or end cards")}
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[#fb1e5d] w-4 h-4"
                    checked={track.vevoNoLetterboxing ?? false}
                    onChange={(e) => updateTrack({ vevoNoLetterboxing: e.target.checked })}
                  />
                  <span className="text-sm text-zinc-300">
                    {t("trackForm.vevoNoLetterboxing", "Video contains no letterboxing or pillarboxing")}
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* VISUALS TAB */}
          {activeMainTab === "VISUALS" && (
            <div className="space-y-8">
              {/* Spotify Canvas */}
              <div className="bg-zinc-800/20 border border-zinc-800 p-6 rounded-lg">
                <div className="mb-4">
                  <h4 className="text-md font-semibold text-white mb-1">{t("trackForm.spotifyCanvas")}</h4>
                  <p className="text-sm text-zinc-400">{t("trackForm.canvasDescription")}</p>
                </div>

                {/* CN-3: Canvas Content Policy Checkboxes (controlled, persisted in pitchingSpotifyData.canvasPolicy) */}
                {(() => {
                  const policy = track.pitchingSpotifyData?.canvasPolicy ?? {};
                  const setPolicy = (patch: Record<string, boolean>) =>
                    updateTrack({
                      pitchingSpotifyData: {
                        ...(track.pitchingSpotifyData ?? {}),
                        canvasPolicy: { ...policy, ...patch },
                      },
                    });
                  return (
                    <div className="mb-5 p-4 bg-zinc-800/50 border border-zinc-700 rounded-lg space-y-3">
                      <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">{t("trackForm.contentPolicyCompliance")}</p>
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[#1db954] w-4 h-4"
                          checked={policy.noUrls ?? true}
                          onChange={(e) => setPolicy({ noUrls: e.target.checked })}
                        />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300">{t("trackForm.policyNoUrls")}</span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[#1db954] w-4 h-4"
                          checked={policy.noCompetitor ?? true}
                          onChange={(e) => setPolicy({ noCompetitor: e.target.checked })}
                        />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300">{t("trackForm.policyNoCompetitor")}</span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[#1db954] w-4 h-4"
                          checked={policy.noFlashing ?? true}
                          onChange={(e) => setPolicy({ noFlashing: e.target.checked })}
                        />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300">{t("trackForm.policyNoFlashing")}</span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[#1db954] w-4 h-4"
                          checked={policy.explicitContent ?? false}
                          onChange={(e) => setPolicy({ explicitContent: e.target.checked })}
                        />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300">{t("trackForm.policyExplicitContent")}</span>
                      </label>
                    </div>
                  );
                })()}
                
                <div className="relative mb-6">
                  <select
                    value={canvasUploadMode === "UPLOAD" ? "NEW" : track.canvasAssetId || ""}
                    onChange={(e) => {
                      if (e.target.value === "NEW") {
                        setCanvasUploadMode("UPLOAD");
                        updateTrack({ canvasAssetId: "" });
                      } else {
                        setCanvasUploadMode("LIBRARY");
                        updateTrack({ canvasAssetId: e.target.value });
                      }
                    }}
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] appearance-none"
                  >
                    <option value="" disabled>{t("trackForm.selectAsset")}</option>
                    <option value="NEW">{t("ui.trackForm.createNewCanvas", "+ Create New Canvas")}</option>
                    <optgroup label={t("assets.libraryAssets")}>
                      {assets.filter((a) => a.type === "CANVAS").map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {decodeURIComponent(asset.fileName?.split(/[\\/]/).pop() || "")}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {canvasUploadMode === "UPLOAD" ? (
                  <MediaUploadWithPreview
                    type="VIDEO"
                    label={t("trackForm.uploadCanvas")}
                    onUpload={async (file, onProgress) => {
                      const responseData = await uploadMedia("CANVAS", file, file.name, { releaseId: releaseId || "" }, onProgress);
                      const assetId = String(responseData.assetId);
                      updateTrack({ canvasAssetId: assetId });
                      if (onAssetUploaded) onAssetUploaded(assetId, responseData.filename, responseData.duration);
                      return null;
                    }}
                  />
                ) : track.canvasAssetId && (
                  <CanvasVisualizer 
                    type="CANVAS" 
                    videoUrl={assets.find(a => a.id === track.canvasAssetId)?.fileUrl || ""} 
                  />
                )}
              </div>

              {/* Apple Motion */}
              <div className="bg-zinc-800/20 border border-zinc-800 p-6 rounded-lg">
                <div className="mb-4">
                  <h4 className="text-md font-semibold text-white mb-1">{t("trackForm.appleMusicMotion")}</h4>
                  <p className="text-sm text-zinc-400">{t("trackForm.motionDescription")}</p>
                </div>
                
                <div className="relative mb-6">
                  <select
                    value={motionUploadMode === "UPLOAD" ? "NEW" : track.motionAssetId || ""}
                    onChange={(e) => {
                      if (e.target.value === "NEW") {
                        setMotionUploadMode("UPLOAD");
                        updateTrack({ motionAssetId: "" });
                      } else {
                        setMotionUploadMode("LIBRARY");
                        updateTrack({ motionAssetId: e.target.value });
                      }
                    }}
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] appearance-none"
                  >
                    <option value="" disabled>{t("trackForm.selectAsset")}</option>
                    <option value="NEW">{t("ui.trackForm.createNewMotionAsset", "+ Create New Motion Asset")}</option>
                    <optgroup label={t("assets.libraryAssets")}>
                      {assets.filter((a) => a.type === "MOTION").map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {decodeURIComponent(asset.fileName?.split(/[\\/]/).pop() || "")}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {motionUploadMode === "UPLOAD" ? (
                  <MediaUploadWithPreview
                    type="VIDEO"
                    label={t("trackForm.uploadMotion")}
                    onUpload={async (file, onProgress) => {
                      const responseData = await uploadMedia("MOTION", file, file.name, { releaseId: releaseId || "" }, onProgress);
                      const assetId = String(responseData.assetId);
                      updateTrack({ motionAssetId: assetId });
                      if (onAssetUploaded) onAssetUploaded(assetId, responseData.filename, responseData.duration);
                      return null;
                    }}
                  />
                ) : track.motionAssetId && (
                  <CanvasVisualizer 
                    type="MOTION" 
                    videoUrl={assets.find(a => a.id === track.motionAssetId)?.fileUrl || ""} 
                  />
                )}
              </div>

              {/* Tidal Animated Artwork */}
              <div className="bg-zinc-800/20 border border-zinc-800 p-6 rounded-lg">
                <div className="mb-4">
                  <h4 className="text-md font-semibold text-white mb-1">{t("trackForm.tidalAnimatedArtwork")}</h4>
                  <p className="text-sm text-zinc-400">{t("trackForm.tidalDescription")}</p>
                </div>
                <MediaUploadWithPreview
                  type="VIDEO"
                  label={t("trackForm.uploadTidalArtwork")}
                  onUpload={async (file, onProgress) => {
                    const responseData = await uploadMedia("CANVAS", file, file.name, { releaseId: releaseId || "" }, onProgress);
                    const assetId = String(responseData.assetId);
                    if (onAssetUploaded) onAssetUploaded(assetId, responseData.filename, responseData.duration);
                    return null;
                  }}
                />
              </div>

              {/* Amazon Animated Cover */}
              <div className="bg-zinc-800/20 border border-zinc-800 p-6 rounded-lg">
                <div className="mb-4">
                  <h4 className="text-md font-semibold text-white mb-1">{t("trackForm.amazonAnimatedCover")}</h4>
                  <p className="text-sm text-zinc-400">{t("trackForm.amazonDescription")}</p>
                </div>
                <MediaUploadWithPreview
                  type="VIDEO"
                  label={t("trackForm.uploadAmazonCover")}
                  onUpload={async (file, onProgress) => {
                    const responseData = await uploadMedia("CANVAS", file, file.name, { releaseId: releaseId || "" }, onProgress);
                    const assetId = String(responseData.assetId);
                    if (onAssetUploaded) onAssetUploaded(assetId, responseData.filename, responseData.duration);
                    return null;
                  }}
                />
              </div>
            </div>
          )}

          {/* PITCHING TAB */}
          {activeMainTab === "PITCHING" && (
            <PitchingForm
              pitchingNote={track.pitchingNote}
              pitchingSpotifyData={track.pitchingSpotifyData}
              pitchingAmazonData={track.pitchingAmazonData}
              pitchingTidalData={track.pitchingTidalData}
              releaseDate={releaseDate}
              onUpdate={(updates) => updateTrack(updates)}
            />
          )}
        </div>
      )}
    </div>
  );
}
