import type { Organization } from "../../core/workspace/organization.ts";

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

  if (
    !data ||
    typeof data !== "object" ||
    !Number.isInteger(data.revision) ||
    !Array.isArray(data.filters) ||
    !Array.isArray(data.tags) ||
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
