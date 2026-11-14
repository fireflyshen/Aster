import assert from "node:assert/strict";
import test from "node:test";
import type { TaskwarriorTask } from "../tasks/model.ts";
import type { TaskService } from "../tasks/service.ts";
import { defaultBoard } from "../workspace/board.ts";
import type { WorkspaceClient } from "../workspace/client.ts";
import {
  countProjectTasks,
  isCompletedProject,
} from "../workspace/focus.ts";
import type { Organization } from "../workspace/organization.ts";
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

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    revision: 1,
    projects: [],
    filters: [],
    tags: [],
    board: defaultBoard(),
    ...overrides,
  };
}

test("loadTaskViewWithCatalog focus view returns all active Focus project tasks and puts pinned nextTask first", async () => {
  const focusFirst = makeTask("t1", "Unpinned task", {
    project: "Study",
  });
  const focusChild = makeTask("t2", "Subproject task", {
    project: "Study.Cpp",
  });
  const focusNext = makeTask("t3", "Pinned next step", {
    project: "Study",
  });
  const laterTask = makeTask("t4", "Paused project task", {
    project: "Someday",
  });
  const doneProjectTask = makeTask("t5", "Archived project task", {
    project: "DoneProj.Phase1",
  });
  const doneTask = makeTask("t6", "Completed study task", {
    project: "Study",
    status: "completed",
  });

  const fakeClient = {
    tasks: async () => ({
      tasks: [
        focusFirst,
        focusChild,
        focusNext,
        laterTask,
        doneProjectTask,
        doneTask,
      ],
      projects: ["Study", "Study.Cpp", "Someday", "DoneProj.Phase1"],
    }),
  } as unknown as WorkspaceClient;

  const org = makeOrg({
    projects: [
      {
        name: "Study",
        description: "Learn C++",
        status: "active",
        nextTask: "t3",
      },
      { name: "Someday", description: "", status: "later" },
      { name: "DoneProj", description: "", status: "completed" },
    ],
  });

  const focusResult = await loadTaskViewWithCatalog(
    {} as TaskService,
    "focus",
    org,
    "",
    fakeClient,
  );
  assert.deepEqual(
    focusResult.tasks.map((task) => task.uuid),
    ["t3", "t1", "t2"],
  );

  const laterResult = await loadTaskViewWithCatalog(
    {} as TaskService,
    "later",
    org,
    "",
    fakeClient,
  );
  assert.deepEqual(
    laterResult.tasks.map((task) => task.uuid),
    ["t4"],
  );
});

test("loadTaskViewWithCatalog focus view shows tasks even when active Focus project has no pinned nextTask", async () => {
  const taskA = makeTask("a1", "Step 1", { project: "HostV1" });
  const taskB = makeTask("a2", "Step 2", { project: "HostV1" });
  const fakeClient = {
    tasks: async () => ({
      tasks: [taskA, taskB],
      projects: ["HostV1"],
    }),
  } as unknown as WorkspaceClient;

  const focusResult = await loadTaskViewWithCatalog(
    {} as TaskService,
    "focus",
    makeOrg({
      projects: [
        { name: "HostV1", description: "", status: "active" },
      ],
    }),
    "",
    fakeClient,
  );
  assert.deepEqual(
    focusResult.tasks.map((task) => task.uuid),
    ["a1", "a2"],
  );
});

test("countProjectTasks and isCompletedProject handle nested project paths", () => {
  const counts = {
    HostV1: 12,
    "HostV1.Cpp": 5,
    Other: 3,
  };
  assert.equal(countProjectTasks(counts, "HostV1"), 17);
  assert.equal(countProjectTasks(counts, "HostV1.Cpp"), 5);

  const projects = [
    { name: "Archive", description: "", status: "completed" as const },
    { name: "Active", description: "", status: "active" as const },
  ];
  assert.equal(isCompletedProject("Archive", projects), true);
  assert.equal(isCompletedProject("Archive.Sub", projects), true);
  assert.equal(isCompletedProject("Active", projects), false);
});
