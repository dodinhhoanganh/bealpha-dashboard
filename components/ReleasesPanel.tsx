"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { COUNTRY_CODES } from "@/lib/country-codes";
import {
  LANGUAGES,
  ALBUM_PRICING_TIERS,
  TRACK_PRICING_TIERS,
} from "@/lib/languages";
import { MUSIC_GENRES, getAllSubgenres } from "@/lib/music-genres";
import { LocalizedInput, Localization } from "@/components/LocalizedInput";
import SearchableArtistSelect from "@/components/SearchableArtistSelect";
import SearchableLabelSelect from "@/components/SearchableLabelSelect";
import TrackForm from "@/components/TrackForm";
import ImageUpload from "@/components/ImageUpload";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/Toast";
import { useUploadProgress } from "@/components/UploadProgress";
import Pagination from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import SearchableEntitySelect from "@/components/SearchableEntitySelect";
import Modal from "@/components/Modal";
import {
  AlbumIcon,
  AudioFileIcon,
  AddIcon,
  SearchIcon,
  EditIcon,
  DeleteIcon,
  CheckCircleIcon,
  PendingIcon,
  CancelIcon,
  FilterListIcon,
  CloseIcon,
  PhotoCameraIcon,
  KeyboardArrowDownIcon,
  ArrowBackIcon,
  CloudUploadIcon,
  FileUploadIcon,
  FolderZipIcon,
  TableChartIcon,
  SwapHorizIcon,
  SendIcon,
  RefreshIcon,
  DownloadIcon,
  VisibilityIcon,
  TagIcon,
  LightbulbIcon,
  BoxArchiveIcon,
  ImageIcon,
  SpotifyIcon,
  AppleIcon,
  WarningIcon,
  BarChartIcon,
  MusicNoteIcon,
  CheckIcon,
  XMarkIcon,
  CircleIcon,
} from "@/components/Icon";

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

