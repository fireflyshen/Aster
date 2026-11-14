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
const { buildTaskGroups, groupOptionsForContext } = await import(moduleUrl);

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

test("buildTaskGroups splits Today into overdue (only when present) and today date column", () => {
  const now = new Date("2026-11-15T10:00:00");

  const emptyToday = buildTaskGroups([], "today", "今天", now);
  assert.equal(emptyToday.length, 1);
  assert.equal(emptyToday[0].column.id, "group:today:today");
  assert.match(emptyToday[0].column.name, /^11月15日 · 今天 · /);
  assert.equal(emptyToday[0].items.length, 0);

  const onlyToday = buildTaskGroups(
    [makeTask("t1", { due: "2026-11-15" })],
    "today",
    "今天",
    now,
  );
  assert.equal(onlyToday.length, 1);
  assert.equal(onlyToday[0].column.id, "group:today:today");

  const mixed = buildTaskGroups(
    [
      makeTask("old", { due: "2026-11-14" }),
      makeTask("now", { due: "2026-11-15" }),
    ],
    "today",
    "今天",
    now,
  );
  assert.deepEqual(
    mixed.map((g: { column: { id: string; name: string } }) => g.column.id),
    ["group:today:overdue", "group:today:today"],
  );
  assert.equal(mixed[0].column.name, "逾期");
  assert.deepEqual(
    mixed[0].items.map((t: { uuid: string }) => t.uuid),
    ["old"],
  );
  assert.deepEqual(
    mixed[1].items.map((t: { uuid: string }) => t.uuid),
    ["now"],
  );
});

test("buildTaskGroups groups completed tasks by completion date descending with fallback", () => {
  const now = new Date("2026-11-15T10:00:00");
  const groups = buildTaskGroups(
    [
      makeTask("older", { status: "completed", end: "2026-11-11" }),
      makeTask("today", { status: "completed", end: "2026-11-15" }),
      makeTask("unknown", { status: "completed", end: "" }),
      makeTask("yesterday", { status: "completed", end: "2026-11-14" }),
    ],
    "completed",
    "已完成",
    now,
  );
  assert.equal(groups.length, 4);
  assert.match(groups[0].column.name, /^11月15日 · 今天 · /);
  assert.match(groups[1].column.name, /^11月14日 · 昨天 · /);
  assert.match(groups[2].column.name, /^11月11日 · /);
  assert.equal(groups[3].column.name, "未知日期");
});

test("groupOptionsForContext tailors options per view context", () => {
  assert.deepEqual(
    groupOptionsForContext("today").map((o: { value: string }) => o.value),
    ["today", "none", "project", "priority", "label"],
  );
  assert.deepEqual(
    groupOptionsForContext("completed").map((o: { value: string }) => o.value),
    ["completed", "none", "project", "priority", "label"],
  );
  assert.deepEqual(
    groupOptionsForContext("default").map((o: { value: string }) => o.value),
    ["none", "due", "project", "priority", "label"],
  );
});
