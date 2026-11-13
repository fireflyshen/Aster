import type { BoardChange, BoardState } from "./board.ts";
import type { EnergyChange, EnergyState, EnergySummary } from "./energy.ts";
import type { ProjectFocusChange, ProjectStatus } from "./focus.ts";
export const colors = [
  { id: "berry", name: "Berry red", value: "#a3527a" },
  { id: "red", name: "Red", value: "#c2565c" },
  { id: "orange", name: "Orange", value: "#c78246" },
  { id: "yellow", name: "Yellow", value: "#bfa042" },
  { id: "olive", name: "Olive green", value: "#8c964e" },
  { id: "lime", name: "Lime green", value: "#6ba353" },
  { id: "green", name: "Green", value: "#3e8a62" },
  { id: "mint", name: "Mint green", value: "#489b8d" },
  { id: "teal", name: "Teal", value: "#3d7f9c" },
  { id: "blue", name: "Blue", value: "#4870b8" },
  { id: "purple", name: "Purple", value: "#7b62b3" },
  { id: "gray", name: "Gray", value: "#7c8291" },
] as const;
export type Color = (typeof colors)[number]["id"];
export const itemColor = (id: string) =>
  colors.find((c) => c.id === id)?.value || "#7c8291";
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
export type SavedProject = {
  name: string;
  description: string;
  color?: Color;
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

export type Organization = {
  revision: number;
  filters: SavedFilter[];
  tags: SavedTag[];
  projectCounts?: Record<string, number>;
  projects?: SavedProject[];
  board?: BoardState;
  subtasks?: Record<string, string>;
  descriptions?: Record<string, string>;
  energyState?: EnergyState;
  energy?: EnergySummary;
  timing?: { available: boolean; error?: string };
};
export type OrganizationChange =
  | BoardChange
  | ProjectFocusChange
  | EnergyChange
  | SubtaskChange
  | DescriptionChange
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
