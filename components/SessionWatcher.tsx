"use client";

import { useEffect } from "react";

import { useRouter, usePathname } from "next/navigation";

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
        const res = await fetch("/api/auth/me", {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
        });

        if (res.status === 401) {
          // Session is dead, redirect to login immediately
          router.push("/login?error=session_expired");
        }
      } catch (e) {
        // Ignore network errors (e.g., user went offline)
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
