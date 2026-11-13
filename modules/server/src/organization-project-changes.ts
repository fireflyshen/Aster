import { filterArguments } from "../../core/tasks/filter.ts";
import { type BoardTask } from "../../core/workspace/board.ts";
import type { EnergyTaskLike } from "../../core/workspace/energy.ts";
import {
  FOCUS_LIMIT,
  inProject,
  projectStatus,
} from "../../core/workspace/focus.ts";
import {
  colors,
  type Organization,
  type OrganizationChange,
  type SavedProject,
} from "../../core/workspace/organization.ts";
import {
  projectNames,
  remapProject,
  validateProjectName,
} from "../../core/workspace/projects.ts";
import { validateGoal } from "./focus-changes.ts";

export type ProjectChangeContext = {
  tasks: (BoardTask & EnergyTaskLike & { project?: string })[];
  projects?: string[];
  projectRecords?: SavedProject[];
  changeProject?: (oldName: string, newName?: string) => Promise<unknown>;
};

/** Validates and applies a project save, rename, or delete operation across projects, filters, and board columns. */
export async function applyProjectSaveOrDeleteChange(
  data: Organization,
  input: Extract<
    OrganizationChange,
    { kind: "project"; action: "save" | "delete" }
  >,
  boardContext?: ProjectChangeContext,
): Promise<void> {
  const item = input.item as SavedProject | undefined;
  if (
    !["save", "delete"].includes(input.action) ||
    !item ||
    typeof item.name !== "string" ||
    !item.name.trim() ||
    item.name.length > 200 ||
    /[\0\r\n]/.test(item.name)
  ) {
    throw new Error("Choose a valid project.");
  }
  if (
    typeof item.description !== "string" ||
    item.description.length > 2000 ||
    item.description.includes("\0")
  ) {
    throw new Error("Description must be 2,000 characters or fewer.");
  }

  const name = item.name.trim();
  validateProjectName(name);
  const original = input.originalName ?? name;
  if (typeof original !== "string") throw new Error("Choose a valid project.");
  if (original) validateProjectName(original);

  const records = new Map(
    (boardContext?.projectRecords || []).map((project) => [
      project.name,
      project,
    ]),
  );
  for (const project of data.projects || []) records.set(project.name, project);

  const names = projectNames([
    ...(boardContext?.projects || []),
    ...records.keys(),
  ]);
  const originalRecord = records.get(original);
  if (item.status !== undefined && item.status !== originalRecord?.status) {
    throw new Error(
      "Use the project status action to activate, pause, or complete a project.",
    );
  }

  const next: SavedProject = {
    ...originalRecord,
    name,
    description: item.description.trim(),
  };
  if (item.color !== undefined) {
    if (!colors.some((color) => color.id === item.color)) {
      throw new Error("Choose a valid project color.");
    }
    next.color = item.color;
  }
  if (item.outcome !== undefined) next.outcome = item.outcome;
  if (item.nextTask !== undefined) next.nextTask = item.nextTask;

  if (
    (input.action === "delete" || input.originalName) &&
    !names.includes(original)
  ) {
    throw new Error("This project no longer exists. Reload to continue.");
  }

  const renaming = !!original && original !== name && input.action === "save";
  if (renaming && inProject(name, original)) {
    throw new Error("A project cannot be moved inside itself.");
  }

  const outside = new Set(
    names
      .filter((path) => !original || !inProject(path, original))
      .map((path) => path.toLocaleLowerCase()),
  );
  if (input.action === "save") {
    const targets = renaming
      ? names
          .filter((path) => inProject(path, original))
          .map((path) => remapProject(path, original, name))
      : [name];
    for (const target of targets) {
      validateProjectName(target);
      if (outside.has(target.toLocaleLowerCase())) {
        throw new Error("This project name already exists.");
      }
    }
  }

  const removing = input.action === "delete";
  const affected = (path: string | undefined) =>
    !!original && inProject(path, original);
  const tasks = (boardContext?.tasks || []).map((task) =>
    affected(task.project)
      ? {
          ...task,
          project: removing
            ? undefined
            : remapProject(task.project!, original, name),
        }
      : task,
  );
  if (!removing) {
    validateGoal(
      {
        ...next,
        nextTask:
          next.nextTask === originalRecord?.nextTask ? "" : next.nextTask,
      },
      tasks,
    );
  }

  let projects = [...records.values()].flatMap((project) => {
    if (affected(project.name)) {
      return removing
        ? []
        : [{ ...project, name: remapProject(project.name, original, name) }];
    }
    return [project];
  });
  if (!removing) {
    projects = [...projects.filter((project) => project.name !== name), next];
  }

  // Keep goal references valid when a selected task leaves its ancestor project.
  projects = projects.map((project) => {
    const previousTask = boardContext?.tasks.find(
      (task) => task.uuid === project.nextTask,
    );
    const moved =
      previousTask &&
      affected(previousTask.project) &&
      tasks.find((task) => task.uuid === previousTask.uuid);
    return moved && !inProject(moved.project, project.name)
      ? { ...project, nextTask: "" }
      : project;
  });

  const active = projects.filter(
    (project) => projectStatus(project) === "active",
  );
  if (
    active.length > FOCUS_LIMIT ||
    active.some((project, index) =>
      active
        .slice(index + 1)
        .some(
          (other) =>
            inProject(project.name, other.name) ||
            inProject(other.name, project.name),
        ),
    )
  ) {
    throw new Error(
      "A parent or child project is already active. Pause one before moving this branch.",
    );
  }

  // Prepare every reference before touching native data; UUID-based board placement remains unchanged.
  const filters = renaming
    ? data.filters.map((filter) => {
        const tokens = filterArguments(filter.expression).map((token) => {
          const match = /^(project(?:\.(?:is|equals|not|isnt))?):(.*)$/.exec(
            token,
          );
          return match && affected(match[2])
            ? match[1] + ":" + remapProject(match[2], original, name)
            : token;
        });
        const expression = tokens
          .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
          .join(" ");
        filterArguments(expression);
        return { ...filter, expression };
      })
    : data.filters;

  if (renaming || removing) {
    if (!boardContext?.changeProject) {
      throw new Error("Project changes are unavailable.");
    }
    await boardContext.changeProject(original, removing ? undefined : name);
    if (data.board) {
      if (renaming) {
        for (const col of data.board.columns) {
          if (col.project && inProject(col.project, original)) {
            col.project = remapProject(col.project, original, name);
          }
        }
      } else if (removing) {
        const removedIds = new Set(
          data.board.columns
            .filter((col) => col.project && inProject(col.project, original))
            .map((col) => col.id),
        );
        if (removedIds.size > 0) {
          data.board.columns = data.board.columns.filter(
            (col) => !removedIds.has(col.id),
          );
          data.board.placements = data.board.placements.filter(
            (p) => !removedIds.has(p.columnId),
          );
        }
      }
    }
  }

  data.projects = projects;
  data.filters = filters;
}
