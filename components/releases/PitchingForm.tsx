"use client";

import React, { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { Info, Music, Headphones, Radio } from "lucide-react";

interface PitchingAmazonData {
  note?: string;
  genres: string[];
  moods: string[];
  similarArtists: string[];
  recordingType?: string;
  language?: string;
}

interface PitchingSpotifyData {
  note?: string;
}

interface PitchingTidalData {
  note?: string;
}

interface PitchingFormProps {
  pitchingNote?: string; // Legacy Spotify note (backward compat)
  pitchingSpotifyData?: PitchingSpotifyData;
  pitchingAmazonData?: PitchingAmazonData;
  pitchingTidalData?: PitchingTidalData;
  releaseDate?: string;
  onUpdate: (data: {
    pitchingNote?: string;
    pitchingSpotifyData?: PitchingSpotifyData;
    pitchingAmazonData?: PitchingAmazonData;
    pitchingTidalData?: PitchingTidalData;
  }) => void;
}

const AMAZON_GENRES = [
  "Pop", "Hip-Hop", "R&B", "Electronic", "Rock", "Country", "Latin", "Jazz", "Classical", "K-Pop", "Afrobeats",
  "Indie", "Alternative", "Metal", "Reggae", "Blues", "Folk", "Punk", "Soul", "Funk",
];

const AMAZON_MOODS = [
  "Happy", "Sad", "Chill", "Energetic", "Romantic", "Angry", "Focus", "Workout", "Party", "Sleep",
  "Uplifting", "Dark", "Nostalgic", "Peaceful", "Confident",
];

const RECORDING_TYPES = [
  { value: "original", label: "Original" },
  { value: "remix", label: "Remix" },
  { value: "live", label: "Live" },
  { value: "cover", label: "Cover" },
  { value: "acoustic", label: "Acoustic" },
  { value: "remaster", label: "Remaster" },
];

export default function PitchingForm({
  pitchingNote = "",
  pitchingSpotifyData,
  pitchingAmazonData,
  pitchingTidalData,
  releaseDate,
  onUpdate,
}: PitchingFormProps) {
  const { t } = useI18n();
  const [activePlatform, setActivePlatform] = useState<"SPOTIFY" | "AMAZON" | "TIDAL">("SPOTIFY");

  // Resolve per-DSP notes (backward compat: fallback pitchingNote → spotifyNote)
  const spotifyNote = pitchingSpotifyData?.note ?? pitchingNote ?? "";
  const amazonNote = pitchingAmazonData?.note ?? "";
  const tidalNote = pitchingTidalData?.note ?? "";

  const amazonData: PitchingAmazonData = {
    note: amazonNote,
    genres: pitchingAmazonData?.genres || [],
    moods: pitchingAmazonData?.moods || [],
    similarArtists: pitchingAmazonData?.similarArtists || [],
    recordingType: pitchingAmazonData?.recordingType || "",
    language: pitchingAmazonData?.language || "",
  };

  // Check Spotify 7-day rule
  const getSpotifyCountdown = () => {
    if (!releaseDate) return { locked: false, daysLeft: 0, message: "" };
    const release = new Date(releaseDate);
    const now = new Date();
    const diffTime = release.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 7) return { locked: true, daysLeft: diffDays, message: t("pitching.deadlinePassed", "Deadline passed") };
    return { locked: false, daysLeft: diffDays, message: `${diffDays - 7} ${t("pitching.daysUntilDeadline", "days until deadline")}` };
  };

  const isSpotifyLocked = () => getSpotifyCountdown().locked;

  // Amazon 14-day post-release window
  const getAmazonWindow = () => {
    if (!releaseDate) return { active: true, daysLeft: 14, message: "" };
    const release = new Date(releaseDate);
    const now = new Date();
    const diffTime = now.getTime() - release.getTime();
    const daysSinceRelease = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (daysSinceRelease < 0) return { active: true, daysLeft: 14, message: `${t("pitching.releaseIn", "Release in")} ${Math.abs(daysSinceRelease)} ${t("pitching.days", "days")}` };
    if (daysSinceRelease <= 14) return { active: true, daysLeft: 14 - daysSinceRelease, message: `${14 - daysSinceRelease} ${t("pitching.daysRemaining", "days remaining")}` };
    return { active: false, daysLeft: 0, message: t("pitching.amazonWindowExpired", "14-day window expired") };
  };

  const updateSpotifyNote = (val: string) => {
    if (val.length <= 500) {
      onUpdate({
        pitchingNote: val, // backward compat
        pitchingSpotifyData: { ...pitchingSpotifyData, note: val },
      });
    }
  };

  const updateAmazonNote = (val: string) => {
    if (val.length <= 1000) {
      onUpdate({
        pitchingAmazonData: { ...amazonData, note: val },
      });
    }
  };

  const updateTidalNote = (val: string) => {
    // Tidal: NO max cap. Spec requires minimum 500 if provided.
    onUpdate({
      pitchingTidalData: { ...pitchingTidalData, note: val },
    });
  };

  const toggleAmazonArray = (field: "genres" | "moods" | "similarArtists", val: string, max: number) => {
    const current = amazonData[field] || [];
    let next: string[];
    if (current.includes(val)) {
      next = current.filter((item) => item !== val);
    } else {
      if (current.length >= max) return;
      next = [...current, val];
    }
    onUpdate({
      pitchingAmazonData: { ...amazonData, [field]: next },
    });
  };

  const tidalNoteLength = tidalNote.length;
  const tidalMinMet = tidalNoteLength === 0 || tidalNoteLength >= 500;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mt-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            {t("heading.pitchingMarketing", "Pitching & Marketing")}
          </h3>
          <p className="text-sm text-zinc-400">
            {t("pitching.pitchingDescription", "Submit your track to editorial curators across DSPs. Each platform stores its notes independently.")}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-zinc-800 mb-6 pb-2">
        <button
          onClick={() => setActivePlatform("SPOTIFY")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
            activePlatform === "SPOTIFY" ? "bg-[#1DB954] text-white" : "text-zinc-400 hover:text-white"
          }`}
        >
          <Headphones className="w-4 h-4" />
          Spotify
        </button>
        <button
          onClick={() => setActivePlatform("AMAZON")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
            activePlatform === "AMAZON" ? "bg-[#00A8E1] text-white" : "text-zinc-400 hover:text-white"
          }`}
        >
          <Radio className="w-4 h-4" />
          Amazon Music
        </button>
        <button
          onClick={() => setActivePlatform("TIDAL")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
            activePlatform === "TIDAL" ? "bg-white text-black font-semibold" : "text-zinc-400 hover:text-white"
          }`}
        >
          <Music className="w-4 h-4" />
          Tidal
        </button>
      </div>

      {/* SPOTIFY TAB */}
      {activePlatform === "SPOTIFY" && (
        <div className="space-y-4">
          {/* Countdown Timer */}
          {releaseDate && (
            <div className={`flex items-center justify-between p-3 rounded-md text-sm ${
              getSpotifyCountdown().locked 
                ? "bg-red-500/10 border border-red-500/20" 
                : "bg-[#1DB954]/10 border border-[#1DB954]/20"
            }`}>
              <div className="flex items-center gap-2">
                <Info className={`w-4 h-4 ${getSpotifyCountdown().locked ? "text-red-400" : "text-[#1DB954]"}`} />
                <span className={getSpotifyCountdown().locked ? "text-red-400" : "text-[#1DB954]"}>
                  {getSpotifyCountdown().locked 
                    ? t("pitching.spotifyRequires7Days") 
                    : t("pitching.pitchingWindowOpen")}
                </span>
              </div>
              <span className={`font-mono text-sm font-semibold ${
                getSpotifyCountdown().locked ? "text-red-400" : "text-[#1DB954]"
              }`}>
                {getSpotifyCountdown().daysLeft}{t("pitching.dToRelease", "d to release")}
              </span>
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2 flex justify-between">
              <span>{t("pitching.spotifyPitchingNote")}</span>
              <span className={spotifyNote.length >= 500 ? "text-red-400" : "text-zinc-500"}>
                {spotifyNote.length} / 500
              </span>
            </label>
            <textarea
              value={spotifyNote}
              onChange={(e) => updateSpotifyNote(e.target.value)}
              disabled={isSpotifyLocked()}
              placeholder={t("form.placeholder.tellSpotifyCuratorsAboutTheStoryBehindThisTrackMarketingPlansAndFocusMarkets", "Tell Spotify curators about the story behind this track, marketing plans, and focus markets...")}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-3 text-white placeholder-zinc-500 h-32 focus:outline-none focus:ring-1 focus:ring-zinc-600 disabled:opacity-50"
            />
            <p className="text-xs text-zinc-500 mt-1">
              {t("pitching.spotifyFocusTip", "Focus on sound & vibe, artist credentials, and target audience. Release Radar requires 7-day lead time.")}
            </p>
          </div>
        </div>
      )}

      {/* AMAZON TAB */}
      {activePlatform === "AMAZON" && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2 flex justify-between">
              <span>{t("pitching.amazonMarketingNote")}</span>
              <span className={amazonNote.length >= 1000 ? "text-red-400" : "text-zinc-500"}>
                {amazonNote.length} / 1000
              </span>
            </label>
            <textarea
              value={amazonNote}
              onChange={(e) => updateAmazonNote(e.target.value)}
              placeholder={t("form.placeholder.detailedMarketingNotesPromotionalPlansFanEngagementAdBudgetsSocialMediaStrategy", "Detailed marketing notes: promotional plans, fan engagement, ad budgets, social media strategy...")}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-3 text-white placeholder-zinc-500 h-32 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            />
            <p className="text-xs text-zinc-500 mt-1">
              {t("pitching.amazonPostReleaseTip", "Amazon allows pitching up to 14 days after release.")}
            </p>
          </div>

          {/* Amazon Countdown Timer */}
          {releaseDate && (
            <div className={`flex items-center justify-between p-3 rounded-md text-sm ${
              getAmazonWindow().active 
                ? "bg-[#00A8E1]/10 border border-[#00A8E1]/20" 
                : "bg-zinc-800 border border-zinc-700"
            }`}>
              <div className="flex items-center gap-2">
                <Info className={`w-4 h-4 ${getAmazonWindow().active ? "text-[#00A8E1]" : "text-zinc-500"}`} />
                <span className={getAmazonWindow().active ? "text-[#00A8E1]" : "text-zinc-500"}>
                  {getAmazonWindow().active ? t("pitching.amazonPitchingOpen") : t("pitching.amazonWindowExpiredMsg", "Amazon 14-day window has expired.")}
                </span>
              </div>
              <span className={`font-mono text-sm font-semibold ${
                getAmazonWindow().active ? "text-[#00A8E1]" : "text-zinc-500"
              }`}>
                {getAmazonWindow().message}
              </span>
            </div>
          )}

          {/* Recording Type */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              {t("form.recordingType", "Recording Type")}
            </label>
            <select
              value={amazonData.recordingType || ""}
              onChange={(e) => onUpdate({ pitchingAmazonData: { ...amazonData, recordingType: e.target.value } })}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              <option value="">{t("pitching.selectType")}</option>
              {RECORDING_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>{rt.label}</option>
              ))}
            </select>
          </div>

          {/* Similar Artists (max 3) */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              {t("form.similarArtistsMax3", "Similar Artists (Max 3)")}
            </label>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="text"
                  value={amazonData.similarArtists[i] || ""}
                  onChange={(e) => {
                    const newArtists = [...amazonData.similarArtists];
                    if (e.target.value) {
                      newArtists[i] = e.target.value;
                    } else {
                      newArtists.splice(i, 1);
                    }
                    onUpdate({ pitchingAmazonData: { ...amazonData, similarArtists: newArtists.filter(Boolean) } });
                  }}
                  placeholder={`${t("pitching.similarArtist", "Similar artist")} ${i + 1}`}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white placeholder-zinc-500 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-600"
                />
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {t("pitching.amazonAlgorithmTip", "Helps Amazon's algorithm target the right listener audience.")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                {t("form.genresMax3", "Genres (Max 3)")}
              </label>
              <div className="flex flex-wrap gap-2">
                {AMAZON_GENRES.map((g) => {
                  const isSelected = amazonData.genres?.includes(g);
                  return (
                    <button
                      key={g}
                      onClick={() => toggleAmazonArray("genres", g, 3)}
                      className={`px-3 py-1 rounded-full text-xs transition-colors ${
                        isSelected
                          ? "bg-[#00A8E1] text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                {t("form.moodsMax3", "Moods (Max 3)")}
              </label>
              <div className="flex flex-wrap gap-2">
                {AMAZON_MOODS.map((m) => {
                  const isSelected = amazonData.moods?.includes(m);
                  return (
                    <button
                      key={m}
                      onClick={() => toggleAmazonArray("moods", m, 3)}
                      className={`px-3 py-1 rounded-full text-xs transition-colors ${
                        isSelected
                          ? "bg-[#00A8E1] text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TIDAL TAB */}
      {activePlatform === "TIDAL" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2 flex justify-between">
              <span>{t("pitching.tidalPitchingNote")}</span>
              <span className={!tidalMinMet ? "text-amber-400" : "text-zinc-500"}>
                {tidalNoteLength} {t("pitching.chars", "chars")}
                {tidalNoteLength > 0 && tidalNoteLength < 500 && ` (${t("pitching.min500", "min 500")})`}
              </span>
            </label>
            <textarea
              value={tidalNote}
              onChange={(e) => updateTidalNote(e.target.value)}
              placeholder={t("form.placeholder.highlightTheMostMarketableAspectsOfThisReleaseForTidalCuratorsMin500CharactersIfProvided", "Highlight the most marketable aspects of this release for Tidal curators (min 500 characters if provided)...")}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-3 text-white placeholder-zinc-500 h-40 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            />
            {!tidalMinMet && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <Info className="w-3 h-3" />
                {t("pitching.tidalMinRequired", "Tidal requires a minimum of 500 characters.")} {500 - tidalNoteLength} {t("pitching.moreNeeded", "more needed.")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
