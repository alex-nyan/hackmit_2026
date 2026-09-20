"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import styles from "./LandingTheme.module.css";

type Theme = "light" | "dark";

const STORAGE_KEY = "paw-patrol:landing-theme:v1";
const listeners = new Set<() => void>();
let memoryTheme: Theme | null = null;

function readTheme(): Theme {
  if (memoryTheme !== null) return memoryTheme;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function serverTheme(): Theme {
  return "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    memoryTheme = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function saveTheme(theme: Theme) {
  memoryTheme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The toggle still works in this tab when browser storage is unavailable.
  }
  for (const listener of listeners) listener();
}

const ThemeContext = createContext<Theme | null>(null);

export function LandingTheme({ children, className }: { children: ReactNode; className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  return (
    <ThemeContext.Provider value={theme}>
      <div className={[styles.root, className].filter(Boolean).join(" ")} data-theme={theme}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function LandingThemeToggle({ className }: { className?: string } = {}) {
  const theme = useContext(ThemeContext);
  if (theme === null) throw new Error("LandingThemeToggle must be inside LandingTheme.");
  const next = theme === "light" ? "dark" : "light";
  const label = `Switch to ${next} theme`;
  return (
    <button
      type="button"
      className={[styles.toggle, className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      onClick={() => saveTheme(next)}
    >
      {next === "dark" ? (
        <Moon size={19} aria-hidden="true" />
      ) : (
        <Sun size={19} aria-hidden="true" />
      )}
    </button>
  );
}
