"use client";

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { AddIcon, BusinessIcon, GroupIcon, KeyboardArrowDownIcon } from "@/components/ui/Icon";
import { childEntityOptions, entityTypeLabel, type EntityType } from "@/lib/entity-management";

export interface EntityNode {
  id: string;
  entityType: EntityType;
  officialName: string;
  parentId: string | null;
  path: string;
  businessLevel?: number | null;
  _count?: { children?: number; userRoles?: number };
}

interface TreeNode extends EntityNode { children: TreeNode[] }

function buildTree(entities: EntityNode[]): TreeNode[] {
  const map = new Map(entities.map((entity) => [entity.id, { ...entity, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.officialName.localeCompare(b.officialName));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

export default function EntityTreeView({ entities, loading, selectedId, onSelect, onCreateChild }: {
  entities: EntityNode[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (entityId: string) => void;
  onCreateChild?: (entity: EntityNode) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTree(entities), [entities]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const ids = new Set<string>();
    for (const entity of entities) {
      if (!entity.officialName.toLocaleLowerCase().includes(normalizedQuery)) continue;
      let current: EntityNode | undefined = entity;
      while (current && !ids.has(current.id)) {
        ids.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return ids;
  }, [entities, normalizedQuery]);

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (visibleIds && !visibleIds.has(node.id)) return null;
    const hasChildren = node.children.some((child) => !visibleIds || visibleIds.has(child.id));
    const isExpanded = normalizedQuery.length > 0 || expanded.has(node.id);
    const selected = selectedId === node.id;
    const canCreateChild = childEntityOptions(node.entityType, t, node.businessLevel).length > 0;
    return (
      <div key={node.id} role="none">
        <div role="treeitem" aria-level={depth} aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={selected}
          className="group grid min-w-0 grid-cols-[24px_20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors"
          style={{ marginLeft: `min(${Math.max(0, depth - 1) * 16}px, 80px)`, background: selected ? "var(--accent-surface)" : "transparent" }}>
          <button type="button" onClick={() => hasChildren && toggle(node.id)} disabled={!hasChildren}
            className="flex h-6 w-6 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            aria-label={isExpanded ? t("common.collapse", "Thu gọn") : t("common.expand", "Mở rộng")}>
            {hasChildren ? <KeyboardArrowDownIcon size={15} style={{ transform: isExpanded ? "none" : "rotate(-90deg)" }} /> : null}
          </button>
          {node.entityType === "ORGANIZATION" ? <BusinessIcon size={16} /> : <GroupIcon size={16} />}
          <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
            <span className="block truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{node.officialName}</span>
            <span className="block truncate text-xs" style={{ color: "var(--text-secondary)" }}>
              {entityTypeLabel(node.entityType, t, node.businessLevel)} · {t("entities.level", "level")} {depth}
              {node._count?.userRoles ? ` · ${node._count.userRoles} ${t("entities.members", "thành viên")}` : ""}
            </span>
          </button>
          {onCreateChild && canCreateChild ? (
            <button type="button" onClick={() => onCreateChild(node)}
              className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              style={{ color: "var(--accent-text)" }} aria-label={`${t("entities.create", "Tạo cấp trực thuộc")} ${node.officialName}`}>
              <AddIcon size={14} /> {t("common.add", "Thêm")}
            </button>
          ) : null}
        </div>
        {hasChildren && isExpanded ? <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div> : null}
      </div>
    );
  };

  return (
    <section className="overflow-x-clip rounded-xl border p-3" style={{ borderColor: "var(--border-primary)", background: "var(--bg-surface)" }}>
      <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border-primary)" }}>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.hierarchy", "Cây tổ chức")}</h3>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{entities.length} {t("entities.entities", "đơn vị")}</p>
        </div>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("entities.searchPlaceholder", "Tìm tổ chức")}
          className="min-h-10 w-full max-w-64 rounded-lg border px-3 text-sm outline-none focus:border-[var(--accent)]"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border-primary)", color: "var(--text-primary)" }} />
      </div>
      {loading ? <p className="p-4 text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.loading", "Đang tải...")}</p>
        : tree.length === 0 ? <p className="p-4 text-sm" style={{ color: "var(--text-secondary)" }}>{t("entities.noEntities", "Chưa có tổ chức")}</p>
        : visibleIds?.size === 0 ? <p className="p-4 text-sm" style={{ color: "var(--text-secondary)" }}>{t("common.noResults", "Không có kết quả")}</p>
        : <div role="tree" aria-label={t("entities.hierarchy", "Cây tổ chức")}>{tree.map((node) => renderNode(node, 1))}</div>}
    </section>
  );
}
