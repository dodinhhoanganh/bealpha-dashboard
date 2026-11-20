"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";

export default function BannedPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4 text-white">
      <div className="max-w-md text-center">
        <div className="mb-4 text-6xl font-bold text-red-500">⛔</div>
        <h1 className="mb-2 text-2xl font-semibold">
          {t("errors.banned.title", "Account Suspended")}
        </h1>
        <p className="mb-6 text-gray-400">
          {t(
            "errors.banned.description",
            "Your account has been suspended. Please contact support if you believe this is a mistake.",
          )}
        </p>
        <a
          href="mailto:support@bealpha.com"
          className="inline-block rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
        >
          {t("common.contactSupport", "Contact Support")}
        </a>
      </div>
    </div>
  );
}
