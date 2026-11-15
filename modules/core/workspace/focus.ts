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
      projectStatus(project) === "active" && inProject(name, project.name),
  );

/** Returns whether a task's project (or any ancestor project) has status "completed". */
export const isCompletedProject = (
  name: string | undefined,
  projects: SavedProject[] = [],
): boolean => {
  if (!name) return false;
  const exact = projects.find((project) => project.name === name);
  if (exact) return projectStatus(exact) === "completed";
  return projects.some(
    (project) =>
      projectStatus(project) === "completed" && inProject(name, project.name),
  );
};

/** Counts open tasks belonging to a project or any of its descendant subprojects. */
export const countProjectTasks = (
  projectCounts: Record<string, number> | undefined,
  projectName: string,
): number =>
  Object.entries(projectCounts || {}).reduce(
    (total, [name, count]) =>
      total + (inProject(name, projectName) ? count : 0),
    0,
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
