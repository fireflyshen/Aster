import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const compiled = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { NowWorkspace, scheduledGroupLabel } from './src/features/tasks/now-workspace';
      import { StateChip, TaskStateGroupContext } from './src/features/tasks/task-meta-chips';
      export const renderState = (state, group, blocked) => renderToStaticMarkup(
        <TaskStateGroupContext value={group}><StateChip state={state} blocked={blocked}/></TaskStateGroupContext>);
      export const label = (scheduled) => scheduledGroupLabel(scheduled, new Date(2026,10,17,12));
      export const renderNow = (tasks) => renderToStaticMarkup(<NowWorkspace
        tasks={tasks} organization={{revision:1,filters:[],tags:[]}}
        now={new Date(2026,10,17,12)} query="" loading={false} disabled={false}
        summary={null} habitTaskUuids={new Set()} nowSections={{planned:true}}
        onUpdateSections={()=>{}} onChangeState={()=>{}} onAddTask={()=>{}}
        renderTask={task=><span>{task.description}<StateChip state={task.state}/></span>}/>);`,
    resolveDir: webRoot,
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  jsx: "automatic",
  alias: {
    "@": path.join(webRoot, "src"),
    "@core": path.resolve(webRoot, "../core"),
    "@shared": path.join(webRoot, "shared"),
  },
  plugins: [
    {
      name: "without-viewport-drag-portal",
      setup(build) {
        build.onLoad({ filter: /\/task-drag-layer\.tsx$/ }, () => ({
          contents: "export const TaskDragLayer = () => null",
          loader: "tsx",
        }));
      },
    },
  ],
});
const loaded = {
  exports: {} as {
    renderState: (state: string, group?: string, blocked?: boolean) => string;
    label: (scheduled: string) => string;
    renderNow: (tasks: unknown[]) => string;
  },
};
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports,
);

test("state sections omit repeated badges but keep blocked and differing states visible", () => {
  const { renderState } = loaded.exports;
  assert.equal(renderState("planned", "planned"), "");
  assert.ok(renderState("planned").includes('data-task-state-chip="planned"'));
  assert.ok(
    renderState("waiting", "doing").includes('data-task-state-chip="waiting"'),
  );
  const blocked = renderState("doing", "doing", true);
  assert.ok(blocked.includes("被阻塞"));
  assert.ok(!blocked.includes("data-task-state-chip"));
});

test("planned tasks at different times share one calendar-day heading, with years kept distinct", () => {
  const { label, renderNow } = loaded.exports;
  assert.equal(label("2026-11-19T08:00:00"), "11月19日");
  assert.equal(label("2026-11-19T19:30:00"), "11月19日");
  assert.equal(label("2027-11-19T08:00:00"), "2027年11月19日");
  const html = renderNow(
    ["08:00", "19:30"].map((time, index) => ({
      uuid: `task-${index}`,
      description: `task ${index}`,
      state: "planned",
      status: "pending",
      scheduled: `2026-11-19T${time}:00`,
      urgency: 1,
      tags: [],
      annotations: [],
      depends: [],
    })),
  );
  assert.equal((html.match(/class="now-scheduled-heading"/g) || []).length, 1);
  assert.ok(html.includes("task 0") && html.includes("task 1"));
  assert.ok(!html.includes("data-task-state-chip"));
});
