import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Font Awesome — prevent FOUT by loading CSS at build time
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
config.autoAddCss = false;

import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { UploadProgressProvider } from "@/components/ui/UploadProgress";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { SessionWatcher } from "@/components/layout/SessionWatcher";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext", "vietnamese", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BeAlpha Music — Dashboard",
  description: "Music Label & Distribution Management Platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const userTheme: "light" | "dark" = "dark";
  const userLang: string = "en";

  return (
    <html lang={userLang} dir={userLang === "ar" ? "rtl" : "ltr"} data-theme={userTheme} suppressHydrationWarning>
      <body
        className={`${manrope.variable} antialiased`}
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
