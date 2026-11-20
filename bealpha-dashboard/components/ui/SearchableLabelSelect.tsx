"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { SearchIcon, AddIcon, CloseIcon } from "@/components/ui/Icon";

interface Label {
  id: string;
  name: string;
}

interface SearchableLabelSelectProps {
  value: string;
  onChange: (labelId: string) => void;
  labels: Label[];
  onCreateLabel: (name: string) => Promise<string>;
  placeholder?: string;
}

export default function SearchableLabelSelect({
  value,
  onChange,
  labels,
  onCreateLabel,
  placeholder,
}: SearchableLabelSelectProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [labelName, setLabelName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedLabel = labels.find((l) => l.id === value);

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

  // Filter labels based on search
  const filteredLabels = labels.filter((l) =>
    l.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleCreateLabel = async () => {
    if (!labelName.trim()) {
      alert(t("error.labelNameIsRequired", "Label name is required"));
      return;
    }
    if (labelName.trim().length < 2) {
      alert(t("error.labelNameMustBeAtLeast2Characters", "Label name must be at least 2 characters"));
      return;
    }

    setIsCreating(true);
    try {
      const newLabelId = await onCreateLabel(labelName.trim());
      onChange(newLabelId);
      setShowCreateModal(false);
      setLabelName("");
      setIsOpen(false);
    } catch (error) {
      console.error("Error creating label:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <div
          className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] cursor-pointer flex items-center justify-between"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className={selectedLabel ? "" : "text-[var(--text-disabled)]"}>
            {selectedLabel?.name || placeholder || t("form.placeholder.selectImprint", "Select imprint")}
          </span>
          <SearchIcon size={20} color="#737373" />
        </div>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
            {/* Search Input */}
            <div className="p-2 border-b border-[var(--border-primary)]">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t("form.placeholder.enterLabelName", "Enter label name")}
                className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="overflow-y-auto flex-1">
              {filteredLabels.length > 0 &&
                filteredLabels.map((label) => (
                  <div
                    key={label.id}
                    onClick={() => {
                      onChange(label.id);
                      setIsOpen(false);
                      setSearchTerm("");
                    }}
                    className="px-4 py-3 hover:bg-transparent cursor-pointer border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <div className="font-medium">{label.name}</div>
                  </div>
                ))}

              {/* Create New Option - Always visible */}
              <div
                onClick={() => {
                  setLabelName(searchTerm);
                  setShowCreateModal(true);
                  setIsOpen(false);
                }}
                className="px-4 py-3 hover:bg-[var(--accent)]/20 cursor-pointer border-t border-[var(--border-input)] text-[var(--accent-text)] flex items-center gap-2"
              >
                <AddIcon size={18} />
                <span className="text-sm font-medium">
                    {searchTerm
                    ? `${t("common.addNewImprint")} "${searchTerm}"`
                    : t("common.addNewImprint")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Label Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-transparent rounded-lg w-full max-w-md border border-[var(--border-primary)]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
              <h3 className="text-lg font-medium">{t("heading.addNewImprint", "Add New Imprint")}</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setLabelName("");
                }}
                className="p-1 hover:bg-[var(--bg-elevated)] rounded"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                {t("form.iMPRINTNAME", "IMPRINT NAME")}
              </label>
              <input
                type="text"
                value={labelName}
                onChange={(e) => setLabelName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateLabel()}
                className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder={t("form.placeholder.enterImprintName", "Enter imprint name")}
                autoFocus
              />
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--border-input)] flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setLabelName("");
                }}
                className="px-4 py-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreateLabel}
                disabled={isCreating || !labelName.trim()}
                className="px-6 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-transparent disabled:text-[var(--text-disabled)] text-white rounded font-medium transition-colors"
              >
                {isCreating ? t("common.saving") : t("common.addImprint", "ADD IMPRINT")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
