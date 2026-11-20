"use client";

import { useEffect } from "react";

import { useRouter, usePathname } from "next/navigation";
import { ApiClientError, apiRequest } from "@/lib/api-client";

/**
 * SessionWatcher quietly polls the server to ensure the current session is still valid.
 * If the session is invalidated (e.g., killed remotely, expired, or user was banned),
 * it immediately redirects the user to the login screen without requiring a page refresh.
 */
export function SessionWatcher() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Don't run watcher on public pages like login
    if (pathname === "/login" || pathname === "/forgot-password") return;

    const checkSession = async () => {
      try {
        await apiRequest("/api/v1/auth/me", {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
        });
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) {
          router.push("/login?error=session_expired");
        }
      }
    };

    // 1. Check immediately when user switches back to the tab
    window.addEventListener("focus", checkSession);

    // 2. Poll every 60 seconds just to be safe
    const interval = setInterval(checkSession, 60000);

    return () => {
      window.removeEventListener("focus", checkSession);
      clearInterval(interval);
    };
  }, [router, pathname]);

  return null; // This component renders nothing
}
