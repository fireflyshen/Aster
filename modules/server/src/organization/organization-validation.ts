import type { Organization } from "../../../core/workspace/organization.ts";

/** Validates an already-parsed organization JSON payload and normalizes column projects. */
export function validateOrganizationData(raw: unknown): Organization {
  const data = raw as Organization & {
    energyState?: { day?: unknown; bonus?: unknown; elixirCount?: unknown };
  };
  const invalidBoardColumn = (column: {
    id: unknown;
    name: unknown;
    project?: unknown;
  }) =>
    !column ||
    typeof column.id !== "string" ||
    !column.id ||
    column.id === "unsectioned" ||
    typeof column.name !== "string" ||
    (column.project !== undefined && typeof column.project !== "string");

  const boardInvalid =
    data.board !== undefined &&
    (!data.board ||
      !Array.isArray(data.board.columns) ||
      !Array.isArray(data.board.placements) ||
      !Array.isArray(data.board.order) ||
      data.board.columns.some(invalidBoardColumn) ||
      new Set(data.board.columns.map((column) => column.id)).size !==
        data.board.columns.length ||
      data.board.placements.some(
        (item) =>
          !item ||
          typeof item.uuid !== "string" ||
          typeof item.columnId !== "string",
      ) ||
      data.board.order.some((uuid) => typeof uuid !== "string"));

  const subtasksInvalid =
    data.subtasks !== undefined &&
    (!data.subtasks ||
      typeof data.subtasks !== "object" ||
      Array.isArray(data.subtasks) ||
      Object.entries(data.subtasks).some(
        ([child, parent]) =>
          typeof child !== "string" ||
          typeof parent !== "string" ||
          !child ||
          !parent,
      ));

  const descriptionsInvalid =
    data.descriptions !== undefined &&
    (!data.descriptions ||
      typeof data.descriptions !== "object" ||
      Array.isArray(data.descriptions) ||
      Object.entries(data.descriptions).some(
        ([uuid, desc]) =>
          typeof uuid !== "string" || typeof desc !== "string" || !uuid,
      ));

  const stringList = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

  const builtinPrefsInvalid =
    data.builtinFilterPrefs !== undefined &&
    (!data.builtinFilterPrefs ||
      typeof data.builtinFilterPrefs !== "object" ||
      Array.isArray(data.builtinFilterPrefs) ||
      !stringList(data.builtinFilterPrefs.favorites) ||
      !stringList(data.builtinFilterPrefs.hidden) ||
      (data.builtinFilterPrefs.sectionHidden !== undefined &&
        typeof data.builtinFilterPrefs.sectionHidden !== "boolean"));

  const prefs = data.preferences as Record<string, unknown> | undefined;
  const preferencesInvalid =
    prefs !== undefined &&
    (!prefs ||
      typeof prefs !== "object" ||
      Array.isArray(prefs) ||
      (prefs.theme !== undefined &&
        !["light", "dark", "system"].includes(String(prefs.theme))) ||
      (prefs.palette !== undefined &&
        ![
          "aster",
          "todoist",
          "moonstone",
          "tangerine",
          "kale",
          "blueberry",
          "lavender",
          "raspberry",
        ].includes(String(prefs.palette))) ||
      (prefs.sidebarHidden !== undefined && !stringList(prefs.sidebarHidden)) ||
      (prefs.sidebarShowCounts !== undefined &&
        typeof prefs.sidebarShowCounts !== "boolean") ||
      (prefs.completeBehavior !== undefined &&
        !["hide", "strikethrough"].includes(String(prefs.completeBehavior))) ||
      (prefs.layout !== undefined &&
        !["list", "board"].includes(String(prefs.layout))) ||
      (prefs.view !== undefined &&
        !["today", "pending", "focus", "upcoming"].includes(
          String(prefs.view),
        )) ||
      (prefs.navOpen !== undefined && typeof prefs.navOpen !== "boolean") ||
      (prefs.filterGroupBy !== undefined &&
        (!prefs.filterGroupBy ||
          typeof prefs.filterGroupBy !== "object" ||
          Array.isArray(prefs.filterGroupBy) ||
          Object.entries(prefs.filterGroupBy).some(
            ([k, v]) => typeof k !== "string" || typeof v !== "string",
          ))));

  if (
    !data ||
    typeof data !== "object" ||
    !Number.isInteger(data.revision) ||
    !Array.isArray(data.filters) ||
    !Array.isArray(data.tags) ||
    builtinPrefsInvalid ||
    preferencesInvalid ||
    (data.projects !== undefined && !Array.isArray(data.projects)) ||
    (data.energyState !== undefined &&
      (!data.energyState ||
        typeof data.energyState.day !== "string" ||
        !Number.isInteger(data.energyState.bonus) ||
        !Number.isInteger(data.energyState.elixirCount))) ||
    boardInvalid ||
    subtasksInvalid ||
    descriptionsInvalid
  ) {
    throw new Error(
      "The filters and labels file is invalid. Check the data file.",
    );
  }

  if (data.board) {
    data.board.columns = data.board.columns.map(({ id, name, project }) => ({
      id,
      name,
      ...(project?.trim() ? { project: project.trim() } : {}),
    }));
  }
  return data;
}
