import test from "node:test";
import assert from "node:assert/strict";
import {
  columnTasks,
  defaultBoard,
  placeCard,
  taskColumnId,
  UNSECTIONED,
} from "../../core/workspace/board.ts";

test("board membership is independent of completion, start, waiting dates and column names", () => {
  const tasks = [
    { uuid: "a", status: "completed" },
    {
      uuid: "b",
      status: "waiting",
      start: "2026-10-18",
      wait: "2027-01-01",
    },
  ];
  const board = {
    ...defaultBoard(),
    columns: [
      { id: "todo", name: "Todo" },
      { id: "done", name: "Done" },
    ],
  };
  const moved = placeCard(
    placeCard(board, tasks, "a", "todo", null),
    tasks,
    "b",
    "done",
    null,
  );
  assert.equal(taskColumnId(tasks[0], moved), "todo");
  assert.equal(taskColumnId(tasks[1], moved), "done");
  const pendingA = { ...tasks[0], status: "pending" };
  const completedB = { ...tasks[1], status: "completed" };
  assert.equal(taskColumnId(pendingA, moved), "todo");
  assert.equal(taskColumnId(completedB, moved), "done");
  assert.equal(taskColumnId(tasks[0], defaultBoard()), UNSECTIONED);
  assert.deepEqual(defaultBoard().columns, []);
});

test("reordering a filtered view preserves positions and placements of hidden tasks", () => {
  const tasks = [
    { uuid: "a", status: "pending" },
    { uuid: "b", status: "completed" },
  ];
  const board = {
    columns: [{ id: "custom", name: "Review" }],
    placements: [{ uuid: "hidden", columnId: "custom" }],
    order: ["hidden", "a", "b"],
  };
  const moved = placeCard(board, tasks, "b", UNSECTIONED, "a");
  assert.deepEqual(moved.order, ["hidden", "b", "a"]);
  assert.ok(moved.placements.some((item) => item.uuid === "hidden"));
  assert.deepEqual(
    columnTasks(tasks, moved, UNSECTIONED).map((task) => task.uuid),
    ["b", "a"],
  );
});

test("new repeating occurrences inherit the series home while explicit placements stay independent", () => {
  const parent = "series";
  const board = {
    columns: [
      { id: "ready", name: "Ready" },
      { id: "done", name: "Done" },
    ],
    order: [parent],
    placements: [
      { uuid: parent, columnId: "ready" },
      { uuid: "old", columnId: "done" },
    ],
  };
  assert.equal(taskColumnId({ uuid: "new", parent }, board), "ready");
  assert.equal(taskColumnId({ uuid: "old", parent }, board), "done");
  assert.equal(
    taskColumnId(
      { uuid: "new", parent },
      { ...board, columns: [{ id: "done", name: "Done" }] },
    ),
    "unsectioned",
  );
});

test("the first series home assignment does not relocate already generated siblings", async () => {
  const { changeBoardState } = await import("../src/board-changes.ts");
  const parent = "123e4567-e89b-42d3-a456-426614174000";
  const first = "123e4567-e89b-42d3-a456-426614174001";
  const sibling = "123e4567-e89b-42d3-a456-426614174002";
  const board = {
    columns: [{ id: "ready", name: "Ready" }],
    order: [],
    placements: [],
  };
  const moved = changeBoardState(
    board,
    {
      kind: "board",
      revision: 0,
      action: "task.move",
      uuid: first,
      columnId: "ready",
      beforeUuid: null,
    },
    [
      { uuid: first, status: "pending", parent },
      { uuid: sibling, status: "pending", parent },
    ],
  );
  assert.equal(taskColumnId({ uuid: first, parent }, moved), "ready");
  assert.equal(taskColumnId({ uuid: sibling, parent }, moved), "unsectioned");
  assert.equal(taskColumnId({ uuid: "new", parent }, moved), "ready");
});
