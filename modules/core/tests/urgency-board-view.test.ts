import assert from "node:assert/strict";
import test from "node:test";
import { tasksForView, type TaskwarriorTask } from "../tasks/model.ts";
import { UNSECTIONED, columnTasks, defaultBoard } from "../workspace/board.ts";
import { loadTaskViewWithCatalog } from "../workspace/task-views.ts";
import type { TaskService } from "../tasks/service.ts";
import type { WorkspaceClient } from "../workspace/client.ts";

function makeTask(
  uuid: string,
  description: string,
  overrides: Partial<TaskwarriorTask> = {},
): TaskwarriorTask {
  return {
    uuid,
    description,
    status: "pending",
    tags: [],
    urgency: 1,
    depends: [],
    annotations: [],
    ...overrides,
  };
}

test("tasksForView and loadTaskViewWithCatalog support urgency view sorted descending", async () => {
  const low = makeTask("t1", "Low score", { urgency: 1.9 });
  const high = makeTask("t2", "Top urgent", { urgency: 14.5, priority: "H" });
  const mid = makeTask("t3", "Medium score", { urgency: 6.2 });
  const waiting = makeTask("t4", "Future wait", {
    status: "waiting",
    urgency: 18,
    wait: new Date(Date.now() + 86_400_000),
  });
  const done = makeTask("t5", "Already done", {
    status: "completed",
    urgency: 20,
  });

  const ranked = tasksForView([low, high, mid, waiting, done], "urgency");
  assert.deepEqual(
    ranked.map((t) => t.uuid),
    ["t2", "t3", "t1"],
  );

  const fakeClient = {
    tasks: async () => ({
      tasks: [low, high, mid, waiting, done],
      projects: [],
    }),
  } as unknown as WorkspaceClient;
  const loaded = await loadTaskViewWithCatalog(
    {} as TaskService,
    "urgency",
    {
      revision: 1,
      projects: [],
      filters: [],
      tags: [],
      board: defaultBoard(),
    },
    "",
    fakeClient,
  );
  assert.deepEqual(
    loaded.tasks.map((t) => t.uuid),
    ["t2", "t3", "t1"],
  );
});

test("columnTasks falls back out-of-scope project columns to UNSECTIONED when visibleColumnIds is passed", () => {
  const board = {
    ...defaultBoard(),
    columns: [{ id: "proj-col", name: "Phase 1", project: "Learn" }],
    placements: [{ uuid: "a", columnId: "proj-col" }],
  };
  const a = makeTask("a", "Scoped task");
  assert.equal(columnTasks([a], board, UNSECTIONED).length, 0);
  assert.equal(
    columnTasks([a], board, UNSECTIONED, new Set([UNSECTIONED])).length,
    1,
  );
});
