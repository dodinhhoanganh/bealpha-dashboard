// Shared types for the BeAlpha dashboard

export interface UserSession {
  id: string;
  email: string;
  name?: string;
  stageName?: string;
  avatar?: string;
  phone?: string;
  roles: string[];
  permissions: string[];
  // B2B2B entity context
  entityId: string;
  entityType: string;
  entityRole: string;
  entityName: string;
  entityLogo?: string | null;
  entityPath: string;
  tenantId?: string | null;
  // Preferences
  language?: string;
  currency?: string;
  timezone?: string;
  theme?: string;
}

export interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  requiredPermissions?: string[];
  requiredRoles?: string[];
}
