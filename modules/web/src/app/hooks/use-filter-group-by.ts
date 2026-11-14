import type { TaskGroupBy } from "@/features/tasks/task-grouping";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aster:filter-group-by:v1";
const CHANGE_EVENT = "aster:filter-group-by-changed";

function isTaskGroupBy(value: unknown): value is TaskGroupBy {
  return (
    value === "none" ||
    value === "due" ||
    value === "project" ||
    value === "priority" ||
    value === "label"
  );
}

function readGroupMap(): Record<string, TaskGroupBy> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<string, TaskGroupBy> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (isTaskGroupBy(val)) clean[key] = val;
    }
    return clean;
  } catch {
    return {};
  }
}

function writeGroupBy(entryKey: string, value: TaskGroupBy): void {
  if (typeof window === "undefined") return;
  try {
    const current = readGroupMap();
    if (value === "none") delete current[entryKey];
    else current[entryKey] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* Ignore storage quota/privacy errors */
  }
}

/** Persists per-entry grouping preference (defaulting to `"none"`). */
export function useFilterGroupBy(
  entryKey: string | undefined,
): [TaskGroupBy, (next: TaskGroupBy) => void] {
  const [groupBy, setGroupByState] = useState<TaskGroupBy>(() =>
    entryKey ? readGroupMap()[entryKey] || "none" : "none",
  );

  useEffect(() => {
    const sync = () => {
      setGroupByState(entryKey ? readGroupMap()[entryKey] || "none" : "none");
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [entryKey]);

  const setGroupBy = useCallback(
    (next: TaskGroupBy) => {
      if (!entryKey) return;
      writeGroupBy(entryKey, next);
      setGroupByState(next);
    },
    [entryKey],
  );

  return [groupBy, setGroupBy];
}
