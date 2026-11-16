import { MAX_DOING_LIMIT, MIN_DOING_LIMIT } from "../tasks/state.ts";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_PALETTES = [
  { id: "aster", name: "Aster", light: "#2d2e32", dark: "#e5e3de" },
  { id: "todoist", name: "Todoist 红", light: "#c3392c", dark: "#ef7167" },
  { id: "moonstone", name: "月光石", light: "#52657d", dark: "#99abc3" },
  { id: "tangerine", name: "橙红", light: "#a6600a", dark: "#e7a443" },
  { id: "kale", name: "甘蓝", light: "#487541", dark: "#8db983" },
  { id: "blueberry", name: "蓝莓", light: "#246fa8", dark: "#73b3e4" },
  { id: "lavender", name: "薰衣草", light: "#7358aa", dark: "#b49bdc" },
  { id: "raspberry", name: "玫红", light: "#ab3c68", dark: "#e78fb1" },
] as const;
export type ThemePalette = (typeof THEME_PALETTES)[number]["id"];
const PALETTE_IDS: readonly string[] = THEME_PALETTES.map((item) => item.id);

export const SIDEBAR_ITEMS = [
  { id: "now", label: "现在能做" },
  { id: "focus", label: "Focus" },
  { id: "pending", label: "收件箱" },
  { id: "today", label: "今天" },
  { id: "upcoming", label: "预览" },
  { id: "habits", label: "习惯" },
  { id: "time", label: "时间账本" },
  { id: "organization", label: "过滤器与标签" },
] as const;
export type SidebarItemId = (typeof SIDEBAR_ITEMS)[number]["id"];
const SIDEBAR_ITEM_IDS = new Set<string>(SIDEBAR_ITEMS.map((item) => item.id));

export const WORKSPACE_VIEWS = [
  "now",
  "today",
  "pending",
  "focus",
  "upcoming",
] as const;
export type WorkspaceDefaultView = (typeof WORKSPACE_VIEWS)[number];

export type NowSectionState = {
  planned?: boolean;
  waiting?: boolean;
  parked?: boolean;
};

export const COMPLETE_BEHAVIORS = ["hide", "strikethrough"] as const;
export type CompleteBehavior = (typeof COMPLETE_BEHAVIORS)[number];

