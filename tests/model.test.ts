import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskwarriorTasks, taskGroup, tasksForView, type TaskwarriorTask } from "../src/tasks/model.ts";

test("parses and sorts Taskwarrior export data", () => {
  const tasks = parseTaskwarriorTasks(`warning before JSON
[
  {"id":2,"uuid":"123e4567-e89b-42d3-a456-426614174002","description":"Later","status":"pending","urgency":1,"wait":"20260912T010000Z"},
  {"id":1,"uuid":"123e4567-e89b-42d3-a456-426614174001","description":"First","status":"pending","project":"Work","tags":["focus"],"urgency":9,"due":"20260910T010000Z","annotations":[{"entry":"20260909T010000Z","description":"Bring notes"}]}
]
trailing output`);

  assert.deepEqual(
    tasks.map((task) => task.description),
    ["First", "Later"],
  );
  assert.equal(tasks[0].project, "Work");
  assert.deepEqual(tasks[0].tags, ["focus"]);
  assert.equal(tasks[0].annotations[0].description, "Bring notes");
  assert.equal(tasks[1].wait?.toISOString(), "2026-09-12T01:00:00.000Z");
});

function task(values: Partial<TaskwarriorTask>): TaskwarriorTask {
  return {
    uuid: "123e4567-e89b-42d3-a456-426614174000",
    description: "Task",
    status: "pending",
    tags: [],
    urgency: 0,
    depends: [],
    annotations: [],
    ...values,
  };
}

test("groups pending tasks by the most useful daily state", () => {
  const now = new Date(2026, 8, 10, 12);
  assert.equal(taskGroup(task({ due: new Date(2026, 8, 9, 18) }), now), "overdue");
  assert.equal(taskGroup(task({ due: new Date(2026, 8, 10, 18) }), now), "today");
  assert.equal(taskGroup(task({ wait: new Date(2026, 8, 11) }), now), "waiting");
  assert.equal(taskGroup(task({ due: new Date(2026, 8, 9, 18), wait: new Date(2026, 8, 11) }), now), "waiting");
  assert.equal(taskGroup(task({ depends: ["another-uuid"] }), now), "pending");
  assert.equal(taskGroup(task({ scheduled: new Date(2026, 8, 11) }), now), "pending");
  assert.equal(taskGroup(task({}), now), "pending");
});

test("today excludes waiting tasks and expired waits become available", () => {
  const now = new Date(2026, 8, 10, 12);
  const overdue = task({ description: "overdue", due: new Date(2026, 8, 9) });
  const waiting = task({ description: "waiting", due: new Date(2026, 8, 9), wait: new Date(2026, 8, 11) });
  const expired = task({
    description: "expired",
    status: "waiting",
    due: new Date(2026, 8, 10),
    wait: new Date(2026, 8, 10, 9),
  });
  const completed = task({ description: "done", status: "completed", due: new Date(2026, 8, 9) });
  const deleted = task({ status: "deleted" });
  const tasks = [overdue, waiting, expired, completed, deleted];
  assert.deepEqual(
    tasksForView(tasks, "today", now).map((value) => value.description),
    ["overdue", "expired"],
  );
  assert.deepEqual(tasksForView(tasks, "waiting", now), [waiting]);
  assert.deepEqual(tasksForView(tasks, "completed", now), [completed]);
  assert.equal(tasksForView(tasks, "pending", now).length, 3);
});

test("completed history sorts by completion time and ignores malformed entries", () => {
  const tasks = parseTaskwarriorTasks(
    JSON.stringify([
      null,
      1,
      { description: "no UUID" },
      { uuid: "older", description: "older", status: "completed", end: "20261001T000000Z", urgency: 100 },
      { uuid: "newer", description: "newer", status: "completed", end: "20261005T000000Z", urgency: 0 },
    ]),
  );
  assert.deepEqual(
    tasks.map((value) => value.description),
    ["newer", "older"],
  );
  assert.equal(tasks[0].end?.toISOString(), "2026-10-05T00:00:00.000Z");
});
