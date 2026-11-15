import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const compiled = buildSync({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { DescriptionReader } from './src/features/tasks/description-reader';
      export const render = (text) => renderToStaticMarkup(<DescriptionReader text={text}/>);`,
    resolveDir: webRoot,
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  jsx: "automatic",
  alias: { "@core": path.resolve(webRoot, "../core") },
});
const loaded = { exports: {} as { render: (text: string) => string } };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports,
);
const { render } = loaded.exports;

test("description reader preserves full habit rules as paragraphs and lists", () => {
  const html = render(
    "**规则**：食不过饱，饮不过量。\n\n**做法**\n- 吃到七八分饱。\n- 非必要不饮含糖饮料。\n\n每天没做到才记一次。",
  );
  assert.ok(html.includes("<strong>规则</strong>"));
  assert.ok(html.includes("<strong>做法</strong>"));
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.ok(html.includes("每天没做到才记一次。"));
  assert.ok(!html.includes("**"));
});

test("reading links keep exact destinations without displaying encoded paths", () => {
  const url = "https://example.com/14-%E7%B1%BB?chapter=4#lesson";
  const html = render(`教材链接：${url}\n\n另见 [生命周期](${url})`);
  assert.equal(
    (
      html.match(
        /href="https:\/\/example.com\/14-%E7%B1%BB\?chapter=4#lesson"/g,
      ) || []
    ).length,
    2,
  );
  assert.ok(html.includes("<span>example.com</span>"));
  assert.ok(html.includes("<span>生命周期</span>"));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("description reader treats HTML as text and keeps fenced code literal", () => {
  const html = render(
    "<img src=x onerror=alert(1)>\n\n[危险链接](javascript:alert(1))\n\n```cpp\n**literal** <script>alert(1)</script>\n```",
  );
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("<pre><code>**literal** &lt;script&gt;"));
});
