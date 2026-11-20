export interface UserProfile {
  id: string;
  email: string;
  name: string;
  stageName: string | null;
  phone: string | null;
  avatar: string | null;
  roles: string[];
  twoFactorEnabled: boolean;
  twoFactorMethod: string | null; // comma-separated: "email,app"
  language: string;
  timezone: string;
  currency: string;
  notifyReleases: boolean;
  notifyRoyalties: boolean;
  notifyNews: boolean;
  notifyMarketing: boolean;
  createdAt: string;
}

export interface ActiveSession {
  id: string;
  ipAddress: string;
  userAgent: string;
  deviceName: string;
  deviceType: string;
  location: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

export interface SettingsMessage {
  type: "success" | "error";
  text: string;
}
