import type { TaskGroupBy } from "@/features/tasks/task-grouping";
import type { WorkspacePreferences } from "@core/workspace/organization";
import {
  TASK_GROUP_BYS,
  type TaskGroupByValue,
} from "@core/workspace/preferences";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  type ReactNode,
} from "react";

type FilterGroupByContextValue = {
  groupMap: Record<string, TaskGroupBy>;
  setEntryGroupBy: (
    entryKey: string,
    value: TaskGroupBy,
    defaultGroupBy: TaskGroupBy,
  ) => void;
};

const GROUP_BY_SET = new Set<string>(TASK_GROUP_BYS);

function isTaskGroupBy(value: unknown): value is TaskGroupBy {
  return typeof value === "string" && GROUP_BY_SET.has(value);
}

function normalizeGroupMap(
  raw?: Record<string, string>,
): Record<string, TaskGroupBy> {
  if (!raw) return {};
  const clean: Record<string, TaskGroupBy> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isTaskGroupBy(value)) clean[key] = value;
  }
  return clean;
}

const FilterGroupByContext = createContext<FilterGroupByContextValue>({
  groupMap: {},
  setEntryGroupBy: () => {},
});

/** Provides backend-persisted per-view task grouping preferences without localStorage. */
export function FilterGroupByProvider({
  preferences,
  onUpdatePreferences,
  children,
}: {
  preferences?: WorkspacePreferences;
  onUpdatePreferences?: (patch: WorkspacePreferences) => void;
  children: ReactNode;
}) {
  const groupMap = normalizeGroupMap(preferences?.filterGroupBy);

  const setEntryGroupBy = useCallback(
    (entryKey: string, value: TaskGroupBy, defaultGroupBy: TaskGroupBy) => {
      const next: Record<string, TaskGroupByValue> = { ...groupMap };
      if (value === defaultGroupBy) delete next[entryKey];
      else next[entryKey] = value;
      onUpdatePreferences?.({ filterGroupBy: next });
    },
    [groupMap, onUpdatePreferences],
  );

  return createElement(
    FilterGroupByContext.Provider,
    { value: { groupMap, setEntryGroupBy } },
    children,
  );
}

/** Reads and updates per-entry grouping preference via backend workspace preferences. */
export function useFilterGroupBy(
  entryKey: string | undefined,
  defaultGroupBy: TaskGroupBy = "none",
  allowedOptions?: readonly { value: TaskGroupBy }[],
): [TaskGroupBy, (next: TaskGroupBy) => void] {
  const { groupMap, setEntryGroupBy } = useContext(FilterGroupByContext);

  const stored = entryKey ? groupMap[entryKey] : undefined;
  const resolved =
    stored &&
    (!allowedOptions ||
      allowedOptions.some((option) => option.value === stored))
      ? stored
      : defaultGroupBy;

  const setGroupBy = useCallback(
    (next: TaskGroupBy) => {
      if (!entryKey) return;
      setEntryGroupBy(entryKey, next, defaultGroupBy);
    },
    [entryKey, defaultGroupBy, setEntryGroupBy],
  );

  return [resolved, setGroupBy];
}