export const LAYOUT_MODES = ["list", "board"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const TASK_GROUP_BYS = [
  "none",
  "today",
  "completed",
  "due",
  "project",
  "priority",
  "label",
] as const;
export type TaskGroupByValue = (typeof TASK_GROUP_BYS)[number];
const TASK_GROUP_BY_SET = new Set<string>(TASK_GROUP_BYS);

export type WorkspacePreferences = {
  theme?: ThemeMode;
  palette?: ThemePalette;
  sidebarHidden?: SidebarItemId[];
  sidebarShowCounts?: boolean;
  completeBehavior?: CompleteBehavior;
  layout?: LayoutMode;
  view?: WorkspaceDefaultView;
  navOpen?: boolean;
  filterGroupBy?: Record<string, TaskGroupByValue>;
  nowSections?: NowSectionState;
  doingLimit?: number;
};

export type PreferencesChange = {
  revision: number;
  kind: "preferences";
  patch: WorkspacePreferences;
};

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

export function normalizeThemePalette(value: unknown): ThemePalette {
  return typeof value === "string" && PALETTE_IDS.includes(value)
    ? (value as ThemePalette)
    : "aster";
}

/** Validates a partial or full workspace preferences payload, returning normalized fields or throwing on invalid types. */
export function normalizePreferencesPatch(
  raw: unknown,
  options?: { strict?: boolean },
): WorkspacePreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid preferences patch.");
  }
  const strict = options?.strict ?? false;
  const input = raw as Record<string, unknown>;
  const patch: WorkspacePreferences = {};

  if (input.theme !== undefined) {
    if (!THEME_MODES.includes(input.theme as ThemeMode)) {
      throw new Error("Invalid theme mode.");
    }
    patch.theme = input.theme as ThemeMode;
  }
  if (input.palette !== undefined) {
    if (!PALETTE_IDS.includes(String(input.palette))) {
      throw new Error("Invalid theme palette.");
    }
    patch.palette = input.palette as ThemePalette;
  }
  if (input.sidebarHidden !== undefined) {
    if (!Array.isArray(input.sidebarHidden)) {
      throw new Error("Invalid sidebar hidden items.");
    }
    if (strict && input.sidebarHidden.some((id) => typeof id !== "string")) {
      throw new Error("Invalid sidebar hidden items.");
    }
    patch.sidebarHidden = [
      ...new Set(
        input.sidebarHidden.filter(
          (id): id is SidebarItemId =>
            typeof id === "string" && SIDEBAR_ITEM_IDS.has(id),
        ),
      ),
    ];
  }
  if (input.sidebarShowCounts !== undefined) {
    if (typeof input.sidebarShowCounts !== "boolean") {
      throw new Error("Invalid sidebar count preference.");
    }
    patch.sidebarShowCounts = input.sidebarShowCounts;
  }
  if (input.completeBehavior !== undefined) {
    if (
      !COMPLETE_BEHAVIORS.includes(input.completeBehavior as CompleteBehavior)
    ) {
      throw new Error("Invalid completion behavior preference.");
    }
    patch.completeBehavior = input.completeBehavior as CompleteBehavior;
  }
  if (input.layout !== undefined) {
    if (!LAYOUT_MODES.includes(input.layout as LayoutMode)) {
      throw new Error("Invalid layout preference.");
    }
    patch.layout = input.layout as LayoutMode;
  }
  if (input.view !== undefined) {
    if (!WORKSPACE_VIEWS.includes(input.view as WorkspaceDefaultView)) {
      throw new Error("Invalid default view preference.");
    }
    patch.view = input.view as WorkspaceDefaultView;
  }
  if (input.navOpen !== undefined) {
    if (typeof input.navOpen !== "boolean") {
      throw new Error("Invalid navigation open preference.");
    }
    patch.navOpen = input.navOpen;
  }
  if (input.filterGroupBy !== undefined) {
    if (
      !input.filterGroupBy ||
      typeof input.filterGroupBy !== "object" ||
      Array.isArray(input.filterGroupBy)
    ) {
      throw new Error("Invalid filter grouping preferences.");
    }
    const clean: Record<string, TaskGroupByValue> = {};
    for (const [key, value] of Object.entries(
      input.filterGroupBy as Record<string, unknown>,
    )) {
      if (strict && (typeof key !== "string" || typeof value !== "string")) {
        throw new Error("Invalid filter grouping preferences.");
      }
      if (
        typeof key === "string" &&
        key.length > 0 &&
        key.length <= 160 &&
        typeof value === "string" &&
        TASK_GROUP_BY_SET.has(value)
      ) {
        clean[key] = value as TaskGroupByValue;
      }
    }
    patch.filterGroupBy = clean;
  }
  if (input.nowSections !== undefined) {
    if (
      !input.nowSections ||
      typeof input.nowSections !== "object" ||
      Array.isArray(input.nowSections)
    ) {
      throw new Error("Invalid now sections preferences.");
    }
    const rawSections = input.nowSections as Record<string, unknown>;
    const cleanSections: NowSectionState = {};
    for (const key of ["planned", "waiting", "parked"] as const) {
      if (rawSections[key] !== undefined) {
        if (typeof rawSections[key] !== "boolean") {
          throw new Error("Invalid now sections preferences.");
        }
        cleanSections[key] = rawSections[key];
      }
    }
    patch.nowSections = cleanSections;
  }
  if (input.doingLimit !== undefined) {
    if (
      typeof input.doingLimit !== "number" ||
      !Number.isInteger(input.doingLimit) ||
      input.doingLimit < MIN_DOING_LIMIT ||
      input.doingLimit > MAX_DOING_LIMIT
    ) {
      throw new Error("Invalid doing limit preference.");
    }
    patch.doingLimit = input.doingLimit;
  }
  return patch;
}

export function isValidWorkspacePreferences(raw: unknown): boolean {
  if (raw === undefined) return true;
  try {
    normalizePreferencesPatch(raw, { strict: true });
    return true;
  } catch {
    return false;
  }
}

/** Generates the synchronous pre-paint theme script served at `/api/theme.js`. */
export function renderThemeInitScript(
  preferences?: WorkspacePreferences,
): string {
  const theme = normalizeThemeMode(preferences?.theme);
  const palette = normalizeThemePalette(preferences?.palette);
  return [
    "(() => {",
    `  const theme = ${JSON.stringify(theme)};`,
    `  const palette = ${JSON.stringify(palette)};`,
    '  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);',
    "  document.documentElement.dataset.theme = theme;",
    "  document.documentElement.dataset.palette = palette;",
    '  document.documentElement.classList.toggle("dark", dark);',
    '  document.querySelector(\'meta[name="theme-color"]\')?.setAttribute("content", dark ? "#1c1c1d" : "#faf9f7");',
    "})();",
  ].join("\n");
}
