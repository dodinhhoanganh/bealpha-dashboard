"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { EmailIcon, MobileIcon, SecurityIcon } from "@/components/ui/Icon";

type TwoFactorMethod = "email" | "app" | "recovery";

interface ChooseMethodStepProps {
  availableMethods: TwoFactorMethod[];
  loading: boolean;
  onMethodSelect: (method: TwoFactorMethod) => void;
}

export default function ChooseMethodStep({ availableMethods, loading, onMethodSelect }: ChooseMethodStepProps) {
  const { t } = useI18n();

  const getMethodIcon = (method: TwoFactorMethod) => {
    switch (method) {
      case "email": return <EmailIcon size={25} />;
      case "app": return <MobileIcon size={25} />;
      case "recovery": return <SecurityIcon size={25} />;
    }
  };

  const getMethodLabel = (method: TwoFactorMethod) => {
    switch (method) {
      case "email": return t("login.emailMethod");
      case "app": return t("login.authenticatorApp");
      case "recovery": return t("login.recoveryCode");
    }
  };

  const getMethodDescription = (method: TwoFactorMethod) => {
    switch (method) {
      case "email": return t("login.emailDesc");
      case "app": return t("login.appDesc");
      case "recovery": return t("login.recoveryDesc");
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-col gap-1">
        {availableMethods.map((method) => (
          <button
            key={method}
            onClick={() => onMethodSelect(method)}
            disabled={loading}
            className="group w-full flex items-center gap-4 py-4 px-1 rounded-xl transition-colors duration-200 text-left disabled:opacity-50 hover:bg-white/5 bg-transparent"
          >
            <div className="flex items-center justify-center shrink-0 w-10 text-white/60 group-hover:text-white transition-colors duration-200">
              {getMethodIcon(method)}
            </div>
            <div>
              <p className="font-semibold text-[17px] text-white group-hover:text-white transition-colors">
                {getMethodLabel(method)}
              </p>
              <p className="text-[14px] mt-0.5 text-white/50 group-hover:text-white/70 transition-colors">
                {getMethodDescription(method)}
              </p>
            </div>
          </button>
        ))}
      </div>
      {loading && (
        <div className="flex items-center justify-center py-4 gap-3">
          <div className="w-5 h-5 border-2 rounded-full animate-spin"
            style={{ borderColor: "var(--border-primary)", borderTopColor: "var(--accent)" }} />
          <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>{t("login.sendingCode")}</span>
        </div>
      )}
    </div>
  );
}
