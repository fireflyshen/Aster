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
