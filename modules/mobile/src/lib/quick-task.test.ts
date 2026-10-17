import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickTask, taskDate } from "./quick-task.ts";

const now = new Date(2026, 9, 17, 23, 45);
const parse = (text: string) => parseQuickTask(text, { now });
const due = (year: number, month: number, day: number) => taskDate(new Date(year, month - 1, day));

test("one expression maps to structured Taskwarrior fields", () => {
  assert.deepEqual(parse("明天 交报告 #工作 @专注 p1").task, {
    description: "交报告",
    project: "工作",
    tags: ["专注"],
    priority: "H",
    due: due(2026, 10, 18),
  });
});
test("local calendar arithmetic handles weekdays, month and year boundaries", () => {
  for (const [word, expected] of [
    ["今天", due(2026, 10, 17)],
    ["后天", due(2026, 10, 19)],
    ["下周一", due(2026, 10, 19)],
    ["下周日", due(2026, 10, 25)],
    ["周五", due(2026, 10, 23)],
    ["本周一", due(2026, 10, 12)],
    ["下周", due(2026, 10, 19)],
    ["20天后", due(2026, 11, 6)],
    ["due:2027-01-01", due(2027, 1, 1)],
    ["tomorrow", due(2026, 10, 18)],
  ]) {
    assert.equal(parse(`提交 ${word}`).task.due, expected, word);
  }
});
test("quotes protect literal date and priority words, and allow spaces in project names", () => {
  const result = parse('阅读 "明天" \'p1\' #"产品 设计"');
  assert.equal(result.task.description, "阅读 明天 p1");
  assert.equal(result.task.project, "产品 设计");
  assert.equal(result.task.due, "");
  assert.equal(result.task.priority, "");
});
test("ignored recognition is restored to the title", () => {
  const text = "明天 读书 #生活";
  const token = parse(text).tokens[0];
  const result = parseQuickTask(text, { now, ignored: [token.id] });
  assert.equal(result.task.description, "明天 读书");
  assert.equal(result.task.due, "");
  assert.equal(result.tokens[0].ignored, true);
  const edited = parseQuickTask("先 " + text + " @读书", { now, ignored: [token.id] });
  assert.equal(edited.task.description, "先 明天 读书");
  assert.equal(edited.task.due, "");
});
test("priority levels map to H M L and unset; both tag prefixes work", () => {
  for (const [word, priority] of [
    ["p1", "H"],
    ["P2", "M"],
    ["p3", "L"],
    ["p4", ""],
  ])
    assert.equal(parse(`写代码 ${word}`).task.priority, priority);
  assert.deepEqual(parse("写代码 @code %review @code").task.tags, ["code", "review"]);
});
test("ambiguous fields and invalid dates are rejected without rolling over dates", () => {
  for (const text of [
    "提交 2026-02-30",
    "提交 due:later",
    "提交 今天 明天",
    "提交 #甲 #乙",
    "提交 p1 p2",
    "提交 @bad!",
    '提交 @"two words"',
  ])
    assert.ok(parse(text).errors.length, text);
  assert.equal(parse("提交 2028-02-29").task.due, due(2028, 2, 29));
});
test("ordinary words, unknown syntax, shell characters and Chinese prose remain literal", () => {
  for (const text of [
    "constructor",
    "__proto__",
    "讨论明天的方案",
    "echo $(whoami); rm -rf /",
    "写报告 每周一 15:00 due:not-a-date",
  ]) {
    const result = parse(text);
    assert.equal(result.task.description, text);
  }
});
test("bounds match the API contract", () => {
  assert.ok(parse("a".repeat(2001)).errors.length);
  assert.ok(parse("任务 #" + "a".repeat(201)).errors.length);
  assert.ok(parse("任务 @" + "a".repeat(81)).errors.length);
  assert.ok(parse("任务 " + Array.from({ length: 31 }, (_, i) => `@tag${i}`).join(" ")).errors.length);
  assert.equal(parse("  #工作  p1 ").task.description, "");
});

test("the reference date-time expression preserves local clock time", () => {
  for (const [expression, hour, minute] of [
    ["tomorrow at 14", 14, 0],
    ["明天 14:30", 14, 30],
    ["tomorrow 2pm", 14, 0],
    ["tomorrow 12am", 0, 0],
    ["下周一 09:15", 9, 15],
  ] as const) {
    const result = parse(`Meet with Ada ${expression}`);
    assert.equal(result.errors.length, 0);
    assert.equal(result.task.description, "Meet with Ada");
    const date = new Date(2026, 9, expression.startsWith("下周") ? 19 : 18, hour, minute);
    assert.equal(result.task.due, taskDate(date));
  }
  for (const expression of ["tomorrow at 25", "明天 14:90", "tomorrow 13pm", "2026-02-30 14:00"])
    assert.ok(parse(`Meeting ${expression}`).errors.length);
  assert.equal(parse('Read "tomorrow at 14"').task.description, "Read tomorrow at 14");
  assert.equal(parse('Read "tomorrow at 14"').errors.length, 0);
});

test("highlight ranges preserve the exact original expression", () => {
  const text = '  Meet with Ada tomorrow at 14 #"Product design" @review p1';
  const result = parse(text);
  for (const token of result.tokens) assert.equal(text.slice(token.start, token.end), token.raw);
  assert.deepEqual(
    result.tokens.map((token) => token.raw),
    ["tomorrow at 14", '#"Product design"', "@review", "p1"],
  );
});
