"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { CheckCircleIcon, CloudUploadIcon } from "@/components/Icon";
import ChannelBannerCropper from "@/components/ChannelBannerCropper";

interface Artist {
  id: string;
  name: string;
  vevoChannel?: string;
}

export default function ChannelsPanel() {
  const { t } = useI18n();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedArtist, setSelectedArtist] = useState<string>("");
  const [channelName, setChannelName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [bannerBlob, setBannerBlob] = useState<Blob | null>(null);
  
  const [showCropper, setShowCropper] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchArtists() {
      try {
        const res = await fetch("/api/artists");
        if (res.ok) {
          const data = await res.json();
          setArtists(data.data || data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchArtists();
  }, []);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        setFormError(t("channels.avatarMustBeImage"));
        return;
      }
      setAvatarBlob(file);
    }
  };

  const handleBannerCropped = (blob: Blob) => {
    setBannerBlob(blob);
    setShowCropper(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!selectedArtist) {
      setFormError(t("channels.pleaseSelectArtist"));
      return;
    }

    if (!channelName.endsWith("VEVO")) {
      setFormError("Channel name must end with 'VEVO' (e.g., 'ArtistNameVEVO').");
      return;
    }

    if (channelName.length > 20) {
      setFormError(t("channels.channelNameMaxLength"));
      return;
    }

    if (bio.length > 1000) {
      setFormError(t("channels.bioMaxLength"));
      return;
    }

    const bannedWords = ["spotify", "apple music", "tidal"];
    const lowerBio = bio.toLowerCase();
    if (bannedWords.some(word => lowerBio.includes(word))) {
      setFormError("Biography cannot contain references to competitor DSPs (Spotify, Apple Music, TIDAL).");
      return;
    }

    if (!avatarBlob) {
      setFormError("Press photo (avatar) is required.");
      return;
    }

    if (!bannerBlob) {
      setFormError("Channel banner is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/artists/${selectedArtist}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vevoChannel: channelName }),
      });

      if (!res.ok) {
        const err = await res.json();
        setFormError(err.error || t("channels.failedSubmitRequest"));
        setSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error(err);
      setFormError(t("channels.unexpectedError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="h-full flex-1 overflow-y-auto bg-[var(--bg-primary)] flex items-center justify-center p-6">
        <div className="bg-[var(--bg-surface)] p-8 rounded-xl border border-[var(--border-primary)] shadow-2xl max-w-md w-full text-center">
          <CheckCircleIcon size={64} className="text-[var(--status-success)] mx-auto mb-4" />
          <h2 className="text-2xl font-medium text-[var(--text-primary)] mb-2">{t("heading.requestSubmitted", "Request Submitted")}</h2>
          <p className="text-[var(--text-secondary)] mb-6">
            Your VEVO Official Artist Channel request for <strong>{channelName}</strong> has been successfully submitted and is pending DDEX delivery scheduling.
          </p>
          <button
            onClick={() => {
              setSuccess(false);
              setChannelName("");
              setBio("");
              setAvatarBlob(null);
              setBannerBlob(null);
              setSelectedArtist("");
            }}
            className="w-full px-4 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors font-medium"
          >
            Submit Another Request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex-1 overflow-y-auto bg-[var(--bg-primary)] text-[var(--text-primary)] pb-12">
      <div className="px-8 py-6 border-b border-[var(--border-primary)] flex items-center justify-between sticky top-0 bg-[var(--bg-primary)] z-10">
        <div>
          <h1 className="text-2xl font-semibold">{t("channels.vevoChannelRequest")}</h1>
          <p className="text-[var(--text-tertiary)] text-sm mt-1">{t("channels.requestOAC")}</p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {showCropper ? (
          <ChannelBannerCropper 
            onCrop={handleBannerCropped} 
            onCancel={() => setShowCropper(false)} 
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-8 bg-[var(--bg-surface)] p-8 rounded-xl border border-[var(--border-primary)] shadow-lg">
            
            {formError && (
              <div className="p-4 rounded-lg bg-[var(--status-error-surface)] border border-[var(--status-error)]/50 text-[var(--status-error)]">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t("form.selectArtist", "Select Artist *")}
                </label>
                {loading ? (
                  <div className="h-[42px] bg-[var(--bg-elevated)] animate-pulse rounded-lg" />
                ) : (
                  <select
                    value={selectedArtist}
                    onChange={(e) => {
                      setSelectedArtist(e.target.value);
                      const artist = artists.find(a => a.id === e.target.value);
                      if (artist && !channelName) {
                        const cleanName = artist.name.replace(/[^a-zA-Z0-9]/g, '');
                        setChannelName(`${cleanName}VEVO`.substring(0, 20));
                      }
                    }}
                    required
                    className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="">{t("channels.selectAnArtist")}</option>
                    {artists.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t("form.vEVOChannelName", "VEVO Channel Name *")}
                </label>
                <input
                  type="text"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder={t("form.placeholder.eGArtistNameVEVO", "e.g. ArtistNameVEVO")}
                  required
                  maxLength={20}
                  className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <p className="text-xs text-[var(--text-tertiary)] mt-2">{t("channels.channelNameHint")}</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                {t("form.channelBiographyAbout", "Channel Biography (About)")}
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder={t("form.placeholder.enterChannelBiography", "Enter channel biography...")}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
              />
              <div className="flex justify-between items-center mt-2">
                <p className="text-xs text-[var(--text-tertiary)]">{t("channels.bioCompetitorHint")}</p>
                <span className="text-xs text-[var(--text-tertiary)]">{bio.length}/1000</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-[var(--border-primary)]">
              {/* Avatar Upload */}
              <div>
                <h3 className="text-md font-medium text-[var(--text-primary)] mb-1">{t("heading.pressPhotoAvatar", "Press Photo (Avatar)")}</h3>
                <p className="text-xs text-[var(--text-secondary)] mb-4">{t("channels.avatarHint")}</p>
                
                <div className="border-2 border-dashed border-[var(--border-input)] rounded-xl p-6 text-center relative hover:bg-[var(--bg-elevated)] transition-colors">
                  {avatarBlob ? (
                    <div className="flex flex-col items-center">
                      <div className="w-24 h-24 rounded-full overflow-hidden mb-3 border border-[var(--border-primary)]">
                        <img src={URL.createObjectURL(avatarBlob)} alt="Avatar Preview" className="w-full h-full object-cover" />
                      </div>
                      <button type="button" onClick={() => setAvatarBlob(null)} className="text-sm text-[var(--status-error)] hover:underline">{t("common.remove")}</button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center py-4">
                      <CloudUploadIcon size={32} className="mb-2 text-[var(--text-tertiary)]" />
                      <span className="text-sm font-medium text-[var(--accent-text)]">{t("channels.uploadAvatar")}</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </label>
                  )}
                </div>
              </div>

              {/* Banner Upload */}
              <div>
                <h3 className="text-md font-medium text-[var(--text-primary)] mb-1">{t("heading.channelBanner", "Channel Banner")}</h3>
                <p className="text-xs text-[var(--text-secondary)] mb-4">{t("channels.bannerHint")}</p>
                
                <div className="border-2 border-dashed border-[var(--border-input)] rounded-xl p-6 text-center hover:bg-[var(--bg-elevated)] transition-colors">
                  {bannerBlob ? (
                    <div className="flex flex-col items-center">
                      <div className="w-full aspect-[2560/1440] rounded-lg overflow-hidden mb-3 border border-[var(--border-primary)] relative">
                        <img src={URL.createObjectURL(bannerBlob)} alt="Banner Preview" className="w-full h-full object-cover" />
                      </div>
                      <button type="button" onClick={() => setShowCropper(true)} className="text-sm text-[var(--accent-text)] hover:underline">{t("channels.editCrop")}</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCropper(true)}
                      className="flex flex-col items-center justify-center w-full h-full min-h-[160px]"
                    >
                      <CloudUploadIcon size={32} className="mb-2 text-[var(--text-tertiary)]" />
                      <span className="text-sm font-medium text-[var(--accent-text)]">{t("channels.openBannerCropper")}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-6 border-t border-[var(--border-primary)]">
              <button
                type="submit"
                disabled={submitting}
                className="px-8 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg transition-colors font-medium text-lg"
              >
                {submitting ? "Submitting..." : "Submit Channel Request"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
