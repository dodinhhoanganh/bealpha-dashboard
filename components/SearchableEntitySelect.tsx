"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { SearchIcon, CloseIcon } from "@/components/Icon";

interface Entity {
  id: string;
  officialName: string;
  entityType: string;
}

interface SearchableEntitySelectProps {
  value: string;
  onChange: (entityId: string) => void;
  entities: Entity[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
}

export default function SearchableEntitySelect({
  value,
  onChange,
  entities,
  placeholder = "Select owner/distributor",
  label = "Owner / Distributor",
  disabled = false,
}: SearchableEntitySelectProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedEntity = entities.find((e) => e.id === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter entities based on search
  const filteredEntities = entities.filter((e) =>
    e.officialName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="relative w-full">
      {label && (
        <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
          {label}
        </label>
      )}
      <div ref={wrapperRef} className="relative">
        <div
          className={`w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] flex items-center justify-between ${
            disabled ? "opacity-50 cursor-not-allowed bg-[var(--bg-secondary)]" : "cursor-pointer"
          }`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
        >
          <span className={selectedEntity ? "" : "text-[var(--text-disabled)]"}>
            {selectedEntity ? `${selectedEntity.officialName} (${selectedEntity.entityType})` : placeholder}
          </span>
          <SearchIcon size={20} color="#737373" />
        </div>

        {isOpen && !disabled && (
          <div className="absolute z-[60] w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg shadow-lg max-h-80 flex flex-col">
            {/* Search Input */}
            <div className="p-2 border-b border-[var(--border-primary)]">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t("form.placeholder.search", "Search...")}
                className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="overflow-y-auto flex-1">
              {filteredEntities.length > 0 ? (
                filteredEntities.map((entity) => (
                  <div
                    key={entity.id}
                    onClick={() => {
                      onChange(entity.id);
                      setIsOpen(false);
                      setSearchTerm("");
                    }}
                    className="px-4 py-3 hover:bg-[var(--accent)]/10 cursor-pointer border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <div className="font-medium text-sm">{entity.officialName}</div>
                    <div className="text-xs text-[var(--text-disabled)]">{entity.entityType.replace("_", " ")}</div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-[var(--text-disabled)] text-center">
                  No entities found
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
