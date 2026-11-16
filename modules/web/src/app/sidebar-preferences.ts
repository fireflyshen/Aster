import type { WorkspacePreferences } from "../../../core/workspace/organization.ts";
import {
  SIDEBAR_ITEMS,
  type SidebarItemId,
} from "../../../core/workspace/preferences.ts";
import { useMemo } from "react";

export const sidebarItems = SIDEBAR_ITEMS;
export type { SidebarItemId };
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
