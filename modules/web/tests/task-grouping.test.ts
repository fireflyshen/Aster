import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const coreRoot = path.resolve(webRoot, "..", "core");

const compiled = esbuild.buildSync({
  entryPoints: [path.join(webRoot, "src/features/tasks/task-grouping.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: {
    "@": path.join(webRoot, "src"),
    "@core": coreRoot,
    "@shared": path.join(webRoot, "shared"),
  },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const { buildTaskGroups } = await import(moduleUrl);

const makeTask = (
  uuid: string,
  extra: Record<string, unknown> = {},
) => ({
  id: 1,
  uuid,
  description: uuid,
  status: "pending",
  project: "",
  priority: "",
  due: "",
  wait: "",
  start: "",
  end: "",
  recur: "",
  tags: [],
  annotations: [],
  urgency: 0,
  ...extra,
});

test("buildTaskGroups returns filter content column without unsectioned fallback when groupBy is none", () => {
  const tasks = [makeTask("a"), makeTask("b")];
  const groups = buildTaskGroups(tasks, "none", "status:pending +READY");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].column.id, "group:none");
  assert.equal(groups[0].column.name, "status:pending +READY");
  assert.deepEqual(
    groups[0].items.map((t: { uuid: string }) => t.uuid),
    ["a", "b"],
  );

  const empty = buildTaskGroups([], "due", "status:pending +READY");
  assert.equal(empty.length, 1);
  assert.equal(empty[0].column.name, "status:pending +READY");
  assert.equal(empty[0].items.length, 0);
});

test("buildTaskGroups groups tasks by due date, project, priority, and label", () => {
  const now = new Date("2026-11-14T12:00:00");
  const tasks = [
    makeTask("overdue", {
      due: "20261111T120000Z",
      project: "Work",
      priority: "M",
      tags: ["Urgent"],
    }),
    makeTask("today", {
      due: "20261114T120000Z",
      project: "",
      priority: "H",
      tags: [],
    }),
    makeTask("nodue", {
      due: "",
      project: "Alpha",
      priority: "",
      tags: ["Urgent", "Code"],
    }),
  ];

  const byDue = buildTaskGroups(tasks, "due", "all", now);
  assert.equal(byDue.length, 3);
  assert.match(byDue[0].column.name, /11月11日/);
  assert.match(byDue[1].column.name, /11月14日 · 今天/);
  assert.equal(byDue[2].column.name, "无截止日期");

  const byProject = buildTaskGroups(tasks, "project", "all", now);
  assert.deepEqual(
    byProject.map((g: { column: { name: string } }) => g.column.name),
    ["收件箱", "Alpha", "Work"],
  );

  const byPriority = buildTaskGroups(tasks, "priority", "all", now);
  assert.deepEqual(
    byPriority.map((g: { column: { name: string } }) => g.column.name),
    ["优先级 1 (P1)", "优先级 2 (P2)", "无优先级"],
  );

  const byLabel = buildTaskGroups(tasks, "label", "all", now);
  assert.deepEqual(
    byLabel.map((g: { column: { name: string } }) => g.column.name),
    ["@Code", "@Urgent", "无标签"],
  );
});
