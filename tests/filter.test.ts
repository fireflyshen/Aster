import test from "node:test";
import assert from "node:assert/strict";
import { filterArguments, tagName } from "../src/core/tasks/filter.ts";
import { createTaskService } from "../src/core/tasks/service.ts";
import { resolveConnection } from "../src/core/connection/settings.ts";

test("native filters retain grouping, quoted attributes, virtual tags and @ shorthand", () => {
  assert.equal(tagName("Ready"), "Ready");
  assert.deepEqual(filterArguments('status:pending and (@Todo or +READY) project:"产品 设计" due.before:tomorrow'), [
    "status:pending",
    "and",
    "(",
    "+Todo",
    "or",
    "+READY",
    ")",
    "project:产品 设计",
    "due.before:tomorrow",
  ]);
  assert.deepEqual(filterArguments("-Blocked priority:H"), ["-Blocked", "priority:H"]);
});
test("filters cannot become commands or configuration overrides", () => {
  for (const expression of [
    "",
    "add",
    "delete",
    "execute touch x",
    "rc.hooks=on +Todo",
    "rc:foo",
    "rc.default.command:add",
    "+Todo modify +Bug",
    "+Todo;touch",
    "--",
    "( +Todo",
    "+Todo or",
    "and +Todo",
    'project:"x',
    "()",
    "+Todo\nadd",
  ])
    assert.throws(() => filterArguments(expression), expression);
  assert.deepEqual(filterArguments('description:"$(touch /tmp/not-run)"'), ["description:$(touch /tmp/not-run)"]);
  for (const name of ["", "READY", "PENDING", "Todo rc.confirmation=off", "+Todo", "x\ny"])
    assert.throws(() => tagName(name));
});
test("queries use fixed export and tag rename modifies only matching non-deleted tasks", async () => {
  const calls: string[][] = [];
  const service = createTaskService(resolveConnection({ connectionMode: "local" }, "darwin"), async ({ args }) => {
    calls.push(args);
    return { stdout: args[0] === "--version" ? "3.5.0" : args.includes("export") ? "[]" : "OK", stderr: "" };
  });
  await service.filterTasks("@Todo or priority:H");
  assert.deepEqual(calls[1].slice(0, 8), [
    "status.not:deleted",
    "(",
    "+Todo",
    "or",
    "priority:H",
    ")",
    "export",
    "rc.json.array=on",
  ]);
  await service.changeTag("Todo", "Doing");
  assert.deepEqual(calls[2].slice(0, 5), ["status.not:deleted", "+Todo", "modify", "-Todo", "+Doing"]);
  await assert.rejects(service.filterTasks("+Todo delete"));
  assert.equal(calls.length, 3);
});

test("virtual tags never appear in editable tags, while mixed-case Ready stays editable", async () => {
  const service = createTaskService(resolveConnection({ connectionMode: "local" }, "darwin"), async ({ args }) => ({
    stdout: args[0] === "--version" ? "3.5.0" : "ACTIVE\nREADY\nReady\nTodo\nPENDING",
    stderr: "",
  }));
  assert.deepEqual(await service.loadTags(), ["Ready", "Todo"]);
});
