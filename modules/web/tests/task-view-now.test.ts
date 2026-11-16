import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const coreRoot = path.resolve(webRoot, "..", "core");

const compiled = esbuild.buildSync({
  entryPoints: [path.join(webRoot, "src/app/lib/task-view.ts")],
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
const { computeViewCounts, filterVisibleTasks } = await import(moduleUrl);

function makeTask(
  uuid: string,
  description: string,
  overrides: Record<string, unknown> = {},
) {
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

test("now view filters strictly to non-habit doing tasks and computeViewCounts computes now count", () => {
  const organization = {
    revision: 1,
    filters: [],
    tags: [],
    projects: [
      { name: "Habits", color: "green", description: "", category: "habit" },
      { name: "Work", color: "blue", description: "", category: "normal" },
    ],
    subtasks: { "sub-doing": "doing-1" },
  };
  const doingTask = makeTask("doing-1", "Current Doing", {
    state: "doing",
    project: "Work",
  });
  const subDoing = makeTask("sub-doing", "Sub Doing", {
    state: "doing",
    project: "Work",
  });
  const plannedTask = makeTask("plan-1", "Planned Task", {
    state: "planned",
    project: "Work",
  });
  const waitingTask = makeTask("wait-1", "Waiting Task", {
    state: "waiting",
    waitReason: "等对方",
  });
  const parkedTask = makeTask("park-1", "Parked Task", { state: "parked" });
  const habitDoing = makeTask("habit-1", "Morning Run", {
    state: "doing",
    project: "Habits",
  });
  const doneDoing = makeTask("done-1", "Done Doing", {
    state: "doing",
    status: "completed",
    project: "Work",
  });

  const all = [
    doingTask,
    subDoing,
    plannedTask,
    waitingTask,
    parkedTask,
    habitDoing,
    doneDoing,
  ];

  const counts = computeViewCounts(all, organization);
  assert.equal(counts.now, 1);

  const visibleNow = filterVisibleTasks({
    tasks: all,
    view: "now",
    organization,
    inbox: false,
    currentProject: "",
    query: "",
    keepCompleted: false,
  });
  assert.deepEqual(
    visibleNow.map((t: { uuid: string }) => t.uuid),
    ["doing-1", "sub-doing"],
  );
});
