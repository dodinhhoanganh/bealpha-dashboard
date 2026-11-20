"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { IconDefinition, SizeProp } from "@fortawesome/fontawesome-svg-core";
import { faSpotify, faApple } from "@fortawesome/free-brands-svg-icons";
import {
  faGauge,
  faCompactDisc,
  faFileAudio,
  faBuilding,
  faUser,
  faChartBar,
  faDollarSign,
  faGear,
  faRightFromBracket,
  faUsers,
  faPlus,
  faMagnifyingGlass,
  faPenToSquare,
  faTrash,
  faCircleCheck,
  faClock,
  faCircleXmark,
  faFilter,
  faXmark,
  faCamera,
  faChevronDown,
  faArrowLeft,
  faCloudArrowUp,
  faFileArrowUp,
  faFileZipper,
  faTableCells,
  faArrowRightArrowLeft,
  faBars,
  faPaperPlane,
  faArrowsRotate,
  faDownload,
  faEye,
  faTruck,
  faChartLine,
  faMusic,
  faListUl,
  faCirclePlay,
  faClockRotateLeft,
  faLock,
  faLockOpen,
  faBell,
  faBellSlash,
  faGlobe,
  faFloppyDisk,
  faEyeSlash,
  faEnvelope,
  faPhone,
  faQrcode,
  faPlay,
  faPause,
  faUserPlus,
  faBan,
  faPeopleGroup,
  faCameraRetro,
  faTrashCan,
  faCheckDouble,
  faBullhorn,
  faTag,
  faMicrophone,
  faCheck,
  faTriangleExclamation,
  faCircleInfo,
  faClipboard,
  faHand,
  faArrowUpRightFromSquare,
  faCircle,
  faExclamation,
  faLightbulb,
  faImage,
  faBoxArchive,
  faRotate,
  faPalette,
  faDesktop,
  faMobileScreenButton,
  faCommentSms,
  faFilm,
} from "@fortawesome/free-solid-svg-icons";

// Re-export the party popper as celebration since FA doesn't have exact match
// Using faCakeCandles or faChampagneGlasses as alternative
import { faFaceSmileBeam } from "@fortawesome/free-regular-svg-icons";

interface IconProps {
  className?: string;
  style?: React.CSSProperties;
  size?: number;
  color?: string;
  onClick?: () => void;
  title?: string;
}

// Helper to create an icon component from a FontAwesome icon definition
function createIcon(icon: IconDefinition, displayName: string) {
  const Component = ({
    className,
    style,
    size,
    color,
    onClick,
    title,
  }: IconProps) => {
    const faSize =
      size && size <= 14
        ? ("xs" as SizeProp)
        : size && size <= 16
          ? ("sm" as SizeProp)
          : size && size <= 20
            ? ("lg" as SizeProp)
            : size && size >= 32
              ? ("xl" as SizeProp)
              : undefined;

    return (
      <FontAwesomeIcon
        icon={icon}
        className={className}
        style={{ fontSize: size ? `${size}px` : undefined, color, ...style }}
        size={faSize}
        onClick={onClick}
        title={title}
      />
    );
  };
  Component.displayName = displayName;
  return Component;
}

// ═══════════════════════════════════════════════
// Navigation & Layout
// ═══════════════════════════════════════════════
export const DashboardIcon = createIcon(faGauge, "DashboardIcon");
export const MenuIcon = createIcon(faBars, "MenuIcon");
export const SettingsIcon = createIcon(faGear, "SettingsIcon");
export const LogoutIcon = createIcon(faRightFromBracket, "LogoutIcon");
export const ArrowBackIcon = createIcon(faArrowLeft, "ArrowBackIcon");
export const KeyboardArrowDownIcon = createIcon(
  faChevronDown,
  "KeyboardArrowDownIcon",
);
export const CloseIcon = createIcon(faXmark, "CloseIcon");

// ═══════════════════════════════════════════════
// Music & Media
// ═══════════════════════════════════════════════
export const AlbumIcon = createIcon(faCompactDisc, "AlbumIcon");
export const FilmIcon = createIcon(faFilm, "FilmIcon");
export const AudioFileIcon = createIcon(faFileAudio, "AudioFileIcon");
export const MusicNoteIcon = createIcon(faMusic, "MusicNoteIcon");
export const QueueMusicIcon = createIcon(faListUl, "QueueMusicIcon");
export const PlayCircleOutlineIcon = createIcon(
  faCirclePlay,
  "PlayCircleOutlineIcon",
);
export const PlayArrowIcon = createIcon(faPlay, "PlayArrowIcon");
export const PauseIcon = createIcon(faPause, "PauseIcon");

// ═══════════════════════════════════════════════
// People & Business
// ═══════════════════════════════════════════════
export const PersonIcon = createIcon(faUser, "PersonIcon");
export const PersonAddIcon = createIcon(faUserPlus, "PersonAddIcon");
export const GroupIcon = createIcon(faUsers, "GroupIcon");
export const PeopleIcon = createIcon(faPeopleGroup, "PeopleIcon");
export const BusinessIcon = createIcon(faBuilding, "BusinessIcon");

// ═══════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════
export const AddIcon = createIcon(faPlus, "AddIcon");
export const EditIcon = createIcon(faPenToSquare, "EditIcon");
export const DeleteIcon = createIcon(faTrash, "DeleteIcon");
export const DeleteOutlineIcon = createIcon(faTrashCan, "DeleteOutlineIcon");
export const SearchIcon = createIcon(faMagnifyingGlass, "SearchIcon");
export const FilterListIcon = createIcon(faFilter, "FilterListIcon");
export const SaveIcon = createIcon(faFloppyDisk, "SaveIcon");
export const RefreshIcon = createIcon(faArrowsRotate, "RefreshIcon");
export const SwapHorizIcon = createIcon(faArrowRightArrowLeft, "SwapHorizIcon");
export const SendIcon = createIcon(faPaperPlane, "SendIcon");
export const DownloadIcon = createIcon(faDownload, "DownloadIcon");
export const ReplaceIcon = createIcon(faRotate, "ReplaceIcon");

