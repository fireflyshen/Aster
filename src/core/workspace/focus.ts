import type { SavedProject } from "./organization.ts";

export const FOCUS_LIMIT = 3;
export type ProjectStatus = "active" | "later" | "completed";
export const projectStatus = (project?: SavedProject): ProjectStatus =>
    project?.status || "later";
export const inProject = (name: string | undefined, project: string) =>
    !!name && (name === project || name.startsWith(project + "."));
export const focusProject = (
    name: string | undefined,
    projects: SavedProject[] = [],
) =>
    projects.find(
        (project) =>
            projectStatus(project) === "active" &&
            inProject(name, project.name),
    );
export type ProjectFocusChange = {
    revision: number;
    kind: "project";
    action: "status";
    name: string;
    status: ProjectStatus;
    outcome?: string;
    replaceProject?: string;
    remaining?: "keep";
};
