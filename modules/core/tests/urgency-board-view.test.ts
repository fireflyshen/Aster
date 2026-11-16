import assert from "node:assert/strict";
import test from "node:test";
import { compareTasksByUrgency, type TaskwarriorTask } from "../tasks/model.ts";
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

test("compareTasksByUrgency and loadTaskViewWithCatalog support saved filter sorted descending", async () => {
  const low = makeTask("t1", "Low score", { urgency: 1.9 });
  const high = makeTask("t2", "Top urgent", { urgency: 14.5, priority: "H" });
  const mid = makeTask("t3", "Medium score", { urgency: 6.2 });

  const ranked = [low, high, mid].sort(compareTasksByUrgency);
  assert.deepEqual(
    ranked.map((t) => t.uuid),
    ["t2", "t3", "t1"],
  );

  let requestedFilter = "";
  const fakeClient = {
    tasks: async (query: { filter?: string }) => {
      requestedFilter = query.filter || "";
      return {
        tasks: [high, mid, low],
        projects: [],
      };
    },
  } as unknown as WorkspaceClient;
  const loaded = await loadTaskViewWithCatalog(
    {} as TaskService,
    "filter:custom-urgency",
    {
      revision: 1,
      projects: [],
      filters: [
        {
          id: "custom-urgency",
          name: "Urgency",
          description: "",
          expression: "status:pending -WAITING",
          color: "orange",
          favorite: false,
        },
      ],
      tags: [],
      board: defaultBoard(),
    },
    "",
    fakeClient,
  );
  assert.equal(requestedFilter, "status:pending -WAITING");
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
