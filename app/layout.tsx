import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Font Awesome — prevent FOUT by loading CSS at build time
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
config.autoAddCss = false;

import { ThemeProvider } from "@/components/ThemeProvider";
import { UploadProgressProvider } from "@/components/UploadProgress";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { SessionWatcher } from "@/components/SessionWatcher";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "vietnamese", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BeAlpha Music — Dashboard",
  description: "Music Label & Distribution Management Platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let userTheme: "light" | "dark" = "dark";
  let userLang = "en";
  const session = await getSession();

  if (session) {
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { theme: true, language: true },
    });
    if (user?.theme && (user.theme === "light" || user.theme === "dark")) {
      userTheme = user.theme;
    }
    if (user?.language) {
      userLang = user.language;
    }
  }

  return (
    <html lang={userLang} dir={userLang === "ar" ? "rtl" : "ltr"} data-theme={userTheme} suppressHydrationWarning>
      <body
        className={`${inter.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider initialTheme={userTheme}>
          <I18nProvider initialLanguage={userLang}>
            <UploadProgressProvider>
              <SessionWatcher />
              {children}
            </UploadProgressProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