// ═══════════════════════════════════════════════
// Status & Feedback
// ═══════════════════════════════════════════════
export const CheckCircleIcon = createIcon(faCircleCheck, "CheckCircleIcon");
export const PendingIcon = createIcon(faClock, "PendingIcon");
export const CancelIcon = createIcon(faCircleXmark, "CancelIcon");
export const BlockIcon = createIcon(faBan, "BlockIcon");
export const DoneAllIcon = createIcon(faCheckDouble, "DoneAllIcon");

// ═══════════════════════════════════════════════
// File & Upload
// ═══════════════════════════════════════════════
export const CloudUploadIcon = createIcon(faCloudArrowUp, "CloudUploadIcon");
export const FileUploadIcon = createIcon(faFileArrowUp, "FileUploadIcon");
export const FolderZipIcon = createIcon(faFileZipper, "FolderZipIcon");
export const TableChartIcon = createIcon(faTableCells, "TableChartIcon");
export const PhotoCameraIcon = createIcon(faCamera, "PhotoCameraIcon");
export const CameraAltIcon = createIcon(faCameraRetro, "CameraAltIcon");

// ═══════════════════════════════════════════════
// Finance & Analytics
// ═══════════════════════════════════════════════
export const BarChartIcon = createIcon(faChartBar, "BarChartIcon");
export const AttachMoneyIcon = createIcon(faDollarSign, "AttachMoneyIcon");
export const TrendingUpIcon = createIcon(faChartLine, "TrendingUpIcon");

// ═══════════════════════════════════════════════
// Distribution & Shipping
// ═══════════════════════════════════════════════
export const LocalShippingIcon = createIcon(faTruck, "LocalShippingIcon");
export const DesktopIcon = createIcon(faDesktop, "DesktopIcon");

// ═══════════════════════════════════════════════
// Security & Auth
// ═══════════════════════════════════════════════
export const LockIcon = createIcon(faLock, "LockIcon");
export const LockOutlinedIcon = createIcon(faLock, "LockOutlinedIcon");
export const LockOpenIcon = createIcon(faLockOpen, "LockOpenIcon");
export const MobileIcon = createIcon(faMobileScreenButton, "MobileIcon");
export const SecurityIcon = createIcon(faLock, "SecurityIcon");
export const ShieldIcon = createIcon(faLock, "ShieldIcon");
export const VisibilityIcon = createIcon(faEye, "VisibilityIcon");
export const VisibilityOffIcon = createIcon(faEyeSlash, "VisibilityOffIcon");
export const QrCodeIcon = createIcon(faQrcode, "QrCodeIcon");

// ═══════════════════════════════════════════════
// Communication & Notification
// ═══════════════════════════════════════════════
export const NotificationsIcon = createIcon(faBell, "NotificationsIcon");
export const NotificationsNoneIcon = createIcon(
  faBellSlash,
  "NotificationsNoneIcon",
);
export const EmailIcon = createIcon(faEnvelope, "EmailIcon");
export const PhoneIcon = createIcon(faPhone, "PhoneIcon");
export const SmsIcon = createIcon(faCommentSms, "SmsIcon");
export const CampaignIcon = createIcon(faBullhorn, "CampaignIcon");

// ═══════════════════════════════════════════════
// Time & Schedule
// ═══════════════════════════════════════════════
export const ScheduleIcon = createIcon(faClock, "ScheduleIcon");
export const HistoryIcon = createIcon(faClockRotateLeft, "HistoryIcon");

// ═══════════════════════════════════════════════
// Language & Region & Appearance
// ═══════════════════════════════════════════════
export const LanguageIcon = createIcon(faGlobe, "LanguageIcon");
export const PaletteIcon = createIcon(faPalette, "PaletteIcon");

// ═══════════════════════════════════════════════
// Celebration (using smile beam as alternative)
// ═══════════════════════════════════════════════
export const CelebrationIcon = createIcon(
  faFaceSmileBeam as IconDefinition,
  "CelebrationIcon",
);

// ═══════════════════════════════════════════════
// Inline status icons (replacing unicode characters)
// ═══════════════════════════════════════════════
export const CheckIcon = createIcon(faCheck, "CheckIcon");
export const XMarkIcon = createIcon(faXmark, "XMarkIcon");
export const WarningIcon = createIcon(faTriangleExclamation, "WarningIcon");
export const InfoIcon = createIcon(faCircleInfo, "InfoIcon");
export const ClipboardIcon = createIcon(faClipboard, "ClipboardIcon");
export const HandWaveIcon = createIcon(faHand, "HandWaveIcon");
export const TagIcon = createIcon(faTag, "TagIcon");
export const MicrophoneIcon = createIcon(faMicrophone, "MicrophoneIcon");
export const ArrowUpRightIcon = createIcon(
  faArrowUpRightFromSquare,
  "ArrowUpRightIcon",
);
export const CircleIcon = createIcon(faCircle, "CircleIcon");
export const LightbulbIcon = createIcon(faLightbulb, "LightbulbIcon");
export const ImageIcon = createIcon(faImage, "ImageIcon");
export const BoxArchiveIcon = createIcon(faBoxArchive, "BoxArchiveIcon");
export const ExclamationIcon = createIcon(faExclamation, "ExclamationIcon");
export const SpotifyIcon = createIcon(
  faSpotify as IconDefinition,
  "SpotifyIcon",
);
export const AppleIcon = createIcon(faApple as IconDefinition, "AppleIcon");
