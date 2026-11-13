import { randomUUID } from "node:crypto";
import { filterArguments, tagName } from "../../core/tasks/filter.ts";
import {
  defaultBoard,
  inheritSubtaskColumns,
  placeTaskTree,
  taskColumnId,
  type BoardChange,
  type BoardTask,
} from "../../core/workspace/board.ts";
import {
  colors,
  type Organization,
  type OrganizationChange,
  type SavedFilter,
  type SavedTag,
} from "../../core/workspace/organization.ts";
import { changeBoardState } from "./board-changes.ts";

/** Validates and applies board column/task placement changes onto `data`. */
export function applyBoardChange(
  data: Organization,
  input: BoardChange,
  tasks: (BoardTask & { project?: string })[],
): void {
  const sourceBoard =
    input.action === "task.move"
      ? inheritSubtaskColumns(
          data.board || defaultBoard(),
          tasks,
          data.subtasks || {},
        )
      : data.board;
  let board = changeBoardState(sourceBoard, input, tasks);

  if (input.action === "task.move") {
    const links = { ...data.subtasks };
    if (input.parentUuid !== undefined) {
      if (input.parentUuid !== null) {
        const parent = tasks.find((task) => task.uuid === input.parentUuid);
        const child = tasks.find((task) => task.uuid === input.uuid);
        if (
          !parent ||
          !child ||
          (parent.project || "") !== (child.project || "")
        ) {
          throw new Error("Choose a parent task in the same project.");
        }
        const visited = new Set([input.uuid]);
        let ancestor: string | undefined = parent.uuid;
        while (ancestor) {
          if (visited.has(ancestor)) {
            throw new Error("Circular subtask dependency is not allowed.");
          }
          visited.add(ancestor);
          ancestor = links[ancestor];
        }
        // The destination parent and child must stay in the same section.
        if (taskColumnId(parent, board) !== input.columnId) {
          throw new Error("Choose a parent task in the destination section.");
        }
        links[input.uuid] = parent.uuid;
      } else {
        delete links[input.uuid];
      }
    }
    board = placeTaskTree(
      board,
      tasks,
      links,
      input.uuid,
      input.columnId,
      input.beforeUuid,
    );
    data.subtasks = links;
  }

  data.board = board;
}

/** Applies subtask link/unlink updates onto `data`. */
export function applySubtaskChange(
  data: Organization,
  input: Extract<OrganizationChange, { kind: "subtask" }>,
): void {
  data.subtasks = data.subtasks ? { ...data.subtasks } : {};
  if (input.action === "link") {
    if (
      typeof input.childUuid !== "string" ||
      typeof input.parentUuid !== "string" ||
      !input.childUuid ||
      !input.parentUuid
    ) {
      throw new Error("Invalid subtask link parameters.");
    }
    if (input.childUuid === input.parentUuid) {
      throw new Error("A task cannot be a subtask of itself.");
    }
    let cur: string | undefined = input.parentUuid;
    while (cur) {
      if (cur === input.childUuid) {
        throw new Error("Circular subtask dependency is not allowed.");
      }
      cur = data.subtasks[cur];
    }
    data.subtasks[input.childUuid] = input.parentUuid;
  } else if (input.action === "unlink") {
    if (typeof input.childUuid !== "string" || !input.childUuid) {
      throw new Error("Invalid subtask unlink parameters.");
    }
    delete data.subtasks[input.childUuid];
  }
}

/** Applies task markdown description updates onto `data`. */
export function applyDescriptionChange(
  data: Organization,
  input: Extract<OrganizationChange, { kind: "description" }>,
): void {
  data.descriptions = data.descriptions ? { ...data.descriptions } : {};
  if (input.action === "set") {
    if (
      typeof input.uuid !== "string" ||
      !input.uuid ||
      typeof input.description !== "string"
    ) {
      throw new Error("Invalid description parameters.");
    }
    if (input.description.trim()) {
      data.descriptions[input.uuid] = input.description;
    } else {
      delete data.descriptions[input.uuid];
    }
  } else if (input.action === "delete") {
    if (typeof input.uuid !== "string" || !input.uuid) {
      throw new Error("Invalid description parameters.");
    }
    delete data.descriptions[input.uuid];
  } else {
    throw new Error("Unsupported description action.");
  }
}

/** Applies saved filter or tag create/rename/delete changes and propagates tag renames to filters. */
export async function applyFilterOrTagChange(
  data: Organization,
  input: Extract<OrganizationChange, { kind: "filter" | "tag" }>,
  available: SavedTag[],
  effect: (oldTag: SavedTag, next?: SavedTag) => Promise<unknown>,
): Promise<void> {
  if (!["save", "delete"].includes(input.action)) {
    throw new Error("Unsupported action");
  }
  const item = input.item;
  if (!item || typeof item.id !== "string" || item.id.length > 160) {
    throw new Error("Invalid item");
  }

  const list = input.kind === "filter" ? data.filters : data.tags;
  const old = (input.kind === "tag" ? available : list).find(
    (x) => x.id === item.id,
  );
  let next: SavedFilter | SavedTag | undefined;

  if (input.action === "save") {
    if (
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.trim().length > 60 ||
      /[\0\r\n]/.test(item.name)
    ) {
      throw new Error("Name must contain 1–60 characters.");
    }
    if (
      !colors.some((c) => c.id === item.color) ||
      typeof item.favorite !== "boolean"
    ) {
      throw new Error("Choose a valid color and favorite setting.");
    }
    if (
      (input.kind === "tag" ? available : list).some(
        (x) =>
          x.id !== item.id &&
          x.name.toLocaleLowerCase() === item.name.trim().toLocaleLowerCase(),
      )
    ) {
      throw new Error("This name already exists.");
    }
    next = {
      id: old?.id || randomUUID(),
      name: item.name.trim(),
      color: item.color,
      favorite: item.favorite,
    };
    if (input.kind === "tag") {
      tagName(next.name);
    } else {
      const filter = item as SavedFilter;
      if (
        typeof filter.description !== "string" ||
        filter.description.length > 500
      ) {
        throw new Error("Description must be 500 characters or fewer.");
      }
      filterArguments(filter.expression);
      next = {
        ...next,
        description: filter.description,
        expression: filter.expression.trim(),
      };
    }
  } else if (!old) {
    throw new Error("This item no longer exists. Reload to continue.");
  }

  if (
    input.kind === "tag" &&
    old &&
    (input.action === "delete" || next?.name !== old.name)
  ) {
    await effect(old, next);
  }

  const updated = list.filter(
    (x) => x.id !== item.id && x.name !== old?.name,
  );
  if (next) updated.push(next);

  if (input.kind === "filter") {
    data.filters = updated as SavedFilter[];
    return;
  }

  data.tags = updated as SavedTag[];
  if (old && next && old.name !== next.name) {
    data.filters = data.filters.map((filter) => ({
      ...filter,
      expression: filterArguments(filter.expression)
        .map((token) =>
          token === `+${old.name}`
            ? `+${next.name}`
            : token === `-${old.name}`
              ? `-${next.name}`
              : token,
        )
        .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
        .join(" "),
    }));
  }
}
