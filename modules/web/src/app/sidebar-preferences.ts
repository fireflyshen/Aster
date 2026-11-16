import type { WorkspacePreferences } from "@core/workspace/organization";
import { useMemo } from "react";

export const sidebarItems = [
  { id: "focus", label: "Focus" },
  { id: "pending", label: "收件箱" },
  { id: "today", label: "今天" },
  { id: "upcoming", label: "预览" },
  { id: "habits", label: "习惯" },
  { id: "time", label: "时间账本" },
  { id: "organization", label: "过滤器与标签" },
] as const;

export type SidebarItemId = (typeof sidebarItems)[number]["id"];
export type SidebarPreferences = {
  hidden: SidebarItemId[];
  showCounts: boolean;
};

export function readSidebarPreferences(
  raw?: string | null,
): SidebarPreferences {
  try {
    const value = JSON.parse(raw || "{}");
    return {
      hidden: Array.isArray(value?.hidden)
        ? value.hidden.filter((id: unknown): id is SidebarItemId =>
            sidebarItems.some((item) => item.id === id),
          )
        : [],
      showCounts: value?.showCounts !== false,
    };
  } catch {
    return { hidden: [], showCounts: true };
  }
}

/** Reads and updates sidebar item visibility and count display via backend workspace preferences. */
export function useSidebarPreferences(
  workspacePreferences?: WorkspacePreferences,
  onUpdatePreferences?: (patch: WorkspacePreferences) => void,
) {
  const preferences = useMemo<SidebarPreferences>(() => {
    const rawHidden = workspacePreferences?.sidebarHidden;
    return {
      hidden: Array.isArray(rawHidden)
        ? rawHidden.filter((id): id is SidebarItemId =>
            sidebarItems.some((item) => item.id === id),
          )
        : [],
      showCounts: workspacePreferences?.sidebarShowCounts !== false,
    };
  }, [
    workspacePreferences?.sidebarHidden,
    workspacePreferences?.sidebarShowCounts,
  ]);

  function update(next: SidebarPreferences) {
    onUpdatePreferences?.({
      sidebarHidden: next.hidden,
      sidebarShowCounts: next.showCounts,
    });
  }

  return {
    preferences,
    update,
    visible: (id: SidebarItemId) => !preferences.hidden.includes(id),
  };
}
