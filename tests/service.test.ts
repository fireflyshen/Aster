import assert from "node:assert/strict";
import test from "node:test";
import { createTaskService } from "../src/tasks/service.ts";
import { resolveConnection } from "../src/connection/settings.ts";
const uuid = "123e4567-e89b-42d3-a456-426614174000";
const connection = resolveConnection({ connectionMode: "local" }, "darwin");

test("Taskwarrior 2 is rejected before any task write", async () => {
  const calls: string[][] = [];
  const service = createTaskService(connection, async ({ args }) => {
    calls.push(args);
    return { stdout: "2.6.2", stderr: "" };
  });
  await assert.rejects(service.addTask({ description: "x", tags: [] }), /requires Taskwarrior 3/);
  assert.deepEqual(calls, [["--version"]]);
});

test("whole writes serialize and the queue recovers after a failure", async () => {
  const operations: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let active = 0;
  const service = createTaskService(connection, async ({ args }) => {
    if (args[0] === "--version") return { stdout: "3.5.0", stderr: "" };
    active++;
    assert.equal(active, 1);
    operations.push(args[1]);
    try {
      if (args[1] === "modify") {
        began();
        await gate;
        throw new Error("hook failed");
      }
      return { stdout: "ok", stderr: "" };
    } finally {
      active--;
    }
  });
  const first = service.editTask(uuid, { description: "a", tags: [] });
  const rejected = assert.rejects(first, /hook failed/);
  await started;
  const second = service.completeTask(uuid);
  assert.deepEqual(operations, ["modify"]);
  release();
  await Promise.all([rejected, second]);
  assert.deepEqual(operations, ["modify", "done"]);
});

test("completed history is loaded separately and starting does not stop other tasks", async () => {
  const calls: string[][] = [];
  const service = createTaskService(connection, async ({ args }) => {
    calls.push(args);
    return { stdout: args[0] === "--version" ? "3.5.0" : args.includes("export") ? "[]" : "ok", stderr: "" };
  });
  await service.loadTasks("completed");
  await service.startTask(uuid);
  await service.reopenTask(uuid);
  await service.deleteTask(uuid);
  await service.setTaskWait(uuid, "");
  assert.ok(calls[1].includes("status:completed"));
  assert.ok(!calls[1].includes("status:pending"));
  assert.ok(calls[1].includes("rc.hooks=off"));
  assert.ok(calls[1].includes("rc.gc=off"));
  assert.equal(calls.filter((args) => args.includes("stop")).length, 0);
  assert.deepEqual(
    calls.slice(2).map((args) => args.slice(0, 3)),
    [
      [uuid, "start", "rc.confirmation=off"],
      [uuid, "modify", "status:pending"],
      [uuid, "delete", "rc.confirmation=off"],
      [uuid, "modify", "wait:"],
    ],
  );
});
