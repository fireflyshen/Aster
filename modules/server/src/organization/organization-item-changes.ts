import { randomUUID } from "node:crypto";
import { filterArguments, tagName } from "../../../core/tasks/filter.ts";
import {
  defaultBoard,
  inheritSubtaskColumns,
  placeTaskTree,
  taskColumnId,
  type BoardChange,
  type BoardTask,
} from "../../../core/workspace/board.ts";
import {
  findBuiltinFilter,
  normalizeBuiltinFilterPrefs,
} from "../../../core/workspace/builtin-filters.ts";
import {
  colors,
  type BuiltinFilterChange,
  type Organization,
  type OrganizationChange,
  type SavedFilter,
  type SavedTag,
  type ThemeMode,
  type ThemePalette,
  type WorkspacePreferences,
} from "../../../core/workspace/organization.ts";
import { changeBoardState } from "../tasks/board-changes.ts";

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

  const updated = list.filter((x) => x.id !== item.id && x.name !== old?.name);
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

/** Updates server-synced favorite, hidden, or section visibility preferences for built-in TW filters. */
export function applyBuiltinFilterChange(
  data: Organization,
  input: BuiltinFilterChange,
): void {
  const prefs = normalizeBuiltinFilterPrefs(data.builtinFilterPrefs);
  if (input.action === "section") {
    const sectionHidden =
      typeof input.value === "boolean" ? input.value : !prefs.sectionHidden;
    data.builtinFilterPrefs = normalizeBuiltinFilterPrefs({
      ...prefs,
      sectionHidden,
    });
    return;
  }
  if (input.action !== "favorite" && input.action !== "hide") {
    throw new Error("Unsupported action");
  }
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!findBuiltinFilter(id)) {
    throw new Error("Built-in filter unavailable.");
  }
  const key = input.action === "favorite" ? "favorites" : "hidden";
  const current = prefs[key].includes(id);
  const nextFlag = typeof input.value === "boolean" ? input.value : !current;
  const nextIds = nextFlag
    ? [...prefs[key], id]
    : prefs[key].filter((existing) => existing !== id);
  data.builtinFilterPrefs = normalizeBuiltinFilterPrefs({
    ...prefs,
    [key]: nextIds,
  });
}

const VALID_THEMES: readonly ThemeMode[] = ["light", "dark", "system"];
const VALID_PALETTES: readonly ThemePalette[] = [
  "aster",
  "todoist",
  "moonstone",
  "tangerine",
  "kale",
  "blueberry",
  "lavender",
  "raspberry",
];
const VALID_SIDEBAR_IDS = new Set([
  "focus",
  "pending",
  "today",
  "upcoming",
  "habits",
  "time",
  "organization",
]);
const VALID_GROUP_BY = new Set([
  "none",
  "today",
  "completed",
  "due",
  "project",
  "priority",
  "label",
]);

/** Validates and normalizes a workspace preferences patch before persisting to organization.json. */
export function normalizePreferencesPatch(raw: unknown): WorkspacePreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid preferences patch.");
  }
  const input = raw as Record<string, unknown>;
  const patch: WorkspacePreferences = {};
  if (input.theme !== undefined) {
    if (!VALID_THEMES.includes(input.theme as ThemeMode)) {
      throw new Error("Invalid theme mode.");
    }
    patch.theme = input.theme as ThemeMode;
  }
  if (input.palette !== undefined) {
    if (!VALID_PALETTES.includes(input.palette as ThemePalette)) {
      throw new Error("Invalid theme palette.");
    }
    patch.palette = input.palette as ThemePalette;
  }
  if (input.sidebarHidden !== undefined) {
    if (!Array.isArray(input.sidebarHidden)) {
      throw new Error("Invalid sidebar hidden items.");
    }
    patch.sidebarHidden = [
      ...new Set(
        input.sidebarHidden.filter(
          (id): id is string =>
            typeof id === "string" && VALID_SIDEBAR_IDS.has(id),
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
      input.completeBehavior !== "hide" &&
      input.completeBehavior !== "strikethrough"
    ) {
      throw new Error("Invalid completion behavior preference.");
    }
    patch.completeBehavior = input.completeBehavior;
  }
  if (input.layout !== undefined) {
    if (input.layout !== "list" && input.layout !== "board") {
      throw new Error("Invalid layout preference.");
    }
    patch.layout = input.layout;
  }
  if (input.view !== undefined) {
    if (
      !["today", "pending", "focus", "upcoming"].includes(String(input.view))
    ) {
      throw new Error("Invalid default view preference.");
    }
    patch.view = input.view as WorkspacePreferences["view"];
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
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      input.filterGroupBy as Record<string, unknown>,
    )) {
      if (
        typeof key === "string" &&
        key.length > 0 &&
        key.length <= 160 &&
        typeof value === "string" &&
        VALID_GROUP_BY.has(value)
      ) {
        clean[key] = value;
      }
    }
    patch.filterGroupBy = clean;
  }
  return patch;
}

/** Merges validated workspace UI preferences onto `data.preferences`. */
export function applyPreferencesChange(
  data: Organization,
  rawPatch: unknown,
): void {
  const patch = normalizePreferencesPatch(rawPatch);
  data.preferences = {
    ...(data.preferences || {}),
    ...patch,
  };
}
