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
      import { TaskBoard } from './src/features/tasks/task-board';
      export const render = (tasks) => renderToStaticMarkup(<TaskBoard
        layout="list" todaySplit virtualGroupBy="today" initialScrollLeft={0} onScrollPositionChange={()=>{}}
        tasks={tasks} board={{columns:[{id:'study',name:'学习',project:'学习'}],placements:tasks.map(t=>({uuid:t.uuid,columnId:'study'})),order:tasks.map(t=>t.uuid)}}
        revision={1} loaded loading={false} disabled={false} saving={false} blocked={false} error=""
        onChange={async()=>true} onReload={async()=>undefined} onClearError={()=>{}} onMove={async()=>true} onAdd={()=>{}}
        renderTask={t=><span>{t.description}</span>} />);`,
    resolveDir: webRoot,
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  jsx: "automatic",
  // The viewport-dependent drag portal is unrelated to Today grouping.
  plugins: [
    {
      name: "without-drag-portal",
      setup(build) {
        build.onLoad({ filter: /\/task-drag-layer\.tsx$/ }, () => ({
          contents: "export const TaskDragLayer = () => null",
          loader: "tsx",
        }));
      },
    },
  ],
  alias: {
    "@": path.join(webRoot, "src"),
    "@core": path.resolve(webRoot, "../core"),
    "@shared": path.join(webRoot, "shared"),
  },
});
const loaded = { exports: {} as { render: (tasks: unknown[]) => string } };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports,
);

test("Today renders dated tasks from real project sections when using virtual Today grouping", () => {
  const past = new Date();
  past.setDate(past.getDate() - 1);
  const base = {
    due: past.toISOString(),
    project: "学习",
    tags: [],
    annotations: [],
  };
  const html = loaded.exports.render([
    {
      ...base,
      uuid: "pending",
      description: "必须看见的逾期任务",
      status: "pending",
    },
    {
      ...base,
      uuid: "completed",
      description: "已完成的历史任务",
      status: "completed",
    },
  ]);
  assert.ok(html.includes("必须看见的逾期任务"));
  assert.ok(html.includes("已完成的历史任务"));
  const overdue = html
    .split('aria-label="逾期任务"')[1]
    .split('aria-label="今日任务"')[0];
  assert.ok(overdue.includes("必须看见的逾期任务"));
  assert.ok(!overdue.includes("已完成的历史任务"));
});

test("empty Today section does not claim everything is complete while overdue work remains", () => {
  const past = new Date();
  past.setDate(past.getDate() - 1);
  const html = loaded.exports.render([
    {
      uuid: "pending",
      description: "未完成",
      status: "pending",
      due: past.toISOString(),
      project: "学习",
      tags: [],
      annotations: [],
    },
  ]);
  assert.ok(html.includes("今天暂无安排"));
  const overdue = html
    .split('aria-label="逾期任务"')[1]
    .split('aria-label="今日任务"')[0];
  assert.ok(overdue.includes("未完成"));
  assert.ok(!html.includes("今天的所有任务已完成"));
});
