export type EntityType = "SUPER_ADMIN" | "SYSTEM_ADMIN" | "ORGANIZATION" | "SUB_ACCOUNT";
export type EntityRole = "OWNER" | "ADMIN" | "REVIEWER" | "ACCOUNTANT" | "MEMBER";

export interface ChildEntityOption {
  type: Exclude<EntityType, "SUPER_ADMIN">;
  businessTier: "BEALPHA" | "DISTRIBUTOR" | "LABEL" | "ARTIST";
  label: string;
  description: string;
}

export type EntityTranslator = (key: string, fallback?: string) => string;

const TYPE_LABELS: Record<EntityType, readonly [string, string]> = {
  SUPER_ADMIN: ["entities.superAdmin", "BeAlpha Platform Owner"],
  SYSTEM_ADMIN: ["entities.systemAdmin", "BeAlpha Operations Team"],
  ORGANIZATION: ["entities.organization", "Customer Organization"],
  SUB_ACCOUNT: ["entities.subAccount", "Client Account"],
};

const ROLE_LABELS: Record<EntityRole, readonly [string, string]> = {
  OWNER: ["entities.owner", "Owner"],
  ADMIN: ["entities.admin", "Administrator"],
  REVIEWER: ["entities.reviewer", "Release Reviewer"],
  ACCOUNTANT: ["entities.accountant", "Accountant"],
  MEMBER: ["entities.member", "Member"],
};

export function entityTypeLabel(type: EntityType, t: EntityTranslator, businessLevel?: number | null): string {
  if (type === "ORGANIZATION" && businessLevel === 2) return t("entities.distributor", "Distributor");
  if (type === "ORGANIZATION" && businessLevel === 3) return t("entities.childOrganization", "Managed label");
  return t(...TYPE_LABELS[type]);
}

export function roleLabel(role: EntityRole, t: EntityTranslator): string {
  return t(...ROLE_LABELS[role]);
}

export function childEntityOptions(parentType: EntityType, t: EntityTranslator, businessLevel?: number | null): ChildEntityOption[] {
  if (parentType === "SUPER_ADMIN") {
    return [{ type: "SYSTEM_ADMIN", businessTier: "BEALPHA", label: entityTypeLabel("SYSTEM_ADMIN", t), description: t("entities.systemAdminDescription", "BeAlpha's internal operations team reviews customer-organization submissions and administers the platform.") }];
  }
  const options: ChildEntityOption[] = [
    { type: "ORGANIZATION", businessTier: "DISTRIBUTOR", label: entityTypeLabel("ORGANIZATION", t, 2), description: t("entities.organizationDescription", "A customer organization has its own private labels, artists, and releases.") },
    { type: "ORGANIZATION", businessTier: "LABEL", label: t("entities.childOrganization", "Managed label"), description: t("entities.childOrganizationDescription", "A label business under the selected managing unit.") },
    { type: "SUB_ACCOUNT", businessTier: "ARTIST", label: entityTypeLabel("SUB_ACCOUNT", t), description: t("entities.subAccountDescription", "A terminal artist account with access to its assigned catalog.") },
  ];
  if (parentType === "SYSTEM_ADMIN") return options;
  if (parentType === "ORGANIZATION" && businessLevel === 2) return options.slice(1);
  if (parentType === "ORGANIZATION" && businessLevel === 3) return options.slice(2);
  return [];
}
export function relationshipLabel(parentType: EntityType, childType: EntityType, t: EntityTranslator): string {
  if (parentType === "ORGANIZATION" && childType === "ORGANIZATION") return t("entities.childOrganization", "Nested organization");
  return entityTypeLabel(childType, t);
}
