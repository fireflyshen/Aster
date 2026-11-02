import test from "node:test";
import assert from "node:assert/strict";
import {
    columnTasks,
    defaultBoard,
    placeCard,
    taskColumnId,
    UNSECTIONED,
} from "../../../src/core/workspace/board.ts";

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
    assert.equal(
        taskColumnId({ ...tasks[0], status: "pending" }, moved),
        "todo",
    );
    assert.equal(
        taskColumnId({ ...tasks[1], status: "completed" }, moved),
        "done",
    );
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
