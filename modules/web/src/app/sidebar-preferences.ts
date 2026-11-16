import { useState } from "react";
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
export function useSidebarPreferences() {
  const [preferences, setPreferences] = useState<SidebarPreferences>(() => {
    try {
      return readSidebarPreferences(localStorage.getItem("aster.sidebar"));
    } catch {
      return readSidebarPreferences();
    }
  });
  function update(next: SidebarPreferences) {
    setPreferences(next);
    try {
      localStorage.setItem("aster.sidebar", JSON.stringify(next));
    } catch {
      /* Keep session preference. */
    }
  }
  return {
    preferences,
    update,
    visible: (id: SidebarItemId) => !preferences.hidden.includes(id),
  };
}
