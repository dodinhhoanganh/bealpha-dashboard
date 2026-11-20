"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function ForbiddenPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4 text-white">
      <div className="max-w-md text-center">
        <div className="mb-4 text-6xl font-bold text-red-500">403</div>
        <h1 className="mb-2 text-2xl font-semibold">
          {t("errors.forbidden.title", "Access Forbidden")}
        </h1>
        <p className="mb-6 text-gray-400">
          {t(
            "errors.forbidden.description",
            "Your account does not have permission to access this page.",
          )}
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
        >
          {t("common.backHome", "Back to Home")}
        </Link>
      </div>
    </div>
  );
}
