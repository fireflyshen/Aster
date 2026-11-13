import type { TaskwarriorTask } from "../tasks/model.ts";
import type { Organization } from "./organization.ts";

export interface SubtaskMeta {
  parentOf: Record<string, string>;
  childrenOf: Map<string, TaskwarriorTask[]>;
  stats: Record<string, { done: number; total: number }>;
  taskByUuid: Map<string, TaskwarriorTask>;
}

/** Builds parent-child lookup maps and subtask completion counters from all fetched tasks. */
export function buildSubtaskMeta(
  tasks: TaskwarriorTask[],
  organization: Organization | undefined,
): SubtaskMeta {
  const parentOf: Record<string, string> = organization?.subtasks || {};
  const taskByUuid = new Map(tasks.map((task) => [task.uuid, task]));
  const childrenOf = new Map<string, TaskwarriorTask[]>();
  const stats: Record<string, { done: number; total: number }> = {};
  for (const task of tasks) {
    const parentUuid = parentOf[task.uuid];
    if (!parentUuid || task.uuid === parentUuid) continue;
    const siblings = childrenOf.get(parentUuid) || [];
    siblings.push(task);
    childrenOf.set(parentUuid, siblings);

    const entry = stats[parentUuid] || { done: 0, total: 0 };
    entry.total += 1;
    if (task.status === "completed") entry.done += 1;
    stats[parentUuid] = entry;
  }
  return { parentOf, childrenOf, stats, taskByUuid };
}

export interface TaskSectionEntry {
  task: TaskwarriorTask;
  parentTask?: TaskwarriorTask;
  children: TaskwarriorTask[];
  orphanedFromParent: boolean;
}

/** Filters a section to top-level tasks and orphaned subtasks whose parent is outside the section, folding direct children under visible parents for clean drill-down. */
export function selectSectionTasks(
  items: TaskwarriorTask[],
  meta: SubtaskMeta,
): TaskSectionEntry[] {
  const present = new Set(items.map((task) => task.uuid));
  const entries: TaskSectionEntry[] = [];
  for (const task of items) {
    const parentUuid = meta.parentOf[task.uuid];
    if (parentUuid && parentUuid !== task.uuid && present.has(parentUuid)) {
      continue;
    }
    entries.push({
      task,
      parentTask: parentUuid ? meta.taskByUuid.get(parentUuid) : undefined,
      children: meta.childrenOf.get(task.uuid) || [],
      orphanedFromParent: !!parentUuid,
    });
  }
  return entries;
}
