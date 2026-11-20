import React from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { LANGUAGES } from "@/lib/languages";
import { CloseIcon } from "@/components/ui/Icon";

export interface Localization {
  language: string;
  value: string;
}

interface LocalizedInputProps {
  label: string;
  value: Localization[];
  onChange: (value: Localization[]) => void;
  placeholder?: string;
  required?: boolean;
}

export function LocalizedInput({
  label,
  value = [],
  onChange,
  placeholder,
  required,
}: LocalizedInputProps) {
  const { t } = useI18n();
  const handleAdd = () => {
    onChange([...value, { language: "en", value: "" }]);
  };

  const handleUpdate = (
    index: number,
    field: keyof Localization,
    newValue: string,
  ) => {
    const newLocalizations = [...value];
    newLocalizations[index] = { ...newLocalizations[index], [field]: newValue };
    onChange(newLocalizations);
  };

  const handleRemove = (index: number) => {
    const newLocalizations = value.filter((_, i) => i !== index);
    onChange(newLocalizations);
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-[var(--text-tertiary)]">
          {label} {required && "*"}
        </label>
        <button
          type="button"
          onClick={handleAdd}
          className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
        >
          <span className="text-lg leading-none">+</span> {t("form.addLocalized", "+ Add Localized")}
        </button>
      </div>

      <div className="space-y-3">
        {value.map((loc, index) => (
          <div key={index} className="flex items-center gap-3 relative">
            <select
              value={loc.language}
              onChange={(e) => handleUpdate(index, "language", e.target.value)}
              className="w-1/3 px-3 py-3 bg-[var(--bg-surface-secondary)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code.toUpperCase()})
                </option>
              ))}
            </select>
            <div className="relative flex-1">
              <input
                type="text"
                value={loc.value}
                onChange={(e) => handleUpdate(index, "value", e.target.value)}
                placeholder={placeholder || t("form.placeholder.enterTranslatedText", "Enter translated text")}
                className="w-full px-4 py-3 pr-10 bg-[var(--bg-surface-secondary)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="absolute right-3 top-3.5 text-[var(--text-disabled)] hover:text-red-500 transition-colors"
                title={t("common.removeLocalization")}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>
        ))}
        {value.length === 0 && (
          <div className="text-sm text-[var(--text-disabled)] italic px-1">
            {t("form.noLocalizationsAdded", 'No localizations added. Click "Add Localized" above to set specific languages.')}
          </div>
        )}
      </div>
    </div>
  );
}
