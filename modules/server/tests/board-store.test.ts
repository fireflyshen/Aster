import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createOrganizationStore } from "../src/organization-store.ts";
import {
  columnTasks,
  taskColumnId,
  UNSECTIONED,
  type BoardChange,
} from "../../core/workspace/board.ts";

const a = "123e4567-e89b-42d3-a456-426614174000",
  b = "123e4567-e89b-42d3-a456-426614174001";
const tasks = [
  {
    uuid: a,
    status: "completed",
    start: "2026-10-17T10:00:00Z",
    end: "2026-10-18T10:00:00Z",
  },
  { uuid: b, status: "waiting", wait: "2027-01-01T10:00:00Z" },
];
const noTaskWrite = async () => {
  throw new Error("Board changes must never write to Taskwarrior");
};

test("custom columns and ordering persist independently of task state, including Done to Todo", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-board-store-");
  try {
    const path = dir + "/organization.json",
      store = createOrganizationStore(path);
    const originalTasks = structuredClone(tasks);
    let revision = 0;
    type Input = BoardChange extends infer Change
      ? Change extends BoardChange
        ? Omit<Change, "revision" | "kind">
        : never
      : never;
    const change = async (input: Input) => {
      const result = await store.change(
        { ...input, revision, kind: "board" } as BoardChange,
        [],
        noTaskWrite,
        {
          tasks,
        },
      );
      revision = result.revision;
      return result;
    };
    let saved = await change({
      action: "column.save",
      column: { id: "", name: "Todo" },
    });
    const todo = saved.board!.columns[0].id;
    saved = await change({
      action: "column.save",
      column: { id: "", name: "Done" },
    });
    const done = saved.board!.columns[1].id;
    await change({
      action: "task.move",
      uuid: a,
      columnId: done,
      beforeUuid: null,
    });
    saved = await change({
      action: "task.move",
      uuid: a,
      columnId: todo,
      beforeUuid: null,
    });
    assert.equal(taskColumnId(tasks[0], saved.board!), todo);
    await change({
      action: "task.move",
      uuid: b,
      columnId: todo,
      beforeUuid: a,
    });
    saved = await createOrganizationStore(path).read();
    assert.deepEqual(
      columnTasks(tasks, saved.board!, todo).map((task) => task.uuid),
      [b, a],
    );
    await change({
      action: "task.move",
      uuid: a,
      columnId: todo,
      beforeUuid: b,
    });
    saved = await change({
      action: "column.save",
      column: { id: todo, name: "Review" },
    });
    assert.deepEqual(
      columnTasks(tasks, saved.board!, todo).map((task) => task.uuid),
      [a, b],
    );
    saved = await change({
      action: "column.move",
      columnId: done,
      direction: "left",
    });
    assert.equal(saved.board!.columns[0].id, done);
    await change({ action: "column.delete", columnId: todo });
    saved = await change({ action: "column.delete", columnId: done });
    assert.deepEqual(saved.board!.columns, []);
    assert.equal(taskColumnId(tasks[0], saved.board!), UNSECTIONED);
    assert.equal(taskColumnId(tasks[1], saved.board!), UNSECTIONED);
    assert.deepEqual(tasks, originalTasks);
    assert.deepEqual(
      (await createOrganizationStore(path).read()).board,
      saved.board,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("conflicts and invalid destinations cannot alter stored organization or tasks", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-board-errors-");
  try {
    const store = createOrganizationStore(dir + "/organization.json");
    const context = { tasks };
    const create = {
      kind: "board",
      action: "column.save",
      revision: 0,
      column: { id: "", name: "Review" },
    } as const;
    const saved = await store.change(create, [], noTaskWrite, context);
    const columnId = saved.board!.columns[0].id;
    await assert.rejects(store.change(create, [], noTaskWrite, context), {
      status: 409,
    });
    for (const invalid of [
      { action: "column.save", column: { id: "", name: "review" } },
      { action: "column.delete", columnId: "missing" },
      { action: "column.delete", columnId: UNSECTIONED },
      { action: "task.move", uuid: "all", columnId, beforeUuid: null },
      {
        action: "task.move",
        uuid: a,
        columnId: "missing",
        beforeUuid: null,
      },
      { action: "task.move", uuid: a, columnId, beforeUuid: b },
      { action: "task.move", uuid: a, columnId, beforeUuid: a },
    ])
      await assert.rejects(
        store.change(
          { ...invalid, revision: 1, kind: "board" } as BoardChange,
          [],
          noTaskWrite,
          context,
        ),
      );
    assert.deepEqual(await store.read(), saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy state columns become ordinary removable columns without losing placements", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-board-legacy-");
  try {
    const path = dir + "/organization.json";
    await writeFile(
      path,
      JSON.stringify({
        revision: 1,
        filters: [],
        tags: [],
        board: {
          columns: ["todo", "doing", "done"].map((id) => ({
            id,
            name: id,
            stage: id,
          })),
          placements: [{ uuid: a, columnId: "done" }],
          order: [a],
        },
      }),
    );
    const store = createOrganizationStore(path);
    const legacy = await store.read();
    assert.deepEqual(legacy.board!.columns[2], {
      id: "done",
      name: "done",
    });
    const moved = await store.change(
      {
        kind: "board",
        action: "task.move",
        revision: 1,
        uuid: a,
        columnId: "todo",
        beforeUuid: null,
      },
      [],
      noTaskWrite,
      { tasks },
    );
    assert.equal(taskColumnId(tasks[0], moved.board!), "todo");
    const deleted = await store.change(
      {
        kind: "board",
        action: "column.delete",
        revision: 2,
        columnId: "todo",
      },
      [],
      noTaskWrite,
      { tasks },
    );
    assert.equal(taskColumnId(tasks[0], deleted.board!), UNSECTIONED);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("columns are scoped to project and update when project is renamed or removed", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-board-project-");
  try {
    const path = dir + "/organization.json",
      store = createOrganizationStore(path);
    let revision = 0;
    const change = async (
      input: any,
      currentProjects: string[] = ["ProjectA", "ProjectB"],
    ) => {
      const result = await store.change(
        { ...input, revision } as any,
        [],
        noTaskWrite,
        {
          tasks,
          projects: currentProjects,
          changeProject: async () => {},
        },
      );
      revision = result.revision;
      return result;
    };
    // Create column for Project A
    let saved = await change({
      kind: "board",
      action: "column.save",
      column: { id: "", name: "Review", project: "ProjectA" },
    });
    const colA = saved.board!.columns.find(
      (c: any) => c.project === "ProjectA",
    );
    assert(colA);
    assert.equal(colA.name, "Review");
    assert.equal(colA.project, "ProjectA");

    // Create column with same name for Project B (should succeed since different projects)
    saved = await change({
      kind: "board",
      action: "column.save",
      column: { id: "", name: "Review", project: "ProjectB" },
    });
    const colB = saved.board!.columns.find(
      (c: any) => c.project === "ProjectB",
    );
    assert(colB);
    assert.notEqual(colA.id, colB.id);

    // Duplicate name in same project should fail
    await assert.rejects(
      () =>
        change({
          kind: "board",
          action: "column.save",
          column: { id: "", name: "Review", project: "ProjectA" },
        }),
      /already exists/,
    );

    // Renaming ProjectA to ProjectA-Renamed updates column's project
    saved = await change({
      kind: "project",
      action: "save",
      originalName: "ProjectA",
      item: { name: "ProjectA-Renamed", description: "" },
    });
    const colARenamed = saved.board!.columns.find((c: any) => c.id === colA.id);
    assert.ok(colARenamed);
    assert.equal(colARenamed.project, "ProjectA-Renamed");

    // Deleting ProjectB removes its columns
    saved = await change(
      {
        kind: "project",
        action: "delete",
        originalName: "ProjectB",
        item: { name: "ProjectB", description: "" },
      },
      ["ProjectA-Renamed", "ProjectB"],
    );
    assert.equal(
      saved.board!.columns.some((c: any) => c.project === "ProjectB"),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hierarchy, section and order move atomically and survive reload and undo", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-tree-move-");
  try {
    const c = "123e4567-e89b-42d3-a456-426614174002";
    const path = dir + "/organization.json";
    const taskList = [
      { uuid: a, status: "pending" },
      { uuid: b, status: "pending" },
      { uuid: c, status: "pending" },
    ];
    const originalTasks = structuredClone(taskList);
    await writeFile(
      path,
      JSON.stringify({
        revision: 0,
        filters: [],
        tags: [],
        subtasks: { [b]: a, [c]: b },
        board: {
          columns: [
            { id: "one", name: "One" },
            { id: "two", name: "Two" },
          ],
          placements: [{ uuid: a, columnId: "one" }],
          order: [a, b, c],
        },
      }),
    );
    const store = createOrganizationStore(path);
    const move = (
      revision: number,
      uuid: string,
      columnId: string,
      beforeUuid: string | null,
      parentUuid?: string | null,
    ) =>
      store.change(
        {
          kind: "board",
          action: "task.move",
          revision,
          uuid,
          columnId,
          beforeUuid,
          parentUuid,
        },
        [],
        noTaskWrite,
        { tasks: taskList },
      );
    let saved = await move(0, b, "two", null, null);
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.subtasks, { [c]: b });
    assert.equal(taskColumnId(taskList[1], saved.board!), "two");
    assert.equal(taskColumnId(taskList[2], saved.board!), "two");
    saved = await createOrganizationStore(path).read();
    assert.deepEqual(saved.subtasks, { [c]: b });
    saved = await move(1, b, "one", null, a);
    assert.deepEqual(saved.subtasks, { [b]: a, [c]: b });
    assert.equal(taskColumnId(taskList[2], saved.board!), "one");
    // Existing children may have no explicit placement: their parent's section is authoritative.
    saved = await move(2, c, "one", b, a);
    assert.equal(saved.subtasks![c], a);
    assert.ok(saved.board!.order.indexOf(c) < saved.board!.order.indexOf(b));
    await assert.rejects(move(3, a, "one", null, b), /Circular/);
    assert.equal((await store.read()).revision, 3);
    await assert.rejects(move(2, b, "two", null, null), /another window/);
    assert.deepEqual(taskList, originalTasks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("moving before an implicitly placed sibling and rejecting foreign parents are atomic", async () => {
  const dir = await mkdtemp(tmpdir() + "/aster-tree-siblings-");
  try {
    const c = "123e4567-e89b-42d3-a456-426614174002";
    const path = dir + "/organization.json";
    const taskList = [
      { uuid: a, status: "pending", project: "A" },
      { uuid: b, status: "pending", project: "A" },
      { uuid: c, status: "pending", project: "B" },
    ];
    await writeFile(
      path,
      JSON.stringify({
        revision: 0,
        filters: [],
        tags: [],
        subtasks: { [b]: a },
        board: {
          columns: [{ id: "one", name: "One" }],
          placements: [{ uuid: a, columnId: "one" }],
          order: [a, b, c],
        },
      }),
    );
    const store = createOrganizationStore(path);
    const saved = await store.change(
      {
        kind: "board",
        action: "task.move",
        revision: 0,
        uuid: c,
        columnId: "one",
        beforeUuid: b,
        parentUuid: null,
      },
      [],
      noTaskWrite,
      { tasks: taskList },
    );
    assert.ok(saved.board!.order.indexOf(c) < saved.board!.order.indexOf(b));
    await assert.rejects(
      store.change(
        {
          kind: "board",
          action: "task.move",
          revision: 1,
          uuid: b,
          columnId: "one",
          beforeUuid: null,
          parentUuid: c,
        },
        [],
        noTaskWrite,
        { tasks: taskList },
      ),
      /same project/,
    );
    assert.deepEqual(await store.read(), saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
