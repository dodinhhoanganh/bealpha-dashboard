"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { useTheme } from "@/components/layout/ThemeProvider";

export default function AppearanceTab() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <h2
        className="text-lg font-semibold mb-6 pb-3"
        style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        {t("settings.appearance", "Appearance")}
      </h2>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
            {t("settings.theme")}
          </label>
          <div className="flex gap-3">
            {/* Dark mode option */}
            <button
              onClick={() => setTheme("dark")}
              className="flex-1 p-4 rounded-md transition-all cursor-pointer"
              style={{
                background: theme === "dark" ? "var(--accent-surface)" : "var(--bg-surface)",
                border: theme === "dark" ? "2px solid var(--accent)" : "2px solid var(--border-input)",
              }}
            >
              <div
                className="w-full h-20 rounded-sm mb-3 overflow-hidden"
                style={{ background: "#000000", border: "1px solid #282828" }}
              >
                <div className="flex h-full">
                  <div style={{ width: "30%", background: "#141414", borderRight: "1px solid #282828" }}></div>
                  <div className="flex-1 p-2">
                    <div className="h-2 w-12 rounded mb-1" style={{ background: "#333" }}></div>
                    <div className="h-2 w-8 rounded" style={{ background: "#222" }}></div>
                  </div>
                </div>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("settings.dark")}</p>
            </button>

            {/* Light mode option */}
            <button
              onClick={() => setTheme("light")}
              className="flex-1 p-4 rounded-md transition-all cursor-pointer"
              style={{
                background: theme === "light" ? "var(--accent-surface)" : "var(--bg-surface)",
                border: theme === "light" ? "2px solid var(--accent)" : "2px solid var(--border-input)",
              }}
            >
              <div
                className="w-full h-20 rounded-sm mb-3 overflow-hidden"
                style={{ background: "#FAFAFA", border: "1px solid #E5E5E5" }}
              >
                <div className="flex h-full">
                  <div style={{ width: "30%", background: "#FFFFFF", borderRight: "1px solid #E5E5E5" }}></div>
                  <div className="flex-1 p-2">
                    <div className="h-2 w-12 rounded mb-1" style={{ background: "#E0E0E0" }}></div>
                    <div className="h-2 w-8 rounded" style={{ background: "#EBEBEB" }}></div>
                  </div>
                </div>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("settings.light")}</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
