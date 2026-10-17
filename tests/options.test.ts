import assert from "node:assert/strict";
import test from "node:test";
import { isVirtualTag, parseProjects, uniqueTags } from "../src/tasks/options.ts";

test("keeps project suggestions and removes virtual and duplicate tags", () => {
  const projects = parseProjects("Work\nHome\nWork\n");
  assert.deepEqual(projects, ["Home", "Work"]);
  assert.equal(isVirtualTag("+pending"), true);
  assert.equal(isVirtualTag("work"), false);
  assert.deepEqual(uniqueTags(["work", "+Work", " focus "]), ["work", "focus"]);
});
