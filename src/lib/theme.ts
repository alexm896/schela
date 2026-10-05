import { useCallback, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "schela-theme";
const DEFAULT_THEME: ThemePreference = "dark";
const LIGHT_QUERY = "(prefers-color-scheme: light)";
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#09090b",
  light: "#fafafa",
};

/**
 * Runs in <head> before first paint so a light-mode visitor never sees a dark
 * flash. Mirrors `applyTheme` below; keep the two in sync.
 */
export const themeBootScript = `(function(){var p;try{p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system")p=${JSON.stringify(DEFAULT_THEME)};var t=p==="system"?(matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark"):p;var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(t);r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)})})()`;

// Fallback when localStorage is unavailable (private mode, blocked storage).
let memoryPreference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPreference(stored)) return stored;
  } catch {
    // storage blocked
  }
  return memoryPreference ?? DEFAULT_THEME;
}

function readResolved(): ResolvedTheme {
  return document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function applyTheme(preference: ThemePreference) {
  const theme = resolve(preference);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    matchMedia(LIGHT_QUERY).addEventListener("change", onSystemChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      matchMedia(LIGHT_QUERY).removeEventListener("change", onSystemChange);
    }
  };
}

// Another tab changed the theme.
function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  applyTheme(readPreference());
  emit();
}

// The OS switched light/dark while the panel follows the system.
function onSystemChange() {
  if (readPreference() !== "system") return;
  applyTheme("system");
  emit();
}

export function useTheme() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => DEFAULT_THEME,
  );
  const resolved = useSyncExternalStore(
    subscribe,
    readResolved,
    (): ResolvedTheme => (DEFAULT_THEME === "light" ? "light" : "dark"),
  );
  const setPreference = useCallback((next: ThemePreference) => {
    memoryPreference = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked; memoryPreference keeps it for this page
    }
    applyTheme(next);
    emit();
  }, []);
  return { preference, resolved, setPreference };
}
