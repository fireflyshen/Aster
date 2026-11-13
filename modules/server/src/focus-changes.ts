import {
  FOCUS_LIMIT,
  inProject,
  projectStatus,
  type ProjectFocusChange,
} from "../../core/workspace/focus.ts";
import type { SavedProject } from "../../core/workspace/organization.ts";

type GoalTask = { uuid: string; project?: string; status: string };
export function validateGoal(project: SavedProject, tasks: GoalTask[]) {
  if (
    project.outcome !== undefined &&
    (typeof project.outcome !== "string" ||
      project.outcome.length > 500 ||
      project.outcome.includes("\0"))
  )
    throw new Error("Finish line must be 500 characters or fewer.");
  if (projectStatus(project) === "active" && !project.outcome?.trim())
    throw new Error("Define a finish line before activating this project.");
  if (project.nextTask !== undefined && typeof project.nextTask !== "string")
    throw new Error("Choose a valid next task.");
  if (
    project.nextTask &&
    !tasks.some(
      (task) =>
        task.uuid === project.nextTask &&
        inProject(task.project, project.name) &&
        ["pending", "waiting"].includes(task.status),
    )
  )
    throw new Error(
      "The next task is no longer available in this project. Choose another task.",
    );
}
export function changeProjectFocus(
  projects: SavedProject[],
  change: ProjectFocusChange,
  tasks: GoalTask[],
) {
  if (
    !change ||
    typeof change.name !== "string" ||
    !["active", "later", "completed"].includes(change.status)
  )
    throw new Error("Choose a valid project status.");
  const selected = projects.find((project) => project.name === change.name);
  if (!selected)
    throw new Error("Project no longer exists. Reload to continue.");
  if (
    change.outcome !== undefined &&
    (typeof change.outcome !== "string" ||
      change.outcome.length > 500 ||
      change.outcome.includes("\0"))
  )
    throw new Error("Finish line must be 500 characters or fewer.");
  const next = projects.map((project) => ({ ...project }));
  const target = next.find((project) => project.name === selected.name)!;
  if (change.outcome !== undefined) target.outcome = change.outcome.trim();
  if (change.status === "active") {
    if (change.replaceProject !== undefined) {
      const replaced = next.find(
        (project) => project.name === change.replaceProject,
      );
      if (
        !replaced ||
        replaced.name === target.name ||
        projectStatus(replaced) !== "active"
      )
        throw new Error(
          "The project to pause has changed. Reload and choose again.",
        );
      replaced.status = "later";
    }
    const active = next.filter(
      (project) =>
        project.name !== target.name && projectStatus(project) === "active",
    );
    if (active.length >= FOCUS_LIMIT)
      throw new Error(
        "Three projects are already active. Choose one to pause.",
      );
    if (
      active.some(
        (project) =>
          inProject(target.name, project.name) ||
          inProject(project.name, target.name),
      )
    )
      throw new Error(
        "A parent or child project is already active. Use its focus slot or pause it first.",
      );
    if (!target.outcome?.trim())
      throw new Error("Define a finish line before activating this project.");
  } else if (change.replaceProject !== undefined)
    throw new Error("Only activation can replace a project.");
  if (
    change.status === "completed" &&
    tasks.some(
      (task) =>
        inProject(task.project, target.name) &&
        ["pending", "waiting"].includes(task.status),
    ) &&
    change.remaining !== "keep"
  )
    throw new Error(
      "This project has unfinished tasks. Confirm keeping them in Later before completing the project.",
    );
  target.status = change.status;
  return next;
}
