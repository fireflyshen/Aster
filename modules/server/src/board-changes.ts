import { randomUUID } from "node:crypto";
import {
  defaultBoard,
  placeCard,
  taskColumnId,
  UNSECTIONED,
  type BoardChange,
  type BoardState,
  type BoardTask,
} from "../../core/workspace/board.ts";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function changeBoardState(
  current: BoardState | undefined,
  input: BoardChange,
  tasks: BoardTask[],
): BoardState {
  const board = structuredClone(current || defaultBoard());
  if (input.action === "column.save") {
    const item = input.column;
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.trim().length > 60 ||
      /[\0\r\n]/.test(item.name)
    )
      throw new Error("Enter a column name of 1–60 characters.");
    const project = item.project?.trim() || "";
    if (project.length > 200 || /[\0\r\n]/.test(project))
      throw new Error("Invalid project for column.");
    const old = board.columns.find((column) => column.id === item.id);
    if (item.id && !old)
      throw new Error("This column no longer exists. Reload to continue.");
    if (
      board.columns.some(
        (column) =>
          column.id !== item.id &&
          (column.project || "") === project &&
          column.name.toLocaleLowerCase() ===
            item.name.trim().toLocaleLowerCase(),
      )
    )
      throw new Error("This column name already exists in this project.");
    if (old) {
      old.name = item.name.trim();
      if (item.project !== undefined) {
        if (project) old.project = project;
        else delete old.project;
      }
    } else {
      const projectColumns = board.columns.filter(
        (column) => (column.project || "") === project,
      );
      if (projectColumns.length >= 30)
        throw new Error("A project can have up to 30 columns.");
      if (board.columns.length >= 300)
        throw new Error("A board can have up to 300 columns.");
      board.columns.push({
        id: randomUUID(),
        name: item.name.trim(),
        ...(project ? { project } : {}),
      });
    }
  } else if (input.action === "column.delete") {
    const old = board.columns.find((column) => column.id === input.columnId);
    if (!old)
      throw new Error("This column no longer exists. Reload to continue.");
    board.columns = board.columns.filter((column) => column.id !== old.id);
    board.placements = board.placements.filter(
      (item) => item.columnId !== old.id,
    );
  } else if (input.action === "column.move") {
    const target = board.columns.find((column) => column.id === input.columnId);
    if (!target)
      throw new Error("This column no longer exists. Reload to continue.");
    const project = target.project || "";
    const projectIndices = board.columns
      .map((c, i) => ((c.project || "") === project ? i : -1))
      .filter((i) => i >= 0);
    const fromIdx = projectIndices.indexOf(
      board.columns.findIndex((column) => column.id === input.columnId),
    );
    if (fromIdx < 0 || !["left", "right"].includes(input.direction))
      throw new Error("Choose a valid column move.");
    const toIdx = fromIdx + (input.direction === "left" ? -1 : 1);
    if (toIdx < 0 || toIdx >= projectIndices.length)
      throw new Error("The column is already at the edge.");
    const actualFrom = projectIndices[fromIdx];
    const actualTo = projectIndices[toIdx];
    [board.columns[actualFrom], board.columns[actualTo]] = [
      board.columns[actualTo],
      board.columns[actualFrom],
    ];
  } else if (input.action === "task.move") {
    if (typeof input.uuid !== "string" || !uuidPattern.test(input.uuid))
      throw new Error("Invalid task UUID.");
    const task = tasks.find((task) => task.uuid === input.uuid);
    const target = board.columns.find((column) => column.id === input.columnId);
    if (!task || (!target && input.columnId !== UNSECTIONED))
      throw new Error(
        "The task or column no longer exists. Reload to continue.",
      );
    if (
      input.beforeUuid !== null &&
      (typeof input.beforeUuid !== "string" ||
        !uuidPattern.test(input.beforeUuid))
    )
      throw new Error("Choose a valid task position.");
    if (input.beforeUuid === input.uuid)
      throw new Error("Choose another task as the destination.");
    if (input.beforeUuid) {
      const before = tasks.find((task) => task.uuid === input.beforeUuid);
      if (!before || taskColumnId(before, board) !== input.columnId)
        throw Object.assign(
          new Error("The destination changed. Reload before moving the task."),
          { status: 409 },
        );
    }
    const moved = placeCard(
      board,
      tasks,
      input.uuid,
      input.columnId,
      input.beforeUuid,
    );
    if (
      task?.parent &&
      !moved.placements.some((item) => item.uuid === task.parent)
    ) {
      // Pin existing siblings before establishing a default for future occurrences.
      for (const sibling of tasks) {
        if (
          sibling.parent === task.parent &&
          sibling.uuid !== task.uuid &&
          !moved.placements.some((item) => item.uuid === sibling.uuid)
        )
          moved.placements.push({
            uuid: sibling.uuid,
            columnId: taskColumnId(sibling, board),
          });
      }
      moved.placements.push({
        uuid: task.parent,
        columnId: input.columnId,
      });
    }
    return moved;
  } else throw new Error("Unsupported board action.");
  return board;
}
