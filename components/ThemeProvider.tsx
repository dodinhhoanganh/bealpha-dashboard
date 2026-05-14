"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme, syncToDb?: boolean) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  initialTheme = "dark",
  children,
}: {
  initialTheme?: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [mounted, setMounted] = useState(false);

  // Apply theme to HTML element
  useEffect(() => {
    setMounted(true);
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    // Add transitioning class briefly for smooth animation
    root.classList.add("theme-transitioning");
    const timer = setTimeout(() => {
      root.classList.remove("theme-transitioning");
    }, 400);
    return () => clearTimeout(timer);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme, syncToDb: boolean = true) => {
    setThemeState(newTheme);
    // Persist to localStorage for instant load on next visit
    if (typeof window !== "undefined") {
      localStorage.setItem("bealpha_theme", newTheme);
    }

    // Persist to database if requested
    if (syncToDb) {
      fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: newTheme }),
      }).catch((err) => console.error("Failed to sync theme:", err));
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Rely strictly on initialTheme passed from server (database)
  // LocalStorage is only updated for fallback, but not loaded on mount to prevent overriding DB state

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
