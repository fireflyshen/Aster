import assert from "node:assert/strict";
import test from "node:test";
import type { TaskwarriorTask } from "../tasks/model.ts";
import type { TaskService } from "../tasks/service.ts";
import { defaultBoard } from "../workspace/board.ts";
import type { WorkspaceClient } from "../workspace/client.ts";
import type { Organization } from "../workspace/organization.ts";
import { buildSubtaskMeta, selectSectionTasks } from "../workspace/subtasks.ts";
import { loadTaskViewWithCatalog } from "../workspace/task-views.ts";

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

function makeOrg(subtasks: Record<string, string>): Organization {
  return {
    revision: 1,
    projects: [{ name: "Work", status: "active", description: "" }],
    filters: [],
    tags: [],
    board: defaultBoard(),
    subtasks,
  };
}

test("buildSubtaskMeta and selectSectionTasks fold visible children without duplicating or faking tree rows", () => {
  const parent = makeTask("p1", "Ship Aster", { project: "Work" });
  const pendingChild = makeTask("c1", "Verify build", { project: "Work" });
  const doneChild = makeTask("c2", "Design UX", {
    project: "Work",
    status: "completed",
  });
  const outOfSectionParent = makeTask("p2", "Later goal");
  const orphanChild = makeTask("c3", "Urgent step due today");

  const allTasks = [
    parent,
    pendingChild,
    doneChild,
    outOfSectionParent,
    orphanChild,
  ];
  const org = makeOrg({
    c1: "p1",
    c2: "p1",
    c3: "p2",
  });

  const meta = buildSubtaskMeta(allTasks, org);
  assert.deepEqual(meta.stats.p1, { done: 1, total: 2 });
  assert.equal(meta.childrenOf.get("p1")?.length, 2);

  // Same section contains parent and pendingChild + orphanChild whose parent is absent
  const sectionEntries = selectSectionTasks(
    [parent, pendingChild, orphanChild],
    meta,
  );
  assert.deepEqual(
    sectionEntries.map((entry) => entry.task.uuid),
    ["p1", "c3"],
  );
  assert.equal(sectionEntries[0].orphanedFromParent, false);
  assert.equal(sectionEntries[0].children.length, 2);
  assert.equal(sectionEntries[1].orphanedFromParent, true);
  assert.equal(sectionEntries[1].parentTask?.uuid, "p2");
});

test("loadTaskViewWithCatalog keeps completed subtasks out of active project rows while preserving allTasks", async () => {
  const parent = makeTask("p1", "Parent", { project: "Work" });
  const pendingChild = makeTask("c1", "Open Step", { project: "Work" });
  const doneChild = makeTask("c2", "Done Step", {
    project: "Work",
    status: "completed",
  });
  const inboxTask = makeTask("i1", "Inbox Note");
  const serverTasks = [parent, pendingChild, doneChild, inboxTask];

  const fakeService = {} as TaskService;
  const fakeClient = {
    tasks: async () => ({
      tasks: serverTasks,
      projects: ["Work"],
    }),
  } as unknown as WorkspaceClient;

  const projectResult = await loadTaskViewWithCatalog(
    fakeService,
    "project:Work",
    makeOrg({ c1: "p1", c2: "p1" }),
    "",
    fakeClient,
  );
  assert.deepEqual(
    projectResult.tasks.map((task) => task.uuid),
    ["p1", "c1"],
  );
  assert.deepEqual(
    projectResult.allTasks?.map((task) => task.uuid),
    ["p1", "c1", "c2", "i1"],
  );
});
