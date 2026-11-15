import type { SavedFilter } from "./organization.ts";

/** Built-in read-only Taskwarrior preset filters available in the web workspace. */
export const BUILTIN_TW_FILTERS: readonly SavedFilter[] = [
  {
    id: "builtin:ready",
    name: "就绪任务",
    description: "status:pending +READY · 可立即执行且未被阻塞",
    expression: "status:pending +READY",
    color: "green",
    favorite: false,
  },
  {
    id: "builtin:overdue",
    name: "已逾期",
    description: "status:pending +OVERDUE · 已过截止时间",
    expression: "status:pending +OVERDUE",
    color: "red",
    favorite: false,
  },
  {
    id: "builtin:active",
    name: "正在进行",
    description: "status:pending +ACTIVE · 已开始计时",
    expression: "status:pending +ACTIVE",
    color: "orange",
    favorite: false,
  },
  {
    id: "builtin:high",
    name: "高优先级",
    description: "status:pending priority:H · P1 高优任务",
    expression: "status:pending priority:H",
    color: "berry",
    favorite: false,
  },
  {
    id: "builtin:week",
    name: "本周截止",
    description: "status:pending due.before:eow · 本周内到期",
    expression: "status:pending due.before:eow",
    color: "yellow",
    favorite: false,
  },
  {
    id: "builtin:blocked",
    name: "被阻塞",
    description: "status:pending +BLOCKED · 依赖前置任务",
    expression: "status:pending +BLOCKED",
    color: "purple",
    favorite: false,
  },
  {
    id: "builtin:waiting",
    name: "等待中",
    description: "status:pending +WAITING · 已推迟的任务",
    expression: "status:pending +WAITING",
    color: "teal",
    favorite: false,
  },
  {
    id: "builtin:no-project",
    name: "无项目",
    description: "status:pending project: · 未分配项目",
    expression: "status:pending project:",
    color: "blue",
    favorite: false,
  },
  {
    id: "builtin:untagged",
    name: "无标签",
    description: "status:pending tags.none: · 未添加标签",
    expression: "status:pending tags.none:",
    color: "gray",
    favorite: false,
  },
  {
    id: "builtin:completed-7d",
    name: "近 7 天已完成",
    description: "status:completed end.after:today-7d · 最近完成",
    expression: "status:completed end.after:today-7d",
    color: "mint",
    favorite: false,
  },
];

export function findBuiltinFilter(id: string): SavedFilter | undefined {
  return BUILTIN_TW_FILTERS.find((item) => item.id === id);
}
