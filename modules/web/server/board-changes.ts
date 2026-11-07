import { randomUUID } from "node:crypto";
import {
  defaultBoard,
  placeCard,
  taskColumnId,
  UNSECTIONED,
  type BoardChange,
  type BoardState,
  type BoardTask,
} from "../../../src/core/workspace/board.ts";

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
    const old = board.columns.find((column) => column.id === item.id);
    if (item.id && !old)
      throw new Error("This column no longer exists. Reload to continue.");
    if (
      board.columns.some(
        (column) =>
          column.id !== item.id &&
          column.name.toLocaleLowerCase() ===
            item.name.trim().toLocaleLowerCase(),
      )
    )
      throw new Error("This column name already exists.");
    if (old) old.name = item.name.trim();
    else {
      if (board.columns.length >= 30)
        throw new Error("A board can have up to 30 columns.");
      board.columns.push({ id: randomUUID(), name: item.name.trim() });
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
    const from = board.columns.findIndex(
      (column) => column.id === input.columnId,
    );
    if (from < 0 || !["left", "right"].includes(input.direction))
      throw new Error("Choose a valid column move.");
    const to = from + (input.direction === "left" ? -1 : 1);
    if (to < 0 || to >= board.columns.length)
      throw new Error("The column is already at the edge.");
    [board.columns[from], board.columns[to]] = [
      board.columns[to],
      board.columns[from],
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
