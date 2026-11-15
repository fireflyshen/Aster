import assert from "node:assert/strict";
import test from "node:test";
import {
  compactUrlLabel,
  formatDescriptionPreview,
  formatDescriptionSummary,
  formatMarkdownDescription,
  parseDescriptionSegments,
} from "../tasks/description.ts";

test("list summaries keep the opening paragraph instead of flattening the whole habit", () => {
  assert.equal(
    formatDescriptionSummary(
      "**规则**：食不过饱，饮不过量。\n\n**做法**\n- 吃到七八分饱。\n- 不喝含糖饮料。",
    ),
    "规则：食不过饱，饮不过量。",
  );
  assert.equal(
    formatDescriptionSummary(
      "# 训练原则\n\n每周一、三、五各练一次。\n其余为休息日。\n\n- 俯卧撑\n- 卧推",
    ),
    "每周一、三、五各练一次。 其余为休息日。",
  );
});

test("list summaries replace bare URL paths with hosts and retain named links", () => {
  const url =
    "https://hanxiaomax.github.io/Learncpp_CN/14-%E7%B1%BB%E8%AF%AD/14-1-welcome?q=secret#top";
  assert.equal(
    formatDescriptionSummary(`教材链接：《Learn C++ 中文版》14.1：${url}`),
    "教材链接：《Learn C++ 中文版》14.1：hanxiaomax.github.io",
  );
  assert.equal(
    formatDescriptionSummary(`阅读 [作用域与生命周期](${url})，完成练习。`),
    "阅读 作用域与生命周期，完成练习。",
  );
  assert.equal(formatDescriptionSummary(url), "hanxiaomax.github.io");
});

test("list summaries normalize Markdown and whitespace without interpreting HTML", () => {
  assert.equal(
    formatDescriptionSummary(
      "  \r\n- [x] **整理** `桌面`，~~旧规则~~ *保持整洁*。\r\n  ",
    ),
    "整理 桌面，旧规则 保持整洁。",
  );
  assert.equal(formatDescriptionSummary("\n\n"), "");
  assert.equal(formatDescriptionSummary("# 复习第四章"), "复习第四章");
  assert.equal(
    formatDescriptionSummary("<img src=x onerror=alert(1)>"),
    "<img src=x onerror=alert(1)>",
  );
});

test("compactUrlLabel strips scheme noise and trailing slash while keeping queries", () => {
  assert.equal(
    compactUrlLabel("https://hanxiaomax.github.io/Learncpp_CN/"),
    "hanxiaomax.github.io/Learncpp_CN",
  );
  assert.equal(compactUrlLabel("https://example.com/"), "example.com");
  assert.equal(
    compactUrlLabel("https://example.com/search/?q=1#top"),
    "example.com/search/?q=1#top",
  );
});

test("parseDescriptionSegments cleanly separates CJK punctuation and preserves balanced URL parentheses", () => {
  const segments = parseDescriptionSegments(
    "教材《Learn C++ 中文版》\nhttps://hanxiaomax.github.io/Learncpp_CN/（打不开用 Gitee: https://gitee.com/johannlee/Learncpp_CN）",
  );
  assert.deepEqual(segments, [
    { kind: "text", text: "教材《Learn C++ 中文版》\n" },
    {
      kind: "link",
      label: "hanxiaomax.github.io/Learncpp_CN",
      href: "https://hanxiaomax.github.io/Learncpp_CN/",
    },
    { kind: "text", text: "（打不开用 Gitee: " },
    {
      kind: "link",
      label: "gitee.com/johannlee/Learncpp_CN",
      href: "https://gitee.com/johannlee/Learncpp_CN",
    },
    { kind: "text", text: "）" },
  ]);

  const wiki = parseDescriptionSegments(
    "参考 (https://en.wikipedia.org/wiki/C_(programming_language)).",
  );
  assert.deepEqual(wiki, [
    { kind: "text", text: "参考 (" },
    {
      kind: "link",
      label: "en.wikipedia.org/wiki/C_(programming_language)",
      href: "https://en.wikipedia.org/wiki/C_(programming_language)",
    },
    { kind: "text", text: ")." },
  ]);

  const markdown = parseDescriptionSegments(
    "见 [LearnCpp 中文版](https://hanxiaomax.github.io/Learncpp_CN/) 章节 4.6",
  );
  assert.deepEqual(markdown, [
    { kind: "text", text: "见 " },
    {
      kind: "link",
      label: "LearnCpp 中文版",
      href: "https://hanxiaomax.github.io/Learncpp_CN/",
    },
    { kind: "text", text: " 章节 4.6" },
  ]);
});

test("formatDescriptionPreview flattens multi-line URLs and markdown into a clean single-line summary", () => {
  assert.equal(
    formatDescriptionPreview(
      "教材《Learn C++ 中文版》\n\n\nhttps://hanxiaomax.github.io/Learncpp_CN/",
    ),
    "教材《Learn C++ 中文版》 · hanxiaomax.github.io/Learncpp_CN",
  );
  assert.equal(
    formatDescriptionPreview(
      "- **必看**：[中文教材](https://hanxiaomax.github.io/Learncpp_CN/)\n> 用 `g++` 编译",
    ),
    "必看：中文教材 · 用 g++ 编译",
  );
});

test("formatMarkdownDescription preserves soft line breaks and converts raw URLs into compact markdown links", () => {
  assert.equal(
    formatMarkdownDescription(
      "教材《Learn C++ 中文版》\nhttps://hanxiaomax.github.io/Learncpp_CN/",
    ),
    "教材《Learn C++ 中文版》  \n[hanxiaomax.github.io/Learncpp_CN](https://hanxiaomax.github.io/Learncpp_CN/)",
  );
});