// ============ RELEASES COMPONENT ============
export default function ReleasesPanel({
  user,
  defaultMode = "AUDIO",
}: {
  user: UserSession;
  defaultMode?: "AUDIO" | "VIDEO";
}) {
  const { t } = useI18n(); // Auto-injected

  const [releases, setReleases] = useState<any[]>([]);
  const [artists, setArtists] = useState<{ id: string; name: string }[]>([]);
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [entities, setEntities] = useState<{ id: string; officialName: string; entityType: string }[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [selectedRelease, setSelectedRelease] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<"" | "xlsx" | "zip">("");
  const [showDdexPanel, setShowDdexPanel] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [dragState, setDragState] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<
    Array<{ type: "audio" | "artwork"; filename: string; releaseTitle: string }>
  >([]);
  const [uploadingMissingFiles, setUploadingMissingFiles] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);

  // DDEX Progress Modal state
  const [ddexProgress, setDdexProgress] = useState<{
    show: boolean;
    mode: "import" | "export" | "validate";
    phase:
      | "validating"
      | "uploading"
      | "importing"
      | "exporting"
      | "done"
      | "error";
    title: string;
    progress: number; // 0-100
    currentItem: string;
    items: Array<{
      name: string;
      status: "pending" | "processing" | "done" | "error";
      error?: string;
    }>;
    summary: string;
    errors: string[];
    validation?: {
      isDdexCompliant: boolean;
      totalColumns: number;
      totalRows: number;
      missingRequired: string[];
      missingRecommended: string[];
      presentDdexColumns: number;
      errors: string[];
    };
    zipInfo?: {
      audioFiles: number;
      artworkFiles: number;
      audioFileNames: string[];
      artworkFileNames: string[];
    } | null;
  }>({
    show: false,
    mode: "import",
    phase: "validating",
    title: "",
    progress: 0,
    currentItem: "",
    items: [],
    summary: "",
    errors: [],
  });

  // Multi-step wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    // Step 1: Basics & Artwork
    coverUrl: "",
    motionUrl: "",
    tidalArtworkUrl: "",
    amazonArtworkUrl: "",
    releaseType: defaultMode, // AUDIO or VIDEO
    format: "SINGLE", // SINGLE, EP, ALBUM
    title: "",
    subtitle: "",
    titleLocalized: [] as Localization[],
    titleVersion: "",
    titleVersionNotes: "",
    releaseCode: "",
    upc: "",
    upcAutoGenerate: false,
    metaLanguage: "en",
    releaseNotes: "",
    primaryArtists: [] as string[],
    featuringArtists: [] as string[],
    remixer: "",
    producer: "",

    // Step 2: Details
    genre: "",
    subGenre: "",
    ownerId: "", // Distributor/Label Owner
    labelId: "",
    cLine: "",
    pLine: "",
    contractPeriod: {
      begins: "",
      ends: "", // date or 'perpetuity'
    },

    // Step 3: Tracks
    tracks: [] as Array<{
      audioAssetId: string;
      snippetStart: string;
      snippetEnd?: string;
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
        performers: Array<{ name: string; role: string; artistId?: string }>;
        studioPersonnel: Array<{
          name: string;
          role: string;
          artistId?: string;
        }>;
        labelPersonnel: Array<{
          name: string;
          role: string;
          artistId?: string;
        }>;
        compositional: Array<{ name: string; role: string; artistId?: string }>;
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
      publishingObligation?: string;
      publisher?: string;
      vevoEndCredits?: boolean;
      vevoNoLetterboxing?: boolean;
      // Multimedia & Marketing
      canvasAssetId?: string;
      motionAssetId?: string;
      pitchingNote?: string;
      pitchingSpotifyData?: any;
      pitchingAmazonData?: any;
      pitchingTidalData?: any;
    }>,

    // Step 4: Scheduling & Pricing
    releaseDate: "",
    originalReleaseDate: "",
    releaseTime: "00:00",
    salesDate: "",
    salesTime: "00:00",
    preOrderType: "NO_PRE_ORDER", // IMMEDIATE, NO_PRE_ORDER, SPECIFIC_DATE
    preOrderDate: "",
    previewable: "NO",
    albumPricing: "Mid/Front",
    trackPricing: "Standard",
    territories: [] as string[], // All selected by default
    excludedTerritories: [] as string[],
    trackPublishingObligations: {} as Record<string, string>,
    trackPublishers: {} as Record<string, string>,
  });

  const canCreate = user.permissions.includes("release.create");
  const canUpdate = user.permissions.includes("release.update");
  const canDelete = user.permissions.includes("release.delete");
  const canApprove = user.permissions.includes("release.approve");

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("type", defaultMode);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/releases?${params}`);
      if (res.ok) {
        const json = await res.json();
        setReleases(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page, limit]);

  const fetchArtists = useCallback(async () => {
    try {
      const res = await fetch("/api/artists?limit=200");
      if (res.ok) {
        const json = await res.json();
        setArtists(json.data || json);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch("/api/labels");
      if (res.ok) {
        const json = await res.json();
        setLabels(json.data || json);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const fetchEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/entities?limit=100");
      if (res.ok) {
        const json = await res.json();
        setEntities(json.data || json);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/assets?type=AUDIO&limit=200");
      if (res.ok) {
        const json = await res.json();
        setAssets(json.data || json);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleCreateArtist = async (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }): Promise<string> => {
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artist),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to create artist (${res.status})`,
        );
      }
      const newArtist = await res.json();
      await fetchArtists(); // Refresh artist list
      return newArtist.id;
    } catch (error) {
      console.error("Error creating artist:", error);
      throw error;
    }
  };

  const handleCreateLabel = async (name: string): Promise<string> => {
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to create label (${res.status})`,
        );
      }
      const newLabel = await res.json();
      await fetchLabels(); // Refresh label list
      return newLabel.id;
    } catch (error) {
      console.error("Error creating label:", error);
      throw error;
    }
  };

  useEffect(() => {
    fetchReleases();
    fetchArtists();
    fetchLabels();
    fetchEntities();
    fetchAssets();
  }, [fetchReleases, fetchArtists, fetchLabels, fetchEntities, fetchAssets]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "RELEASE") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const handleApprove = async (id: string) => {
    await fetch(`/api/releases/${id}/approve`, { method: "POST" });
    fetchReleases();
  };

  const handleDeny = async (id: string) => {
    await fetch(`/api/releases/${id}/deny`, { method: "POST" });
    fetchReleases();
  };

  const handleDelete = async (id: string) => {
    const release = releases.find((r) => r.id === id);
    const trackCount = release?.trackCount || release?.tracks?.length || 0;
    const msg = t("releases.confirmDeleteRelease", `Are you sure you want to delete "${release?.title || "this release"}"?`) + `\n\n` + t("releases.deleteWillRemove", "This will also permanently delete:") + `\n- ${trackCount} ` + t("releases.tracksAndAudio", "track(s) and their audio files") + `\n- ` + t("releases.coverArt", "Cover art") + `\n- ` + t("releases.allDdexRecords", "All DDEX delivery records") + `\n\n` + t("releases.cannotBeUndone", "This action cannot be undone.");
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/releases/${id}`, { method: "DELETE" });
      if (res.ok) fetchReleases();
    } catch (e) {
      console.error(e);
    }
  };

  const openCreateForm = () => {
    // Initialize all territories as selected
    const allTerritories = COUNTRY_CODES.map((c) => c.code);
    setFormData({
      coverUrl: "",
      motionUrl: "",
      tidalArtworkUrl: "",
      amazonArtworkUrl: "",
      releaseType: defaultMode,
      format: "SINGLE",
      title: "",
      subtitle: "",
      titleLocalized: [] as Localization[],
      titleVersion: "",
      titleVersionNotes: "",
      releaseCode: "",
      upc: "",
      upcAutoGenerate: false,
      metaLanguage: "en",
      releaseNotes: "",
      primaryArtists: [],
      featuringArtists: [],
      remixer: "",
      producer: "",
      genre: MUSIC_GENRES[0].value,
      subGenre: "",
      ownerId: entities.length > 0 ? entities[0].id : "",
      labelId: labels.length > 0 ? labels[0].id : "",
      cLine: "",
      pLine: "",
      tracks: [] as any[],
      releaseDate: new Date().toISOString().split("T")[0],
      originalReleaseDate: new Date().toISOString().split("T")[0],
      releaseTime: "00:00",
      salesDate: new Date().toISOString().split("T")[0],
      salesTime: "00:00",
      preOrderType: "NO_PRE_ORDER",
      preOrderDate: "",
      previewable: "NO",
      albumPricing: "Mid/Front",
      trackPricing: "Standard",
      territories: allTerritories,
      excludedTerritories: [],
      trackPublishingObligations: {},
      trackPublishers: {},
      contractPeriod: { begins: "", ends: "" },
    });
    setCurrentStep(1);
    setFormError("");
    setView("create");
  };

  const openEditForm = (release: any) => {
    setSelectedRelease(release);
    setFormData({
      coverUrl: release.coverUrl || "",
      motionUrl: release.motionUrl || "",
      tidalArtworkUrl: release.tidalArtworkUrl || "",
      amazonArtworkUrl: release.amazonArtworkUrl || "",
      title: release.title || "",
      subtitle: release.subtitle || "",
      titleLocalized: Array.isArray(release.titleLocalized)
        ? release.titleLocalized
        : [],
      primaryArtists: release.artistId ? [release.artistId] : [], // Map artistId to primaryArtists array
      featuringArtists: [],
      format: release.format || "SINGLE",
      releaseDate: release.releaseDate
        ? new Date(release.releaseDate).toISOString().split("T")[0]
        : "",
      originalReleaseDate: release.originalReleaseDate
        ? new Date(release.originalReleaseDate).toISOString().split("T")[0]
        : "",
      upc: release.ean || "", // Map EAN to UPC
      upcAutoGenerate: false,
      releaseCode: release.catalogueNumber || "",
      genre: release.genre || "",
      subGenre: release.subGenre || "",
      ownerId: release.ownerId || "",
      pLine: release.pLine || "",
      cLine: release.cLine || "",
      // Initialize other fields with defaults or from release if available
      releaseType: release.type || defaultMode,
      titleVersion: "",
      titleVersionNotes: "",
      metaLanguage: release.metaLanguage || "en",
      releaseNotes: release.releaseNotes || "",
      remixer: "",
      producer: "",
      labelId: release.labelId || "",
      tracks: [] as any[], // Tracks would need to be fetched and mapped
      releaseTime: "00:00",
      salesDate: "",
      salesTime: "00:00",
      preOrderType: "NO_PRE_ORDER",
      preOrderDate: "",
      previewable: "NO",
      albumPricing: "Mid/Front",
      trackPricing: "Standard",
      territories: [],
      excludedTerritories: [],
      trackPublishingObligations: {},
      trackPublishers: {},
      contractPeriod: release.contractPeriod || { begins: "", ends: "" },
    });
    setFormError("");
    setView("edit");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Full validation across all steps
    const { errors, failedStep } = validateReleaseAll(formData);
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      if (view === "create" && failedStep > 0) setCurrentStep(failedStep);
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      const url =
        view === "create"
          ? "/api/releases"
          : `/api/releases/${selectedRelease?.id}`;
      const method = view === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          releaseDate: new Date(formData.releaseDate).toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(translateApiError(data.error, t));
        setSaving(false);
        return;
      }

      setView("list");
      fetchReleases();
    } catch (e) {
      setFormError(t("common.errorOccurred", "An error occurred"));
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (
    e: React.ChangeEvent<HTMLInputElement> | File,
    forceFormat?: "zip" | "xlsx" | "csv" | "xml",
  ) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;

    // Auto-detect format from file extension
    const fileName = file.name.toLowerCase();
    let format: "xlsx" | "csv" | "xml" | "zip";

    if (fileName.endsWith(".zip")) {
      format = "zip";
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      format = "xlsx";
    } else if (fileName.endsWith(".csv")) {
      format = "csv";
    } else if (fileName.endsWith(".xml")) {
      format = "xml";
    } else {
      setDdexProgress({
        show: true,
        mode: "import",
        phase: "error",
        title: t("ddex.invalidFile", "Invalid File"),
        progress: 0,
        currentItem: "",
        items: [],
        summary: "",
        errors: [
          t("ddex.invalidFileFormat", "Please upload a valid DDEX file (.zip, .xlsx, .xls, .csv, or .xml)"),
        ],
      });
      return;
    }

    // Phase 1: Validate DDEX compliance
    setDdexProgress({
      show: true,
      mode: "validate",
      phase: "validating",
      title: `Validating ${file.name}`,
      progress: 10,
      currentItem: "Checking DDEX compliance...",
      items: [{ name: "DDEX Validation", status: "processing" }],
      summary: "",
      errors: [],
    });

    const validateFormData = new FormData();
    validateFormData.append("file", file);
    validateFormData.append("format", format);
    validateFormData.append("validateOnly", "true");

    try {
      const vRes = await fetch("/api/releases/import", {
        method: "POST",
        body: validateFormData,
      });
      const vData = await vRes.json();

      if (!vRes.ok) {
        setDdexProgress((prev) => ({
          ...prev,
          phase: "error",
          progress: 100,
          currentItem: "",
          items: [
            { name: "DDEX Validation", status: "error", error: vData.error },
          ],
          errors: vData.validation?.errors || [
            vData.error || "Validation failed",
          ],
          validation: vData.validation,
        }));
        return;
      }

      const validation = vData.validation;
      if (!validation?.isDdexCompliant) {
        setDdexProgress((prev) => ({
          ...prev,
          phase: "error",
          progress: 100,
          currentItem: "",
          items: [
            {
              name: "DDEX Validation",
              status: "error",
              error: "ERROR_NOT_DDEX_COMPLIANT",
            },
          ],
          errors: validation?.errors || ["File is not DDEX-compliant"],
          validation,
        }));
        return;
      }

      // Validation passed — show results and confirm
      setDdexProgress((prev) => ({
        ...prev,
        phase: "validating",
        progress: 30,
        currentItem: "Validation passed — checking files...",
        items: [{ name: "DDEX Validation", status: "done" }],
        validation,
        zipInfo: vData.zipInfo,
      }));

      // Phase 2: Dry run — check for missing files
      setImporting(true);
      const dryFormData = new FormData();
      dryFormData.append("file", file);
      dryFormData.append("format", format);
      dryFormData.append("dryRun", "true");

      const dRes = await fetch("/api/releases/import", {
        method: "POST",
        body: dryFormData,
      });
      const dData = await dRes.json();

      if (!dRes.ok) {
        setDdexProgress((prev) => ({
          ...prev,
          phase: "error",
          progress: 100,
          currentItem: "",
          items: [
            { name: "DDEX Validation", status: "done" },
            { name: "File Check", status: "error", error: dData.error },
          ],
          errors: [dData.error || "Dry run failed"],
        }));
        setImporting(false);
        return;
      }

      if (dData.missingFiles && dData.missingFiles.length > 0) {
        setMissingFiles(dData.missingFiles);
        setPendingImportFile(file);
        setDdexProgress((prev) => ({ ...prev, show: false }));
        setImporting(false);
        return;
      }

      // Phase 3: Show summary and wait for confirmation
      const summary = dData.summary;
      const releaseItems: typeof ddexProgress.items = [
        { name: "DDEX Validation", status: "done" },
        { name: "File Check", status: "done" },
      ];

      // Build items for each release (we'll track them during import)
      // We don't know release names from dry run, so we'll build the list
      const warnings = dData.warnings || [];

      setDdexProgress((prev) => ({
        ...prev,
        phase: "done",
        progress: 50,
        title: `Ready to Import: ${file.name}`,
        currentItem: "",
        items: releaseItems,
        summary:
          `${summary?.releases || 0} release(s), ${summary?.tracks || 0} track(s)` +
          (summary?.zipAudioExtracted > 0
            ? `, ${summary.zipAudioExtracted} audio files from ZIP`
            : "") +
          (warnings.length > 0 ? `\n ${warnings.length} warning(s)` : ""),
        errors: warnings,
      }));

      // Store the file for actual import — user clicks "Proceed" button in modal
      setPendingImportFile(file);
    } catch (e) {
      console.error(e);
      setDdexProgress((prev) => ({
        ...prev,
        phase: "error",
        progress: 100,
        currentItem: "",
        errors: [
          "Connection error: " +
            (e instanceof Error ? e.message : "Unknown error"),
        ],
      }));
      setImporting(false);
    } finally {
      if (sheetInputRef.current) sheetInputRef.current.value = "";
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  const handleDdexProceedImport = async () => {
    if (!pendingImportFile) return;
    await performImport(pendingImportFile);
    setPendingImportFile(null);
  };

  const performImport = async (file: File) => {
    // Auto-detect format from file extension
    const fileName = file.name.toLowerCase();
    let format: "xlsx" | "csv" | "xml" | "zip";

    if (fileName.endsWith(".zip")) {
      format = "zip";
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      format = "xlsx";
    } else if (fileName.endsWith(".csv")) {
      format = "csv";
    } else if (fileName.endsWith(".xml")) {
      format = "xml";
    } else {
      setDdexProgress((prev) => ({
        ...prev,
        phase: "error",
        errors: [t("ddex.invalidFormat", "Invalid file format")],
      }));
      setImporting(false);
      return;
    }

    setImporting(true);
    setDdexProgress((prev) => ({
      ...prev,
      show: true,
      mode: "import",
      phase: "importing",
      title: `Importing ${file.name}`,
      progress: 0,
      currentItem: "Uploading and processing...",
      items: [{ name: "Upload file", status: "processing" }],
      summary: "",
      errors: [],
    }));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("format", format);
    formData.append("dryRun", "false");

    try {
      // Use XMLHttpRequest for upload progress tracking
      const data: any = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/releases/import");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const uploadPct = Math.round((e.loaded / e.total) * 40); // 0-40% for upload
            setDdexProgress((prev) => ({
              ...prev,
              progress: uploadPct,
              currentItem: `Uploading... ${Math.round((e.loaded / e.total) * 100)}%`,
            }));
          }
        };

        xhr.onload = () => {
          setDdexProgress((prev) => ({
            ...prev,
            progress: 50,
            currentItem: "Processing releases...",
            items: [
              { name: "Upload file", status: "done" },
              { name: "Processing", status: "processing" },
            ],
          }));
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(result);
            } else {
              reject(new Error(result.error || "Import failed"));
            }
          } catch {
            reject(new Error("Failed to parse response"));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });

      const r = data.results || {};

      // Build per-item results
      const resultItems: typeof ddexProgress.items = [
        { name: "Upload file", status: "done" },
      ];

      if (r.releases?.created > 0)
        resultItems.push({
          name: `${r.releases.created} release(s) created`,
          status: "done",
        });
      if (r.tracks?.created > 0)
        resultItems.push({
          name: `${r.tracks.created} track(s) created`,
          status: "done",
        });
      if (r.assets?.created > 0)
        resultItems.push({
          name: `${r.assets.created} asset(s) created`,
          status: "done",
        });
      if (r.assets?.linked > 0)
        resultItems.push({
          name: `${r.assets.linked} asset(s) linked`,
          status: "done",
        });
      if (r.compositions?.created > 0)
        resultItems.push({
          name: `${r.compositions.created} composition(s) created`,
          status: "done",
        });
      if (r.artists?.created > 0)
        resultItems.push({
          name: `${r.artists.created} new artist(s)`,
          status: "done",
        });
      if (r.labels?.created > 0)
        resultItems.push({
          name: `${r.labels.created} new label(s)`,
          status: "done",
        });
      if (r.releases?.failed > 0)
        resultItems.push({
          name: `${r.releases.failed} release(s) failed`,
          status: "error",
        });
      if (r.tracks?.failed > 0)
        resultItems.push({
          name: `${r.tracks.failed} track(s) failed`,
          status: "error",
        });

      const hasErrors =
        (r.releases?.failed || 0) > 0 || (r.tracks?.failed || 0) > 0;

      setDdexProgress((prev) => ({
        ...prev,
        phase: "done",
        progress: 100,
        title: hasErrors ? "Import Completed with Errors" : "Import Complete",
        currentItem: "",
        items: resultItems,
        summary: data.message || "",
        errors: r.errors || [],
      }));

      fetchReleases();
      setMissingFiles([]);
      setPendingImportFile(null);
    } catch (e) {
      console.error(e);
      setDdexProgress((prev) => ({
        ...prev,
        phase: "error",
        progress: 100,
        currentItem: "",
        items: [
          {
            name: "Import",
            status: "error",
            error: e instanceof Error ? e.message : "Unknown error",
          },
        ],
        errors: [e instanceof Error ? e.message : "Import failed"],
      }));
    } finally {
      setImporting(false);
    }
  };

  const handleUploadMissingFile = async (missingFile: {
    type: "audio" | "artwork";
    filename: string;
  }) => {
    if (!currentFile) return;

    setUploadingMissingFiles(true);
    const formData = new FormData();
    formData.append("file", currentFile);

    try {
      const endpoint =
        missingFile.type === "audio" ? "/upload/audio" : "/upload/covers";
      const res = await fetch(`${UPLOAD_SERVER}${endpoint}`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        // Remove this file from missing list
        setMissingFiles((prev) =>
          prev.filter((f) => f.filename !== missingFile.filename),
        );
        setCurrentFile(null);

        // If no more missing files, proceed with import
        if (missingFiles.length === 1 && pendingImportFile) {
          await performImport(pendingImportFile);
        }
      } else {
        const data = await res.json();
        alert(t("settings.uploadFailed") + ": " + translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      alert(
        "Upload failed: " + (e instanceof Error ? e.message : "Unknown error"),
      );
    } finally {
      setUploadingMissingFiles(false);
    }
  };

  // ============ RELEASE FORM VALIDATION ============
  const validateReleaseStep = (
    step: number,
    data: typeof formData,
  ): string[] => {
    const errors: string[] = [];

    const isValidEAN13 = (ean: string) => {
      if (!/^\d{12,13}$/.test(ean)) return false;
      const paddedEan = ean.padStart(13, "0");
      const digits = paddedEan.split("").map(Number);
      const sum =
        digits[0] +
        digits[2] +
        digits[4] +
        digits[6] +
        digits[8] +
        digits[10] +
        (digits[1] +
          digits[3] +
          digits[5] +
          digits[7] +
          digits[9] +
          digits[11]) *
          3;
      const checkDigit = (10 - (sum % 10)) % 10;
      return digits[12] === checkDigit;
    };

    if (step === 1) {
      if (!data.title.trim()) errors.push("• Product Name is required");
      if (!data.coverUrl)
        errors.push(
          "- Cover artwork is required — distributors and stores will reject releases without artwork",
        );
      if (data.primaryArtists.length === 0)
        errors.push("• At least one Primary Artist is required");
      if (!data.upc && !data.upcAutoGenerate)
        errors.push(
          "• UPC/EAN is required — check 'I don't have UPC' if you don't have one",
        );
      if (data.upc && !isValidEAN13(data.upc))
        errors.push("• UPC/EAN must be a valid 12 or 13 digit GS1 code (Check Digit mismatch)");

      if (data.releaseType === "VIDEO") {
        const bannedTerms = /explicit version|clean version|lyric video/i;
        if (bannedTerms.test(data.title)) errors.push("• VEVO Policy: 'Explicit Version', 'Clean Version', or 'Lyric Video' cannot be in the title");
        if (data.subtitle && bannedTerms.test(data.subtitle)) errors.push("• VEVO Policy: Banned terms in subtitle");
      }
    }

    if (step === 2) {
      if (!data.genre) errors.push("• Genre is required");
      if (!data.labelId) errors.push("• Imprint / Label is required");
      if (!data.cLine.trim())
        errors.push(
          "• © Line (Copyright) is required — e.g. '2026 Label Name'",
        );
      if (!data.pLine.trim())
        errors.push(
          "• ℗ Line (Phonogram) is required — e.g. '2026 Label Name'",
        );
    }

    if (step === 3) {
      if (data.tracks.length === 0) {
        errors.push("• At least one track is required");
      } else {
        data.tracks.forEach((track, i) => {
          const num = i + 1;
          if (!track.title.trim())
            errors.push(`• Track ${num}: Title is required`);
          if (!track.audioAssetId)
            errors.push(
              `• Track ${num}: ${data.releaseType === "VIDEO" ? "Video" : "Audio"} file is required — upload or select from library`,
            );
          // Only require Primary Artist and ISRC for Track 1
          if (i === 0) {
            if (track.primaryArtists.length === 0)
              errors.push(
                `• Track ${num}: At least one Primary Artist is required`,
              );
            if (!track.isrc && !track.isrcAutoGenerate)
              errors.push(
                `• Track ${num}: ISRC is required — check 'I don't have ISRC' if you don't have one`,
              );
            if (
              track.isrc &&
              !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc.toUpperCase())
            )
              errors.push(
                `• Track ${num}: ISRC format invalid (e.g. USRC12345678)`,
              );
          }

            // Video Constraints for VEVO
            if (data.releaseType === "VIDEO") {
              const bannedTerms = /explicit version|clean version|lyric video/i;
              if (bannedTerms.test(track.title)) errors.push(`• Track ${num}: VEVO Policy prohibits 'Explicit Version', 'Clean Version', or 'Lyric Video' in track titles`);
              if (!track.vevoEndCredits) errors.push(`• Track ${num}: Must confirm VEVO end credits policy`);
              if (!track.vevoNoLetterboxing) errors.push(`• Track ${num}: Must confirm VEVO letterboxing policy`);
            }
          });
        }
      // Format-specific validation
      if (data.format === "SINGLE" && data.tracks.length > 3) {
        errors.push("• Single format should have no more than 3 tracks");
      }
      if (data.format === "EP" && data.tracks.length > 6) {
        errors.push("• EP format should have no more than 6 tracks");
      }
    }

    if (step === 4) {
      if (!data.releaseDate) errors.push("• Release Date is required");
      if (!data.salesDate) errors.push("• Sales Start Date is required");
      if (
        data.releaseDate &&
        data.salesDate &&
        new Date(data.salesDate) > new Date(data.releaseDate)
      ) {
        errors.push("• Sales Start Date cannot be after Release Date");
      }
      if (data.preOrderType === "SPECIFIC_DATE" && !data.preOrderDate) {
        errors.push(
          "• Pre-order date is required when pre-order type is set to specific date",
        );
      }
      if (data.territories.length === 0) {
        errors.push(
          "• At least one territory must be selected for distribution",
        );
      }
    }

    return errors;
  };

  const validateReleaseAll = (
    data: typeof formData,
  ): { errors: string[]; failedStep: number } => {
    for (let step = 1; step <= 4; step++) {
      const errors = validateReleaseStep(step, data);
      if (errors.length > 0) return { errors, failedStep: step };
    }
    return { errors: [], failedStep: 0 };
  };

  // Create Form View (Multi-step Wizard)
  if (view === "create") {
    const totalSteps = 4;
    const stepTitles = [
      "Basics & Artwork",
      "Details",
      "Tracks",
      "Scheduling & Pricing",
    ];

    const nextStep = () => {
      // Validate current step before proceeding
      const errors = validateReleaseStep(currentStep, formData);
      if (errors.length > 0) {
        setFormError(errors.join("\n"));
        return;
      }
      setFormError("");
      if (currentStep < totalSteps) setCurrentStep(currentStep + 1);
    };

    const prevStep = () => {
      setFormError("");
      if (currentStep > 1) setCurrentStep(currentStep - 1);
    };

    return (
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setView("list")}
            className="p-2 hover: rounded-lg transition-colors"
          >
            <ArrowBackIcon size={24} />
          </button>
          <div>
            <h2 className="text-xl font-medium">{t("heading.createNewRelease", "Create New Release")}</h2>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              Step {currentStep} of {totalSteps}: {stepTitles[currentStep - 1]}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-8 max-w-4xl">
          <div className="flex items-center gap-2">
            {[...Array(totalSteps)].map((_, i) => (
              <div key={i} className="flex-1">
                <div
                  className={`h-2 rounded-full transition-colors ${
                    i + 1 <= currentStep ? "bg-[var(--accent)]" : ""
                  }`}
                />
                <p
                  className={`text-xs mt-1 ${
                    i + 1 === currentStep
                      ? "text-[var(--text-primary)] font-medium"
                      : "text-[var(--text-disabled)]"
                  }`}
                >
                  {stepTitles[i]}
                </p>
              </div>
            ))}
          </div>
        </div>

        {formError && (
          <div className="mb-4 p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm max-w-4xl whitespace-pre-line">
            {formError}
          </div>
        )}

        <form className="max-w-4xl" onSubmit={handleSubmit}>
          {/* Step 1: Basics & Artwork */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">{t("heading.basicsArtwork", "Basics & Artwork")}</h3>

              {/* Artwork & Top Fields Layout */}
              <div className="flex flex-col md:flex-row gap-6 mb-6">
                {/* Artwork Upload - Left Side */}
                <div className="flex-shrink-0">
                  <ImageUpload
                    currentUrl={formData.coverUrl}
                    onUpload={(url) =>
                      setFormData({ ...formData, coverUrl: url })
                    }
                    type="covers"
                    entityName={formData.title || "Draft Release"}
                    releaseTitle={formData.title || "Draft Release"}
                    labelName={
                      formData.labelId
                        ? labels.find((l: any) => l.id === formData.labelId)
                            ?.name || "Independent"
                        : "Independent"
                    }
                    artistName={
                      formData.primaryArtists?.[0]
                        ? artists.find(
                            (a: any) => a.id === formData.primaryArtists[0],
                          )?.name || "Unknown Artist"
                        : "Unknown Artist"
                    }
                  />

                  <details className="mt-4 group">
                    <summary className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer list-none flex items-center gap-2 select-none">
                      <span className="w-4 h-4 flex items-center justify-center transition-transform group-open:rotate-180">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </span>
                      Advanced DSP Artwork
                    </summary>
                    <div className="pt-4 space-y-4">
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-2">Apple Music Motion</label>
                        <ImageUpload
                          currentUrl={formData.motionUrl}
                          onUpload={(url) => setFormData({ ...formData, motionUrl: url })}
                          type="covers"
                          entityName="Apple Music Motion"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-2">Tidal Focus Artwork</label>
                        <ImageUpload
                          currentUrl={formData.tidalArtworkUrl}
                          onUpload={(url) => setFormData({ ...formData, tidalArtworkUrl: url })}
                          type="covers"
                          entityName="Tidal Artwork"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-2">Amazon Hi-Res Artwork</label>
                        <ImageUpload
                          currentUrl={formData.amazonArtworkUrl}
                          onUpload={(url) => setFormData({ ...formData, amazonArtworkUrl: url })}
                          type="covers"
                          entityName="Amazon Artwork"
                        />
                      </div>
                    </div>
                  </details>
                </div>

                {/* Top Fields - Right Side */}
                <div className="flex-1 grid grid-cols-1 gap-6">
                  {/* Release Type */}
                  {/* Release Type (Disabled/Hidden) */}
                  <div className="hidden">
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.releaseType", "Release Type")}
                    </label>
                    <input
                      type="text"
                      value={formData.releaseType}
                      disabled
                      className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-input)] rounded-lg text-[var(--text-tertiary)] cursor-not-allowed"
                    />
                  </div>

                  {/* Format (for Audio only, forced to SINGLE for Video) */}
                  {formData.releaseType === "AUDIO" ? (
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                        {t("form.format", "Format *")}
                      </label>
                      <select
                        value={formData.format}
                        onChange={(e) =>
                          setFormData({ ...formData, format: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      >
                        <option value="SINGLE">{t("release.single", "Single")}</option>
                        <option value="EP">{t("release.ep", "EP")}</option>
                        <option value="ALBUM">{t("release.album", "Album")}</option>
                      </select>
                    </div>
                  ) : (
                    <div className="hidden">
                       <input type="hidden" value="SINGLE" />
                    </div>
                  )}

                  {/* Meta Language */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.metaLanguage", "Meta Language *")}
                    </label>
                    <select
                      value={formData.metaLanguage}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          metaLanguage: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Title */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-[var(--text-tertiary)]">
                      {t("form.productName", "Product Name *")}
                    </label>
                  </div>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.releaseTitle", "Release title")}
                  />
                  <div className="mt-4">
                    <LocalizedInput
                      label={t("releases.localizedNames")}
                      value={formData.titleLocalized || []}
                      onChange={(val) =>
                        setFormData({ ...formData, titleLocalized: val })
                      }
                      placeholder={t("form.placeholder.eGJapaneseKorean", "e.g. Japanese, Korean")}
                    />
                  </div>
                </div>

                {/* Title Version */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.titleVersion", "Title Version")}
                  </label>
                  <input
                    type="text"
                    value={formData.titleVersion}
                    onChange={(e) =>
                      setFormData({ ...formData, titleVersion: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.eGDeluxeEdition", "e.g., Deluxe Edition")}
                  />
                </div>

                {/* Release Code */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseCode", "Release Code")}
                  </label>
                  <input
                    type="text"
                    value={formData.releaseCode}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseCode: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.eGReleaseCode", "e.g. Release Code")}
                  />
                </div>

                {/* UPC */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-[var(--text-tertiary)]">
                      {t("form.uPC", "UPC *")}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.upcAutoGenerate}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            upcAutoGenerate: e.target.checked,
                            upc: e.target.checked ? "" : formData.upc,
                          })
                        }
                        className="w-4 h-4 text-[var(--accent)]"
                      />
                      <span className="text-sm text-[var(--text-tertiary)]">
                        I don't have UPC
                      </span>
                    </label>
                  </div>
                  <input
                    type="text"
                    value={formData.upc}
                    onChange={(e) =>
                      setFormData({ ...formData, upc: e.target.value })
                    }
                    disabled={formData.upcAutoGenerate}
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder={t("form.placeholder.eGUPC", "e.g. UPC")}
                  />
                </div>

                {/* Primary Artist(s) */}
                <div className="md:col-span-2">
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
                              setFormData({
                                ...formData,
                                primaryArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.primaryArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              primaryArtists: newArtists,
                            });
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
                        setFormData({
                          ...formData,
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

                {/* Featuring Artist(s) */}
                <div className="md:col-span-2">
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
                              setFormData({
                                ...formData,
                                featuringArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.featuringArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              featuringArtists: newArtists,
                            });
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
                        setFormData({
                          ...formData,
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

                {/* Remixer */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.remixer", "Remixer")}
                  </label>
                  <input
                    type="text"
                    value={formData.remixer}
                    onChange={(e) =>
                      setFormData({ ...formData, remixer: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.remixerName", "Remixer name")}
                  />
                </div>

                {/* Producer */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.producer", "Producer")}
                  </label>
                  <input
                    type="text"
                    value={formData.producer}
                    onChange={(e) =>
                      setFormData({ ...formData, producer: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.producerName", "Producer name")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Details */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">{t("heading.releaseDetails", "Release Details")}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Distributor / Owner */}
                <div>
                  <SearchableEntitySelect
                    value={formData.ownerId}
                    onChange={(entityId) => setFormData({ ...formData, ownerId: entityId })}
                    entities={entities}
                    label={t("form.ownerDistributor", "Distributor / Owner *")}
                    placeholder={t("form.placeholder.selectOwner", "Select Distributor or Label")}
                  />
                  <p className="text-xs text-[var(--text-disabled)] mt-2">
                    Select the organization or sub-account that owns this release.
                  </p>
                </div>

                {/* Genre */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.genre", "Genre *")}
                  </label>
                  <select
                    value={formData.genre}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        genre: e.target.value,
                        subGenre: "",
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {MUSIC_GENRES.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sub Genre */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.subGenre", "Sub-Genre")}
                  </label>
                  <select
                    value={formData.subGenre}
                    onChange={(e) =>
                      setFormData({ ...formData, subGenre: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      !formData.genre ||
                      !MUSIC_GENRES.find((g) => g.value === formData.genre)
                        ?.subgenres
                    }
                  >
                    {formData.genre &&
                      MUSIC_GENRES.find(
                        (g) => g.value === formData.genre,
                      )?.subgenres?.map((sg) => (
                        <option key={sg} value={sg}>
                          {sg}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Label (Imprint) */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.imprintLabel", "Imprint (Label) *")}
                  </label>
                  <SearchableLabelSelect
                    value={formData.labelId}
                    onChange={(labelId) =>
                      setFormData({ ...formData, labelId })
                    }
                    labels={labels}
                    onCreateLabel={handleCreateLabel}
                    placeholder={t("form.placeholder.selectImprint", "Select imprint")}
                  />
                </div>

                {/* Format (if not set in step 1) */}
                {!formData.format && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.format", "Format *")}
                    </label>
                    <select
                      value={formData.format}
                      onChange={(e) =>
                        setFormData({ ...formData, format: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    >
                      <option value="SINGLE">{t("release.single", "Single")}</option>
                      <option value="EP">{t("release.ep", "EP")}</option>
                      <option value="ALBUM">{t("release.album", "Album")}</option>
                    </select>
                  </div>
                )}

                {/* C-Line */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "© Line *")}
                  </label>
                  <input
                    type="text"
                    value={formData.cLine}
                    onChange={(e) =>
                      setFormData({ ...formData, cLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026TheRebelsADivisionOfBeAlphaDistributedByADEDMusicGroupLLC", "2026 The Rebels, a division of beAlpha / Distributed by ADED Music Group LLC")}
                  />
                </div>

                {/* P-Line */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "℗ Line *")}
                  </label>
                  <input
                    type="text"
                    value={formData.pLine}
                    onChange={(e) =>
                      setFormData({ ...formData, pLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026LabelName", "℗ 2026 Label Name")}
                  />
                </div>

                {/* Contract Period */}
                <div className="md:col-span-2 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-surface)] space-y-4">
                  <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                    Contract Period
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-[var(--text-tertiary)] mb-2">
                        {t("form.begins", "Begins *")}
                      </label>
                      <input
                        type="date"
                        value={formData.contractPeriod?.begins || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            contractPeriod: {
                              ...formData.contractPeriod,
                              begins: e.target.value,
                            },
                          })
                        }
                        className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm text-[var(--text-tertiary)]">
                          {t("form.ends", "Ends *")}
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={
                              formData.contractPeriod?.ends === "perpetuity"
                            }
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                contractPeriod: {
                                  ...formData.contractPeriod,
                                  ends: e.target.checked ? "perpetuity" : "",
                                },
                              })
                            }
                            className="w-3.5 h-3.5 text-[var(--accent)]"
                          />
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {t("releases.perpetuity")}
                          </span>
                        </label>
                      </div>
                      <input
                        type="date"
                        value={
                          formData.contractPeriod?.ends === "perpetuity"
                            ? ""
                            : formData.contractPeriod?.ends || ""
                        }
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            contractPeriod: {
                              ...formData.contractPeriod,
                              ends: e.target.value,
                            },
                          })
                        }
                        disabled={
                          formData.contractPeriod?.ends === "perpetuity"
                        }
                        className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Tracks */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">
                {formData.releaseType === "VIDEO" ? "Video Asset & Details" : t("releases.tracks")}
              </h3>

              {/* Track Forms */}
              <div className="space-y-4">
                {formData.tracks.map((track, index) => (
                  <TrackForm
                    key={index}
                    track={track}
                    trackNumber={index + 1}
                    assets={assets}
                    artists={artists}
                    releaseId={selectedRelease?.id}
                    releaseType={formData.releaseType as "AUDIO" | "VIDEO"}
                    labelId={formData.labelId}
                    releaseTitle={formData.title}
                    releaseDate={formData.releaseDate}
                    onUpdate={(updatedTrack) => {
                      const newTracks = [...formData.tracks];
                      newTracks[index] = updatedTrack;
                      setFormData({ ...formData, tracks: newTracks });
                    }}
                    onDelete={() => {
                      const newTracks = formData.tracks.filter(
                        (_, i) => i !== index,
                      );
                      setFormData({ ...formData, tracks: newTracks });
                    }}
                    onCreateArtist={handleCreateArtist}
                    onAssetUploaded={(assetId, filename, duration) => {
                      // Refresh assets list
                      fetchAssets();
                    }}
                  />
                ))}
              </div>

              {/* Add Track Button */}
              <button
                type="button"
                onClick={() =>
                  setFormData({
                    ...formData,
                    tracks: [
                      ...formData.tracks,
                      {
                        audioAssetId: "",
                        snippetStart: "00:00:30",
                        snippetEnd: "00:01:30",
                        title: "",
                        version: "",
                        audioLanguage: "",
                        lyricsLanguage: "",
                        explicitContent: "NONE" as const,
                        lyrics: "",
                        vevoEndCredits: false,
                        vevoNoLetterboxing: false,
                        primaryArtists: [],
                        featuringArtists: [],
                        remixer: "",
                        composer: "",
                        producer: "",
                        iswc: "",
                        splits: [],
                        contributors: {
                          performers: [],
                          studioPersonnel: [],
                          labelPersonnel: [],
                          compositional: [],
                        },
                        cLine: formData.cLine || "",
                        pLine: formData.pLine || "",
                        isrc: "",
                        isrcAutoGenerate: false,
                        ownership: "ORIGINAL_MASTER" as const,
                        countryOfRecording: "",
                        nationalityOfOwner: "",
                      },
                    ],
                  })
                }
                className="flex items-center gap-2 px-4 py-3 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm font-medium transition-colors w-full justify-center"
              >
                <AddIcon size={18} />
                {formData.releaseType === "VIDEO" ? "Add Video Track" : "Add Audio Track"}
              </button>
            </div>
          )}

          {/* Step 4: Scheduling & Pricing */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">{t("heading.schedulingPricing", "Scheduling & Pricing")}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Release Date & Time */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseDate", "Release Date *")}
                  </label>
                  <input
                    type="date"
                    value={formData.releaseDate}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  <p className="text-xs text-[var(--text-disabled)] mt-2">
                    Digital Release Date
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.originalReleaseDate", "Original Release Date")}
                  </label>
                  <input
                    type="date"
                    value={formData.originalReleaseDate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        originalReleaseDate: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  <p className="text-xs text-[var(--text-disabled)] mt-2">
                    If different from Digital Release Date
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseNotesPitchingNote", "Release Notes / Pitching Note")}
                  </label>
                  <textarea
                    value={formData.releaseNotes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        releaseNotes: e.target.value,
                      })
                    }
                    rows={4}
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                    placeholder={t("form.placeholder.enterSpecialInstructionsAlbumLinerNotesOrSpotifyPitchDescriptionsHere", "Enter special instructions, album liner notes, or Spotify pitch descriptions here...")}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseTime", "Release Time")}
                  </label>
                  <input
                    type="time"
                    value={formData.releaseTime}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseTime: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>

                {/* Sales Date & Time */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.salesDate", "Sales Date *")}
                  </label>
                  <input
                    type="date"
                    value={formData.salesDate}
                    onChange={(e) =>
                      setFormData({ ...formData, salesDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.salesTime", "Sales Time")}
                  </label>
                  <input
                    type="time"
                    value={formData.salesTime}
                    onChange={(e) =>
                      setFormData({ ...formData, salesTime: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>

                {/* Pre-Order Info */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.preOrder", "Pre-Order")}
                  </label>
                  <select
                    value={formData.preOrderType}
                    onChange={(e) =>
                      setFormData({ ...formData, preOrderType: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="IMMEDIATE">{t("dashboard.immediate")}</option>
                    <option value="NO_PRE_ORDER">{t("dashboard.noPreOrder")}</option>
                    <option value="SPECIFIC_DATE">{t("dashboard.specificDate")}</option>
                  </select>
                </div>

                {/* Previewable (if pre-order) */}
                {formData.preOrderType !== "NO_PRE_ORDER" && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.previewable", "Previewable")}
                    </label>
                    <div className="flex items-center gap-4 mt-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          value="YES"
                          checked={formData.previewable === "YES"}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              previewable: e.target.value,
                            })
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-[var(--text-primary)]">{t("common.yes")}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          value="NO"
                          checked={formData.previewable === "NO"}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              previewable: e.target.value,
                            })
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-[var(--text-primary)]">{t("common.no")}</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Album Pricing */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.albumPricing", "Album Pricing")}
                  </label>
                  <select
                    value={formData.albumPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, albumPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {ALBUM_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Track Pricing */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.trackPricing", "Track Pricing")}
                  </label>
                  <select
                    value={formData.trackPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, trackPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {TRACK_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Territory Selection */}
              <div className="mt-6">
                <h4 className="text-sm font-medium text-[var(--text-tertiary)] mb-3">
                  Territory Restrictions
                </h4>
                <p className="text-xs text-[var(--text-disabled)] mb-3">
                  All territories selected by default. Uncheck to restrict.
                </p>
                <div className="max-h-60 overflow-y-auto border border-[var(--border-primary)] rounded-lg p-4 ">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {COUNTRY_CODES.map((country) => (
                      <label
                        key={country.code}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={formData.territories.includes(country.code)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                territories: [
                                  ...formData.territories,
                                  country.code,
                                ],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                territories: formData.territories.filter(
                                  (t) => t !== country.code,
                                ),
                              });
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-[var(--text-primary)]">
                          {country.flag} {country.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Publishing Obligations per Track */}
              {formData.tracks.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-[var(--text-tertiary)] mb-3">
                    Publishing Obligations
                  </h4>
                  <div className="space-y-4">
                    {formData.tracks.map((track, index) => (
                      <div
                        key={index}
                        className="p-4 border border-[var(--border-input)] rounded-lg"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-[var(--text-tertiary)] text-sm">
                            Track {index + 1}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-[var(--text-disabled)] mb-2">
                              {t("form.publishingObligation", "Publishing Obligation")}
                            </label>
                            <select
                              value={track.publishingObligation}
                              onChange={(e) => {
                                const newTracks = [...formData.tracks];
                                newTracks[index] = {
                                  ...track,
                                  publishingObligation: e.target.value,
                                };
                                setFormData({ ...formData, tracks: newTracks });
                              }}
                              className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                            >
                              <option value="NO_PUBLISHING">
                                No Publishing
                              </option>
                              <option value="PARTIAL">
                                Partial Publishing
                              </option>
                              <option value="FULL">{t("dashboard.fullPublishing")}</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--text-disabled)] mb-2">
                              {t("form.publisher", "Publisher")}
                            </label>
                            <input
                              type="text"
                              value={track.publisher}
                              onChange={(e) => {
                                const newTracks = [...formData.tracks];
                                newTracks[index] = {
                                  ...track,
                                  publisher: e.target.value,
                                };
                                setFormData({ ...formData, tracks: newTracks });
                              }}
                              className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                              placeholder={t("form.placeholder.publisherName", "Publisher name")}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-[var(--border-primary)]">
            <button
              type="button"
              onClick={prevStep}
              disabled={currentStep === 1}
              className="px-6 py-3  hover: rounded-lg text-[var(--text-primary)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("common.previous")}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setView("list")}
                className="px-6 py-3 border border-[var(--border-primary)] hover: rounded-lg text-[var(--text-primary)] font-medium transition-colors"
              >
                {t("common.cancel")}
              </button>

              {currentStep < totalSteps ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white font-medium transition-colors"
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Release"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    );
  }

  // Edit Form View (full edit form with all fields)
  if (view === "edit") {
    return (
      <div className="p-6">
        {/* Header with Back button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setView("list")}
            className="p-2 hover: rounded-lg transition-colors"
          >
            <ArrowBackIcon size={24} />
          </button>
          <h2 className="text-xl font-medium">
            Edit: {selectedRelease?.title}
          </h2>
          {selectedRelease?.status && (
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                selectedRelease.status === "APPROVED" ||
                selectedRelease.status === "RELEASED"
                  ? "bg-[var(--status-success-surface)] text-[var(--accent-text)]"
                  : selectedRelease.status === "PENDING"
                    ? "bg-[var(--status-warning-surface)] text-[var(--status-warning)]"
                    : selectedRelease.status === "DENIED"
                      ? "bg-[var(--status-error-surface)] text-[var(--status-error)]"
                      : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
              }`}
            >
              {selectedRelease.status}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="max-w-4xl">
          {formError && (
            <div className="mb-4 p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}

          <div className="space-y-8">
            {/* Section: Artwork & Basic Info */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("heading.artworkBasicInfo", "Artwork & Basic Info")}
              </h3>
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-shrink-0">
                  <ImageUpload
                    currentUrl={formData.coverUrl}
                    onUpload={(url) =>
                      setFormData({ ...formData, coverUrl: url })
                    }
                    type="covers"
                    entityName={formData.title || "Draft Release"}
                    labelName={
                      labels.find((l: any) => l.id === formData.labelId)
                        ?.name || "Unknown Label"
                    }
                    artistName={
                      artists.find(
                        (a: any) => a.id === formData.primaryArtists[0],
                      )?.name || "Unknown Artist"
                    }
                    releaseTitle={formData.title || "Unknown Release"}
                  />
                </div>
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.title", "Title *")}
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder={t("form.placeholder.releaseTitle", "Release title")}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                        {t("form.format", "Format *")}
                      </label>
                      <select
                        value={formData.format}
                        onChange={(e) =>
                          setFormData({ ...formData, format: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      >
                        <option value="SINGLE">{t("release.single", "Single")}</option>
                        <option value="EP">{t("release.ep", "EP")}</option>
                        <option value="ALBUM">{t("release.album", "Album")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                        {t("form.uPCEAN", "UPC/EAN")}
                      </label>
                      <input
                        type="text"
                        value={formData.upc}
                        onChange={(e) =>
                          setFormData({ ...formData, upc: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                        placeholder={t("form.placeholder.autoGeneratedIfEmpty", "Auto-generated if empty")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.metaLanguage", "Meta Language")}
                    </label>
                    <select
                      value={formData.metaLanguage}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          metaLanguage: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Artists */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("artists.title")}
              </h3>
              <div className="space-y-4">
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
                              setFormData({
                                ...formData,
                                primaryArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.primaryArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              primaryArtists: newArtists,
                            });
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
                        setFormData({
                          ...formData,
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
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.featuringArtists", "Featuring Artists")}
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
                              setFormData({
                                ...formData,
                                featuringArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.featuringArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              featuringArtists: newArtists,
                            });
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
                        setFormData({
                          ...formData,
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.remixer", "Remixer")}
                    </label>
                    <input
                      type="text"
                      value={formData.remixer}
                      onChange={(e) =>
                        setFormData({ ...formData, remixer: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder={t("form.placeholder.remixerName", "Remixer name")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.producer", "Producer")}
                    </label>
                    <input
                      type="text"
                      value={formData.producer}
                      onChange={(e) =>
                        setFormData({ ...formData, producer: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder={t("form.placeholder.producerName", "Producer name")}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Details */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("heading.details", "Details")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.genre", "Genre *")}
                  </label>
                  <select
                    value={formData.genre}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        genre: e.target.value,
                        subGenre: "",
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {MUSIC_GENRES.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.subGenre", "Sub-Genre")}
                  </label>
                  <select
                    value={formData.subGenre}
                    onChange={(e) =>
                      setFormData({ ...formData, subGenre: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    disabled={
                      !formData.genre ||
                      !MUSIC_GENRES.find((g) => g.value === formData.genre)
                        ?.subgenres
                    }
                  >
                    {formData.genre &&
                      MUSIC_GENRES.find(
                        (g) => g.value === formData.genre,
                      )?.subgenres?.map((sg) => (
                        <option key={sg} value={sg}>
                          {sg}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.imprintLabel", "Imprint (Label)")}
                  </label>
                  <SearchableLabelSelect
                    value={formData.labelId}
                    onChange={(labelId) =>
                      setFormData({ ...formData, labelId })
                    }
                    labels={labels}
                    onCreateLabel={handleCreateLabel}
                    placeholder={t("form.placeholder.selectImprint", "Select imprint")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.catalogueNumber", "Catalogue Number")}
                  </label>
                  <input
                    type="text"
                    value={formData.releaseCode}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseCode: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.catalogueNumber", "Catalogue number")}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "© Line")}
                  </label>
                  <input
                    type="text"
                    value={formData.cLine}
                    onChange={(e) =>
                      setFormData({ ...formData, cLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026LabelName", "2026 Label Name")}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "℗ Line")}
                  </label>
                  <input
                    type="text"
                    value={formData.pLine}
                    onChange={(e) =>
                      setFormData({ ...formData, pLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026LabelName", "℗ 2026 Label Name")}
                  />
                </div>
              </div>
            </div>

            {/* Section: Scheduling */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("heading.schedulingPricing", "Scheduling & Pricing")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseDate", "Release Date *")}
                  </label>
                  <input
                    type="date"
                    value={formData.releaseDate}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.originalReleaseDate", "Original Release Date")}
                  </label>
                  <input
                    type="date"
                    value={formData.originalReleaseDate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        originalReleaseDate: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseNotesPitchingNote", "Release Notes / Pitching Note")}
                  </label>
                  <textarea
                    value={formData.releaseNotes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        releaseNotes: e.target.value,
                      })
                    }
                    rows={4}
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                    placeholder={t("form.placeholder.enterSpecialInstructionsAlbumLinerNotesOrSpotifyPitchDescriptionsHere", "Enter special instructions, album liner notes, or Spotify pitch descriptions here...")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseTime", "Release Time")}
                  </label>
                  <input
                    type="time"
                    value={formData.releaseTime}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseTime: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.salesDate", "Sales Date")}
                  </label>
                  <input
                    type="date"
                    value={formData.salesDate}
                    onChange={(e) =>
                      setFormData({ ...formData, salesDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.albumPricing", "Album Pricing")}
                  </label>
                  <select
                    value={formData.albumPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, albumPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {ALBUM_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.trackPricing", "Track Pricing")}
                  </label>
                  <select
                    value={formData.trackPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, trackPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {TRACK_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-[var(--border-primary)]">
            <button
              type="button"
              onClick={() => setView("list")}
              className="px-6 py-3  hover: rounded-lg text-[var(--text-primary)] font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // List View
  return (
    <div className="p-6">
      {/* Missing Files Upload Modal */}
      <Modal
        isOpen={missingFiles.length > 0}
        onClose={() => {
          setMissingFiles([]);
          setPendingImportFile(null);
          setCurrentFile(null);
        }}
        title={t("upload.uploadMissingFiles")}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-tertiary)]">
            The following files are referenced in your Excel but not found on
            the server. Please upload them to continue.
          </p>

          <div className="max-h-96 overflow-y-auto space-y-3">
            {missingFiles.map((file, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border transition-all ${dragState === `missing-file-${index}` ? "border-green-500 ring-2 ring-green-500/20" : "border-[var(--border-primary)]"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragState(`missing-file-${index}`);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragState(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragState(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setCurrentFile(f);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {file.type === "audio" ? (
                        <AudioFileIcon size={18} color="#a855f7" />
                      ) : (
                        <PhotoCameraIcon size={18} color="#3b82f6" />
                      )}
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {file.filename}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-disabled)]">
                      Release: {file.releaseTitle}
                    </p>
                    <p className="text-xs text-[var(--text-disabled)] mt-1">
                      Type: {file.type === "audio" ? "Audio File" : "Artwork"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept={file.type === "audio" ? "audio/*" : "image/*"}
                      onChange={(e) =>
                        setCurrentFile(e.target.files?.[0] || null)
                      }
                      className="text-xs"
                    />
                    <button
                      onClick={() => handleUploadMissingFile(file)}
                      disabled={!currentFile || uploadingMissingFiles}
                      className="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded text-xs font-medium transition-colors disabled:opacity-50 text-white"
                    >
                      {uploadingMissingFiles ? "Uploading..." : "Upload"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[var(--border-input)]">
            <p className="text-sm text-[var(--text-tertiary)]">
              {missingFiles.length} file(s) remaining
            </p>
            <button
              onClick={() => {
                setMissingFiles([]);
                setPendingImportFile(null);
                setCurrentFile(null);
              }}
              className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("upload.cancelImport")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ══════ DDEX Progress Modal ══════ */}
      <Modal
        isOpen={ddexProgress.show}
        onClose={() => {
          if (ddexProgress.phase === "done" || ddexProgress.phase === "error") {
            setDdexProgress((prev) => ({ ...prev, show: false }));
          }
        }}
        title={ddexProgress.title}
      >
        <div>
          {/* Progress Bar */}
          <div className="mb-4">
            <div className="h-2  rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  ddexProgress.phase === "error"
                    ? "bg-[var(--status-error)]"
                    : ddexProgress.phase === "done"
                      ? "bg-[#1DB954]"
                      : "bg-[#1DB954]"
                }`}
                style={{ width: `${ddexProgress.progress}%` }}
              />
            </div>
            {ddexProgress.currentItem && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
                {ddexProgress.currentItem}
              </p>
            )}
          </div>

          {/* Validation Info */}
          {ddexProgress.validation && (
            <div
              className={`mb-4 p-3 rounded-lg border ${
                ddexProgress.validation.isDdexCompliant
                  ? "bg-green-900/20 border-green-800/50"
                  : "bg-red-900/20 border-red-800/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-sm font-medium ${ddexProgress.validation.isDdexCompliant ? "text-[var(--accent-text)]" : "text-[var(--status-error)]"}`}
                >
                  {ddexProgress.validation.isDdexCompliant ? (
                    <>
                      <CheckCircleIcon
                        size={16}
                        className="text-[var(--accent)] inline-block mr-1"
                      />{" "}
                      DDEX Compliant
                    </>
                  ) : (
                    <>
                      <CancelIcon
                        size={16}
                        className="text-[var(--status-error)] inline-block mr-1"
                      />{" "}
                      Not DDEX Compliant
                    </>
                  )}
                </span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)] space-y-0.5">
                <div>
                  <BarChartIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--text-tertiary)]"
                  />{" "}
                  {ddexProgress.validation.totalRows} row(s),{" "}
                  {ddexProgress.validation.totalColumns} column(s)
                </div>
                <div>
                  <TagIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--status-info)]"
                  />{" "}
                  {ddexProgress.validation.presentDdexColumns} DDEX column(s)
                  recognized
                </div>
                {ddexProgress.validation.missingRequired.length > 0 && (
                  <div className="text-[var(--status-error)]">
                    <WarningIcon size={16} className="inline-block mr-1" />{" "}
                    Missing required:{" "}
                    {ddexProgress.validation.missingRequired.join(", ")}
                  </div>
                )}
                {ddexProgress.validation.missingRecommended.length > 0 && (
                  <div className="text-yellow-400">
                    <LightbulbIcon size={16} className="inline-block mr-1" />{" "}
                    Missing recommended:{" "}
                    {ddexProgress.validation.missingRecommended.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ZIP Info */}
          {ddexProgress.zipInfo && (
            <div className="mb-4 p-3 bg-cyan-900/20 border border-cyan-800/50 rounded-lg">
              <div className="text-xs text-[var(--text-tertiary)] space-y-0.5">
                <div>
                  <BoxArchiveIcon size={16} className="inline-block mr-1" /> ZIP
                  Package Contents:
                </div>
                <div className="ml-3">
                  <MusicNoteIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--color-deezer)]"
                  />{" "}
                  {ddexProgress.zipInfo.audioFiles} audio file(s)
                </div>
                <div className="ml-3">
                  <ImageIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--accent-text)]"
                  />{" "}
                  {ddexProgress.zipInfo.artworkFiles} artwork file(s)
                </div>
              </div>
            </div>
          )}

          {/* Item List */}
          {ddexProgress.items.length > 0 && (
            <div className="mb-4 space-y-1.5 max-h-48 overflow-y-auto">
              {ddexProgress.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {item.status === "done" ? (
                    <CheckIcon
                      size={12}
                      className="text-[var(--accent-text)]"
                    />
                  ) : item.status === "error" ? (
                    <XMarkIcon
                      size={12}
                      className="text-[var(--status-error)]"
                    />
                  ) : item.status === "processing" ? (
                    <RefreshIcon
                      size={12}
                      className="text-[var(--color-deezer)] animate-spin"
                    />
                  ) : (
                    <CircleIcon
                      size={12}
                      className="text-[var(--text-disabled)]"
                    />
                  )}
                  <span
                    className={`${
                      item.status === "error"
                        ? "text-[var(--status-error)]"
                        : item.status === "done"
                          ? "text-[var(--text-secondary)]"
                          : item.status === "processing"
                            ? "text-[var(--text-primary)]"
                            : "text-[var(--text-disabled)]"
                    }`}
                  >
                    {item.name}
                  </span>
                  {item.error && (
                    <span className="text-[var(--status-error)]/70 text-xs ml-auto truncate max-w-[200px]">
                      {item.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {ddexProgress.summary && (
            <div className="mb-4 p-3  rounded-lg">
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-line">
                {ddexProgress.summary}
              </p>
            </div>
          )}

          {/* Errors */}
          {ddexProgress.errors.length > 0 && (
            <div className="mb-4 max-h-32 overflow-y-auto">
              <div className="text-xs font-medium text-[var(--status-error)] mb-1">
                {ddexProgress.phase === "error" ? "Errors:" : "Warnings:"}
              </div>
              {ddexProgress.errors.map((err, i) => (
                <div
                  key={i}
                  className="text-xs text-[var(--status-error)]/80 py-0.5 flex items-start gap-1"
                >
                  <span className="mt-0.5">•</span>
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 justify-end pt-3 border-t border-[var(--border-primary)]">
            {ddexProgress.phase === "done" &&
              ddexProgress.mode === "validate" &&
              pendingImportFile && (
                <>
                  <button
                    onClick={() => {
                      setDdexProgress((prev) => ({ ...prev, show: false }));
                      setPendingImportFile(null);
                    }}
                    className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={handleDdexProceedImport}
                    className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors flex items-center gap-2 text-white"
                  >
                    <FileUploadIcon size={16} />
                    Proceed with Import
                  </button>
                </>
              )}
            {ddexProgress.phase === "done" &&
              ddexProgress.mode !== "validate" && (
                <button
                  onClick={() =>
                    setDdexProgress((prev) => ({ ...prev, show: false }))
                  }
                  className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
                >
                  Close
                </button>
              )}
            {ddexProgress.phase === "error" && (
              <button
                onClick={() =>
                  setDdexProgress((prev) => ({ ...prev, show: false }))
                }
                className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Hidden file inputs */}
      <input
        ref={sheetInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.xml"
        onChange={handleImportFile}
        className="hidden"
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        onChange={handleImportFile}
        className="hidden"
      />

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("releases.title")}</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDdexPanel((prev) => !prev)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${showDdexPanel ? "bg-[#1DB954] ring-2 ring-[#1ed760]" : "bg-[#1DB954] hover:brightness-110"}`}
          >
            <SwapHorizIcon size={18} />
            {t("releases.ddex")}
          </button>

          {canCreate && (
            <button
              onClick={openCreateForm}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors"
            >
              <AddIcon size={18} />
              {t("releases.newRelease")}
            </button>
          )}
        </div>
      </div>

      {/* DDEX Import / Export Panel */}
      {showDdexPanel && (
        <div className="mb-6 p-5 bg-[var(--bg-surface)] border border-[var(--border-primary)] shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <SwapHorizIcon size={18} color="#1DB954" />
              DDEX Import / Export
            </h3>
            <button
              onClick={() => setShowDdexPanel(false)}
              className="text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <CloseIcon size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ── Import Section ── */}
            <div className="p-4 bg-[var(--bg-background)] rounded-lg border border-[var(--border-primary)]">
              <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileUploadIcon size={14} />
                {t("common.import")}
              </h4>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => sheetInputRef.current?.click()}
                  disabled={importing}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragState("ddex-sheet");
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragState(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragState(null);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleImportFile(f);
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-[var(--bg-surface-hover)] border rounded-lg text-sm transition-all disabled:opacity-50 group ${dragState === "ddex-sheet" ? "bg-[var(--bg-surface-hover)] border-green-500" : "bg-[var(--bg-surface)] border-[var(--border-primary)]"}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--status-info)]/20 flex items-center justify-center group-hover:bg-[var(--status-info)]/30 transition-colors text-white">
                    <TableChartIcon size={16} color="#60a5fa" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {importing ? "Importing..." : "From Spreadsheet"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      .xlsx, .xls, .csv, .xml
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => zipInputRef.current?.click()}
                  disabled={importing}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragState("ddex-zip");
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragState(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragState(null);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleImportFile(f, "zip");
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-[var(--bg-surface-hover)] border rounded-lg text-sm transition-all disabled:opacity-50 group ${dragState === "ddex-zip" ? "bg-[var(--bg-surface-hover)] border-green-500" : "bg-[var(--bg-surface)] border-[var(--border-primary)]"}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center group-hover:bg-cyan-600/30 transition-colors">
                    <FolderZipIcon size={16} color="#22d3ee" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {importing ? "Importing..." : "From ZIP Package"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      {t("releases.spreadsheetAudioArtwork")}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Export Section ── */}
            <div className="p-4 bg-[var(--bg-background)] rounded-lg border border-[var(--border-primary)]">
              <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <DownloadIcon size={14} />
                {t("common.export")}
              </h4>
              <div className="flex flex-col gap-2">
                <button
                  onClick={async () => {
                    setExporting("xlsx");
                    setDdexProgress({
                      show: true,
                      mode: "export",
                      phase: "exporting",
                      title: "Exporting DDEX Spreadsheet",
                      progress: 20,
                      currentItem: "Generating XLSX...",
                      items: [
                        { name: "Generate spreadsheet", status: "processing" },
                      ],
                      summary: "",
                      errors: [],
                    });
                    try {
                      const res = await fetch(
                        `/api/releases/export?format=xlsx`,
                      );
                      if (res.ok) {
                        setDdexProgress((prev) => ({
                          ...prev,
                          progress: 80,
                          currentItem: "Downloading...",
                          items: [
                            { name: "Generate spreadsheet", status: "done" },
                            { name: "Download", status: "processing" },
                          ],
                        }));
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `beAlpha_DDEX_${new Date().toISOString().split("T")[0]}.xlsx`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "done",
                          progress: 100,
                          currentItem: "",
                          title: "Export Complete",
                          items: [
                            { name: "Generate spreadsheet", status: "done" },
                            { name: "Download", status: "done" },
                          ],
                          summary: "DDEX spreadsheet exported successfully.",
                        }));
                      } else {
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "error",
                          progress: 100,
                          currentItem: "",
                          items: [
                            {
                              name: "Export",
                              status: "error",
                              error: "Server error",
                            },
                          ],
                          errors: ["Failed to export releases"],
                        }));
                      }
                    } catch (e) {
                      console.error(e);
                      setDdexProgress((prev) => ({
                        ...prev,
                        phase: "error",
                        progress: 100,
                        currentItem: "",
                        items: [{ name: "Export", status: "error" }],
                        errors: [
                          "Connection error: " +
                            (e instanceof Error ? e.message : "Unknown error"),
                        ],
                      }));
                    } finally {
                      setExporting("");
                    }
                  }}
                  disabled={exporting !== ""}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded-lg text-sm transition-all disabled:opacity-50 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--status-info)]/20 flex items-center justify-center group-hover:bg-[var(--status-info)]/30 transition-colors text-white">
                    <TableChartIcon size={16} color="#60a5fa" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {exporting === "xlsx"
                        ? "Exporting..."
                        : "Spreadsheet (XLSX)"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      {t("releases.spreadsheetOnly")}
                    </div>
                  </div>
                </button>

                <button
                  onClick={async () => {
                    setExporting("zip");
                    setDdexProgress({
                      show: true,
                      mode: "export",
                      phase: "exporting",
                      title: "Exporting DDEX ZIP Package",
                      progress: 10,
                      currentItem:
                        "Building package (spreadsheet + audio + artwork)...",
                      items: [
                        { name: "Generate spreadsheet", status: "processing" },
                        { name: "Collect artwork files", status: "pending" },
                        { name: "Collect audio files", status: "pending" },
                        { name: "Compress ZIP", status: "pending" },
                      ],
                      summary: "",
                      errors: [],
                    });

                    // Simulate progress steps since server does it all at once
                    const progressTimer = setInterval(() => {
                      setDdexProgress((prev) => {
                        if (prev.phase !== "exporting") return prev;
                        const newProgress = Math.min(prev.progress + 5, 85);
                        let step = 0;
                        if (newProgress >= 20) step = 1;
                        if (newProgress >= 40) step = 2;
                        if (newProgress >= 60) step = 3;
                        const items = [...prev.items];
                        for (let i = 0; i < items.length; i++) {
                          if (i < step)
                            items[i] = { ...items[i], status: "done" };
                          else if (i === step)
                            items[i] = { ...items[i], status: "processing" };
                          else items[i] = { ...items[i], status: "pending" };
                        }
                        return {
                          ...prev,
                          progress: newProgress,
                          items,
                          currentItem:
                            step === 0
                              ? "Generating spreadsheet..."
                              : step === 1
                                ? "Collecting artwork files..."
                                : step === 2
                                  ? "Collecting audio files..."
                                  : "Compressing ZIP...",
                        };
                      });
                    }, 800);

                    try {
                      const res = await fetch(
                        `/api/releases/export?format=zip`,
                      );
                      clearInterval(progressTimer);
                      if (res.ok) {
                        setDdexProgress((prev) => ({
                          ...prev,
                          progress: 90,
                          currentItem: "Downloading...",
                          items: [
                            ...prev.items.map((i) => ({
                              ...i,
                              status: "done" as const,
                            })),
                            { name: "Download", status: "processing" as const },
                          ],
                        }));
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `beAlpha_DDEX_${new Date().toISOString().split("T")[0]}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "done",
                          progress: 100,
                          currentItem: "",
                          title: "Export Complete",
                          items: prev.items.map((i) => ({
                            ...i,
                            status: "done" as const,
                          })),
                          summary: `ZIP package exported successfully (${sizeMB} MB).`,
                        }));
                      } else {
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "error",
                          progress: 100,
                          currentItem: "",
                          items: prev.items.map((i) => ({
                            ...i,
                            status: "error" as const,
                          })),
                          errors: ["Failed to export ZIP package"],
                        }));
                      }
                    } catch (e) {
                      clearInterval(progressTimer);
                      console.error(e);
                      setDdexProgress((prev) => ({
                        ...prev,
                        phase: "error",
                        progress: 100,
                        currentItem: "",
                        items: prev.items.map((i) => ({
                          ...i,
                          status: "error" as const,
                        })),
                        errors: [
                          "Connection error: " +
                            (e instanceof Error ? e.message : "Unknown error"),
                        ],
                      }));
                    } finally {
                      setExporting("");
                    }
                  }}
                  disabled={exporting !== ""}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded-lg text-sm transition-all disabled:opacity-50 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center group-hover:bg-cyan-600/30 transition-colors">
                    <FolderZipIcon size={16} color="#22d3ee" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {exporting === "zip" ? "Exporting..." : "ZIP Package"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      {t("releases.spreadsheetAudioArtwork")}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <SearchIcon
            size={20}
            color="#6b7280"
            className="absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("releases.searchPlaceholder")}
            className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterListIcon size={20} color="#6b7280" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("dashboard.allStatus")}</option>
            <option value="PENDING">{t("statuses.pending")}</option>
            <option value="APPROVED">{t("statuses.approved")}</option>
            <option value="DENIED">{t("dashboard.denied")}</option>
            <option value="SCHEDULED">{t("dashboard.scheduled")}</option>
            <option value="RELEASED">{t("dashboard.released")}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : releases.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <AlbumIcon size={48} color="#525252" />
          <p className="mt-2">{t("releases.noReleases")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("dashboard.title")}</th>
                <th className="pb-3 font-medium">{t("releases.artist")}</th>
                <th className="pb-3 font-medium">{t("dashboard.type")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("releases.releaseDate")}</th>
                <th className="pb-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <tr
                  key={release.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      {release.cover && !release.cover.includes("picsum") ? (
                        <img
                          src={release.cover}
                          alt={release.title}
                          className="w-10 h-10 rounded object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-[#1DB954] to-[#169c46] rounded flex items-center justify-center">
                          <span className="text-lg font-bold text-white">
                            {release.title?.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <span className="font-medium">{release.title}</span>
                    </div>
                  </td>
                  <td className="py-4 text-[var(--text-secondary)]">
                    {release.artist || "-"}
                  </td>
                  <td className="py-4">
                    <span className="px-2 py-1  rounded text-sm capitalize">
                      {release.format?.toLowerCase() || "-"}
                    </span>
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${
                        release.status === "APPROVED" ||
                        release.status === "RELEASED"
                          ? "text-[var(--accent-text)] bg-[var(--status-success-surface)]"
                          : release.status === "PENDING" ||
                              release.status === "SCHEDULED"
                            ? "text-[var(--status-warning)] bg-[var(--status-warning-surface)]"
                            : release.status === "DENIED"
                              ? "text-[var(--status-error)] bg-[var(--status-error-surface)]"
                              : "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]"
                      }`}
                    >
                      {(release.status === "APPROVED" ||
                        release.status === "RELEASED") && (
                        <CheckCircleIcon size={14} />
                      )}
                      {(release.status === "PENDING" ||
                        release.status === "SCHEDULED") && (
                        <PendingIcon size={14} />
                      )}
                      {release.status === "DENIED" && <CancelIcon size={14} />}
                      <span className="capitalize">
                        {release.status?.toLowerCase() || "pending"}
                      </span>
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {release.releaseDate || "-"}
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-1">
                      {canApprove && release.status === "PENDING" && (
                        <>
                          <button
                            onClick={() => handleApprove(release.id)}
                            className="p-2 hover:bg-[var(--status-success-surface)] rounded-lg"
                            title={t("common.approve")}
                          >
                            <CheckCircleIcon size={18} color="#22c55e" />
                          </button>
                          <button
                            onClick={() => handleDeny(release.id)}
                            className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                            title={t("common.deny")}
                          >
                            <CancelIcon size={18} color="#ef4444" />
                          </button>
                        </>
                      )}
                      {canUpdate && (
                        <button
                          onClick={() => openEditForm(release)}
                          className="p-2 hover: rounded-lg"
                          title={t("common.edit")}
                        >
                          <EditIcon size={18} color="#a3a3a3" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(release.id)}
                          className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                          title={t("common.delete")}
                        >
                          <DeleteIcon size={18} color="#ef4444" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={(p) => setPage(p)}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
      />
    </div>
  );
}
