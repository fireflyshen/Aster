import type { TaskGroupBy } from "@/features/tasks/task-grouping";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aster:filter-group-by:v1";
const CHANGE_EVENT = "aster:filter-group-by-changed";

function isTaskGroupBy(value: unknown): value is TaskGroupBy {
  return (
    value === "none" ||
    value === "today" ||
    value === "completed" ||
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

function writeGroupBy(
  entryKey: string,
  value: TaskGroupBy,
  defaultGroupBy: TaskGroupBy,
): void {
  if (typeof window === "undefined") return;
  try {
    const current = readGroupMap();
    if (value === defaultGroupBy) delete current[entryKey];
    else current[entryKey] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* Ignore storage quota/privacy errors */
  }
}

function resolveGroupBy(
  entryKey: string | undefined,
  defaultGroupBy: TaskGroupBy,
  allowed?: readonly { value: TaskGroupBy }[],
): TaskGroupBy {
  if (!entryKey) return defaultGroupBy;
  const stored = readGroupMap()[entryKey];
  if (!stored) return defaultGroupBy;
  if (allowed && !allowed.some((option) => option.value === stored)) {
    return defaultGroupBy;
  }
  return stored;
}

/** Persists per-entry grouping preference (with customizable default). */
export function useFilterGroupBy(
  entryKey: string | undefined,
  defaultGroupBy: TaskGroupBy = "none",
  allowedOptions?: readonly { value: TaskGroupBy }[],
): [TaskGroupBy, (next: TaskGroupBy) => void] {
  const allowedKey = allowedOptions?.map((o) => o.value).join(",");
  const [groupBy, setGroupByState] = useState<TaskGroupBy>(() =>
    resolveGroupBy(entryKey, defaultGroupBy, allowedOptions),
  );

  useEffect(() => {
    const sync = () => {
      setGroupByState(resolveGroupBy(entryKey, defaultGroupBy, allowedOptions));
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, defaultGroupBy, allowedKey]);

  const setGroupBy = useCallback(
    (next: TaskGroupBy) => {
      if (!entryKey) return;
      writeGroupBy(entryKey, next, defaultGroupBy);
      setGroupByState(next);
    },
    [entryKey, defaultGroupBy],
  );

  return [groupBy, setGroupBy];
}
