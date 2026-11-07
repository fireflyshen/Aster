import assert from "node:assert/strict";
import test from "node:test";
import { createTaskService } from "../src/core/tasks/service.ts";
import { resolveConnection } from "../src/core/connection/settings.ts";
import { addTaskArguments } from "../src/core/tasks/arguments.ts";
import { executeProcess } from "../src/core/connection/execute.ts";
const uuid = "123e4567-e89b-42d3-a456-426614174000";

test("recurrence requires first due date; invalid frequency and end date cannot become native arguments", () => {
  assert.throws(
    () =>
      addTaskArguments({
        description: "Repeat",
        tags: [],
        recur: "weekly",
      }),
    /first due date/,
  );
  assert.throws(
    () =>
      addTaskArguments({
        description: "Repeat",
        tags: [],
        due: "20261103T000000Z",
        recur: "weekly rc.confirmation=off",
      }),
    /repeat interval/,
  );
  assert.throws(
    () =>
      addTaskArguments({
        description: "Repeat",
        tags: [],
        due: "20261103T000000Z",
        recur: "weekly",
        until: "20261101T000000Z",
      }),
    /end date/,
  );
});
test("a note is literal text after the end-of-options marker; failure after task creation is unknown and not retried", async () => {
  const calls: string[][] = [];
  const service = createTaskService(
    resolveConnection({ connectionMode: "local" }, "darwin"),
    async ({ args }) => {
      calls.push(args);
      if (args[0] === "--version") return { stdout: "3.5.0", stderr: "" };
      if (args.includes("add"))
        return { stdout: `Created task ${uuid}.`, stderr: "" };
      if (args.includes("annotate")) throw new Error("failed");
      return { stdout: "[]", stderr: "" };
    },
  );
  await assert.rejects(
    service.addTask({
      description: "One task",
      tags: [],
      note: "Line 1\n+literal rc.confirmation=off",
    }),
    { outcome: "unknown" },
  );
  assert.equal(calls.filter((args) => args.includes("add")).length, 1);
  const args = calls.find((args) => args.includes("annotate"))!;
  assert.deepEqual(args.slice(args.indexOf("--")), [
    "--",
    "Line 1\n+literal rc.confirmation=off",
  ]);
});
test("task import streams JSON through stdin without shell interpolation", async () => {
  const input = '[{"description":"$HOME `literal`\\nline"}]';
  const result = await executeProcess({
    executable: process.execPath,
    args: ["-e", "process.stdin.pipe(process.stdout)"],
    timeout: 2000,
    input,
  });
  assert.equal(result.stdout, input);
});

test("restored custom field definitions do not turn a cold-start version check into a task query", async () => {
  const calls: string[][] = [];
  const service = createTaskService(
    resolveConnection({ connectionMode: "local" }, "darwin"),
    async ({ args }) => {
      calls.push(args);
      return {
        stdout: args[0] === "--version" ? "3.5.0" : "[]",
        stderr: "",
      };
    },
  );
  service.setRestoredSchema({ "uda.proof.type": "string" });
  await service.loadTasks();
  assert.deepEqual(calls[0], ["--version"]);
  assert.ok(calls[1].includes("rc.uda.proof.type=string"));
});
