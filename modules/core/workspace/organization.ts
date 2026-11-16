import type { TimerSnapshot } from "../time/model.ts";
import type { BoardChange, BoardState } from "./board.ts";
import type { EnergyChange, EnergyState, EnergySummary } from "./energy.ts";
import type { ProjectFocusChange, ProjectStatus } from "./focus.ts";
export const colors = [
  { id: "berry", name: "Berry red", value: "#b52d6e" },
  { id: "red", name: "Red", value: "#c9443b" },
  { id: "orange", name: "Orange", value: "#d67814" },
  { id: "yellow", name: "Yellow", value: "#bd8d08" },
  { id: "olive", name: "Olive green", value: "#7a8724" },
  { id: "lime", name: "Lime green", value: "#55942c" },
  { id: "green", name: "Green", value: "#1e7e40" },
  { id: "mint", name: "Mint green", value: "#2c9484" },
  { id: "teal", name: "Teal", value: "#1b829c" },
  { id: "blue", name: "Blue", value: "#366db8" },
  { id: "purple", name: "Purple", value: "#6d46b8" },
  { id: "gray", name: "Gray", value: "#7d7b76" },
] as const;
export type Color = (typeof colors)[number]["id"];
export const itemColor = (id: string) =>
  colors.find((c) => c.id === id)?.value || "#7d7b76";
export type SavedFilter = {
  id: string;
  name: string;
  description: string;
  expression: string;
  color: Color;
  favorite: boolean;
};
export type SavedTag = {
  id: string;
  name: string;
  color: Color;
  favorite: boolean;
  count?: number;
};
export type ProjectCategory = "normal" | "habit";

export type SavedProject = {
  name: string;
  description: string;
  color?: Color;
  category?: ProjectCategory;
  status?: ProjectStatus;
  outcome?: string;
  nextTask?: string;
};
export type SubtaskChange = {
  revision: number;
  kind: "subtask";
} & (
  | { action: "link"; childUuid: string; parentUuid: string }
  | { action: "unlink"; childUuid: string }
);

export type DescriptionChange = {
  revision: number;
  kind: "description";
} & (
  | { action: "set"; uuid: string; description: string }
  | { action: "delete"; uuid: string }
);

export type WorkspaceTiming = {
  available: boolean;
  error?: string;
  backend?: "time" | "timewarrior";
  hardEnergyLimit?: boolean;
  timeEnabled?: boolean;
  timeAvailable?: boolean;
  timeError?: string;
  energyPeriod?: string;
  timezone?: string;
  historyComplete?: boolean;
};

export type BuiltinFilterPrefs = {
  favorites: string[];
  hidden: string[];
  sectionHidden?: boolean;
};

export type BuiltinFilterChange = {
  revision: number;
  kind: "builtinFilter";
  action: "favorite" | "hide" | "section";
  id?: string;
  value?: boolean;
};

import type {
  PreferencesChange,
  ThemeMode,
  ThemePalette,
  WorkspacePreferences,
} from "./preferences.ts";

export type {
  PreferencesChange,
  ThemeMode,
  ThemePalette,
  WorkspacePreferences,
};

export type Organization = {
  revision: number;
  filters: SavedFilter[];
  tags: SavedTag[];
  builtinFilterPrefs?: BuiltinFilterPrefs;
  preferences?: WorkspacePreferences;
  projectCounts?: Record<string, number>;
  projects?: SavedProject[];
  board?: BoardState;
  subtasks?: Record<string, string>;
  descriptions?: Record<string, string>;
  energyState?: EnergyState;
  energy?: EnergySummary;
  timing?: WorkspaceTiming;
  timerSnapshot?: TimerSnapshot;
};
export type OrganizationChange =
  | BoardChange
  | ProjectFocusChange
  | EnergyChange
  | SubtaskChange
  | DescriptionChange
  | BuiltinFilterChange
  | PreferencesChange
  | {
      revision: number;
      kind: "project";
      action: "save" | "delete";
      item: SavedProject;
      originalName?: string;
    }
  | {
      revision: number;
      kind: "filter" | "tag";
      action: "save" | "delete";
      item: SavedFilter | SavedTag;
    };
