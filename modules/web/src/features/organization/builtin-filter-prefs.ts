import { BUILTIN_TW_FILTERS } from "@core/workspace/builtin-filters";
import type { SavedFilter } from "@core/workspace/organization";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "aster:builtin-filter-prefs:v1";
const CHANGE_EVENT = "aster:builtin-filter-prefs-changed";

type StoredPrefs = {
  favorites: string[];
  hidden: string[];
  sectionHidden: boolean;
};

const EMPTY_PREFS: StoredPrefs = {
  favorites: [],
  hidden: [],
  sectionHidden: false,
};

function readPrefs(): StoredPrefs {
  if (typeof window === "undefined") return EMPTY_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PREFS;
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    return {
      favorites: Array.isArray(parsed.favorites)
        ? parsed.favorites.filter((x): x is string => typeof x === "string")
        : [],
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((x): x is string => typeof x === "string")
        : [],
      sectionHidden: Boolean(parsed.sectionHidden),
    };
  } catch {
    return EMPTY_PREFS;
  }
}

function writePrefs(next: StoredPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* Ignore storage quota/privacy errors */
  }
}

/** Manages local favorite and visibility preferences for built-in Taskwarrior filters. */
export function useBuiltinFilterPrefs() {
  const [prefs, setPrefs] = useState<StoredPrefs>(() => readPrefs());

  useEffect(() => {
    const sync = () => setPrefs(readPrefs());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const favoriteIds = useMemo(
    () => new Set(prefs.favorites),
    [prefs.favorites],
  );
  const hiddenIds = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);

  const builtinFilters: SavedFilter[] = useMemo(
    () =>
      BUILTIN_TW_FILTERS.map((item) => ({
        ...item,
        favorite: favoriteIds.has(item.id),
      })),
    [favoriteIds],
  );

  const toggleFavorite = useCallback((id: string) => {
    const current = readPrefs();
    const exists = current.favorites.includes(id);
    const next: StoredPrefs = {
      ...current,
      favorites: exists
        ? current.favorites.filter((x) => x !== id)
        : [...current.favorites, id],
    };
    writePrefs(next);
    setPrefs(next);
  }, []);

  const toggleHidden = useCallback((id: string) => {
    const current = readPrefs();
    const exists = current.hidden.includes(id);
    const next: StoredPrefs = {
      ...current,
      hidden: exists
        ? current.hidden.filter((x) => x !== id)
        : [...current.hidden, id],
    };
    writePrefs(next);
    setPrefs(next);
  }, []);

  const toggleSectionHidden = useCallback(() => {
    const current = readPrefs();
    const next: StoredPrefs = {
      ...current,
      sectionHidden: !current.sectionHidden,
    };
    writePrefs(next);
    setPrefs(next);
  }, []);

  const unhideAll = useCallback(() => {
    const current = readPrefs();
    const next: StoredPrefs = { ...current, hidden: [], sectionHidden: false };
    writePrefs(next);
    setPrefs(next);
  }, []);

  return {
    builtinFilters,
    favoriteIds,
    hiddenIds,
    sectionHidden: prefs.sectionHidden,
    toggleFavorite,
    toggleHidden,
    toggleSectionHidden,
    unhideAll,
  };
}
