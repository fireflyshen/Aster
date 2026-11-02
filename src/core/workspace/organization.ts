import type { BoardChange, BoardState } from "./board.ts";
import type { EnergyChange, EnergyState, EnergySummary } from "./energy.ts";
import type { ProjectFocusChange, ProjectStatus } from "./focus.ts";
export const colors = [
    { id: "berry", name: "Berry red", value: "#b8256f" },
    { id: "red", name: "Red", value: "#db4035" },
    { id: "orange", name: "Orange", value: "#ff9933" },
    { id: "yellow", name: "Yellow", value: "#e5b800" },
    { id: "olive", name: "Olive green", value: "#afb83b" },
    { id: "lime", name: "Lime green", value: "#7ecc49" },
    { id: "green", name: "Green", value: "#299438" },
    { id: "mint", name: "Mint green", value: "#4ac8b1" },
    { id: "teal", name: "Teal", value: "#158fad" },
    { id: "blue", name: "Blue", value: "#2b68e8" },
    { id: "purple", name: "Purple", value: "#884dcb" },
    { id: "gray", name: "Gray", value: "#808080" },
] as const;
export type Color = (typeof colors)[number]["id"];
export const itemColor = (id: string) =>
    colors.find((c) => c.id === id)?.value || "#808080";
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
export type Organization = {
    revision: number;
    filters: SavedFilter[];
    tags: SavedTag[];
    projectCounts?: Record<string, number>;
    projects?: SavedProject[];
    board?: BoardState;
    energyState?: EnergyState;
    energy?: EnergySummary;
};
export type OrganizationChange =
    | BoardChange
    | ProjectFocusChange
    | EnergyChange
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
