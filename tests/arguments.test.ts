import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskArguments,
  editTaskArguments,
  taskActionArguments,
  waitTaskArguments,
  reopenTaskArguments,
} from "../src/tasks/arguments.ts";
const uuid = "123e4567-e89b-42d3-a456-426614174000";

test("uses permanent UUIDs and refuses bulk selectors", () => {
  for (const action of ["done", "start", "stop", "delete"] as const) {
    assert.deepEqual(taskActionArguments(uuid, action), [
      uuid,
      action,
      "rc.confirmation=off",
      "rc.recurrence.confirmation=no",
    ]);
    assert.throws(() => taskActionArguments("status:pending", action), /invalid task UUID/);
  }
  assert.throws(() => reopenTaskArguments("all"), /invalid task UUID/);
  assert.equal(reopenTaskArguments(uuid)[2], "status:pending");
  assert.equal(waitTaskArguments(uuid, "20261006T000000Z")[2], "wait:20261006T000000Z");
});

test("keeps descriptions in one attribute and validates tags at the service boundary", () => {
  const input = {
    description: "  中文 ' quotes $() project:other  ",
    project: "Work",
    tags: ["focus", "+FOCUS"],
    priority: "H",
  };
  const args = addTaskArguments(input);
  assert.equal(args[1], "description:中文 ' quotes $() project:other");
  assert.equal(args.filter((arg) => arg === "+focus").length, 1);
  assert.throws(() => addTaskArguments({ description: "x", tags: ["PENDING"] }), /reserved/);
  assert.throws(() => addTaskArguments({ description: " ", tags: [] }), /required/);
});

test("editing only changes core fields, leaving recurrence, dependencies and annotations intact", () => {
  const args = editTaskArguments(uuid, { description: "Updated", tags: [] });
  assert.ok(args.includes("project:"));
  assert.ok(args.includes("due:"));
  assert.ok(args.includes("tags:"));
  assert.ok(!args.some((arg) => /^(recur|depends|scheduled|wait|until|annotations):/.test(arg)));
});
