import { isCompactTaskDate } from "../../../src/core/tasks/model.ts";
import { requireUuid } from "../../../src/core/tasks/arguments.ts";
import { tagName, filterArguments } from "../../../src/core/tasks/filter.ts";
import {
  colors,
  type Organization,
} from "../../../src/core/workspace/organization.ts";
import { inProject } from "../../../src/core/workspace/focus.ts";
import {
  projectNames,
  validateProjectName,
} from "../../../src/core/workspace/projects.ts";
import type { RawTask } from "../../../src/core/tasks/raw.ts";
import type { BackupCounts } from "../shared/backup.ts";
export type RawInterval = {
  id?: number;
  start: string;
  end?: string;
  tags?: string[];
  annotation?: string;
};
export type AsterBackup = {
  format: "aster-backup";
  version: 1;
  exportedAt: string;
  startedAt?: string;
  taskwarrior: { tasks: RawTask[]; uda?: Record<string, string> };
  organization: Organization;
  recovery: {
    version: 1;
    entries: {
      task: RawTask;
      deletedAt: string;
      phase: "prepared" | "deleted" | "restoring";
      inferred?: boolean;
      placement?: { columnId: string; beforeUuid: string | null };
    }[];
  };
  timewarrior: { available: boolean; intervals: RawInterval[] | null };
  warnings?: string[];
};
function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid backup object.");
}
function text(value: unknown, limit = 8000): asserts value is string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0"))
    throw new Error("Invalid backup text.");
}
function list(value: unknown, limit = 50000): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error("Invalid backup list.");
}
export function compactDate(value: unknown): string {
  text(value, 16);
  if (!isCompactTaskDate(value))
    throw new Error("Invalid backup calendar date.");
  return value;
}
function task(value: unknown) {
  record(value);
  text(value.uuid, 36);
  requireUuid(value.uuid);
  text(value.description, 200000);
  if (
    !["pending", "waiting", "completed", "deleted", "recurring"].includes(
      String(value.status),
    )
  )
    throw new Error("Invalid task state in backup.");
  for (const key of [
    "entry",
    "modified",
    "due",
    "end",
    "start",
    "wait",
    "scheduled",
    "until",
  ])
    if (value[key] !== undefined) compactDate(value[key]);
  if (value.parent !== undefined) {
    text(value.parent, 36);
    requireUuid(value.parent);
  }
  if (value.project !== undefined) {
    text(value.project, 200);
    if (value.project) validateProjectName(value.project);
  }
  if (value.tags !== undefined) {
    list(value.tags, 1000);
    for (const tag of value.tags) text(tag, 1000);
  }
  if (value.depends !== undefined) {
    list(value.depends, 10000);
    for (const uuid of value.depends) {
      text(uuid, 36);
      requireUuid(uuid);
    }
  }
  if (value.annotations !== undefined) {
    list(value.annotations, 10000);
    for (const note of value.annotations) {
      record(note);
      compactDate(note.entry);
      text(note.description, 200000);
    }
  }
  for (const [key, field] of Object.entries(value)) {
    if (["tags", "depends", "annotations"].includes(key)) continue;
    if (
      field !== null &&
      !["string", "number", "boolean"].includes(typeof field)
    )
      throw new Error("Invalid task attribute in backup.");
    if (typeof field === "string") text(field, 200000);
  }
}
export function validateBackup(value: unknown): AsterBackup {
  record(value);
  if (value.format !== "aster-backup" || value.version !== 1)
    throw new Error("Choose an Aster backup, version 1.");
  text(value.exportedAt, 40);
  if (!Number.isFinite(Date.parse(value.exportedAt)))
    throw new Error("Invalid export date.");
  record(value.taskwarrior);
  list(value.taskwarrior.tasks, 10000);
  value.taskwarrior.tasks.forEach(task);
  if (
    new Set(value.taskwarrior.tasks.map((item) => (item as RawTask).uuid))
      .size !== value.taskwarrior.tasks.length
  )
    throw new Error("Duplicate task UUIDs in backup.");
  if (value.taskwarrior.uda !== undefined) {
    record(value.taskwarrior.uda);
    if (Object.keys(value.taskwarrior.uda).length > 1000)
      throw new Error("Too many custom field definitions.");
    for (const [key, field] of Object.entries(value.taskwarrior.uda)) {
      if (!/^uda\.[A-Za-z0-9_.-]+$/.test(key))
        throw new Error("Only custom task field definitions can be restored.");
      text(field, 2000);
      if (/[\r\n]/.test(field))
        throw new Error("Invalid custom field definition.");
    }
  }
  record(value.organization);
  const org = value.organization;
  if (!Number.isSafeInteger(org.revision) || Number(org.revision) < 0)
    throw new Error("Invalid workspace revision.");
  list(org.filters, 1000);
  list(org.tags, 1000);
  const color = (value: unknown) => {
    if (!colors.some((color) => color.id === value))
      throw new Error("Invalid workspace color.");
  };
  for (const item of [...org.tags, ...org.filters]) {
    record(item);
    text(item.id, 160);
    text(item.name, 60);
    color(item.color);
    if (typeof item.favorite !== "boolean")
      throw new Error("Invalid favorite setting.");
  }
  for (const item of org.tags) {
    const tag = item as { name: string };
    tagName(tag.name);
  }
  for (const item of org.filters) {
    const filter = item as { expression: unknown; description: unknown };
    text(filter.expression, 1024);
    filterArguments(filter.expression);
    text(filter.description, 500);
  }
  if (org.projects !== undefined) {
    list(org.projects, 10000);
    for (const item of org.projects) {
      record(item);
      text(item.name, 200);
      validateProjectName(item.name);
      text(item.description, 2000);
      if (item.color !== undefined) color(item.color);
      if (
        item.status !== undefined &&
        !["active", "later", "completed"].includes(String(item.status))
      )
        throw new Error("Invalid project state.");
      if (item.outcome !== undefined) text(item.outcome, 2000);
      if (item.nextTask) {
        text(item.nextTask, 36);
        requireUuid(item.nextTask);
      }
    }
    const active = (org.projects as { name: string; status?: string }[]).filter(
      (item) => item.status === "active",
    );
    if (
      active.length > 3 ||
      active.some((a, i) =>
        active
          .slice(i + 1)
          .some((b) => inProject(a.name, b.name) || inProject(b.name, a.name)),
      )
    )
      throw new Error("Backup exceeds the three independent Focus projects.");
  }
  if (org.board !== undefined) {
    record(org.board);
    list(org.board.columns, 300);
    list(org.board.order, 50000);
    list(org.board.placements, 50000);
    for (const item of org.board.columns) {
      record(item);
      text(item.id, 160);
      text(item.name, 60);
      if (item.project !== undefined && item.project !== null) {
        text(item.project, 200);
      }
      if (!item.id || item.id === "unsectioned" || !item.name.trim())
        throw new Error("Invalid board column.");
    }
    if (
      new Set(org.board.columns.map((item) => (item as { id: string }).id))
        .size !== org.board.columns.length
    )
      throw new Error("Duplicate board columns.");
    for (const item of org.board.placements) {
      record(item);
      text(item.uuid, 36);
      requireUuid(item.uuid);
      text(item.columnId, 160);
    }
    for (const uuid of org.board.order) {
      text(uuid, 36);
      requireUuid(uuid);
    }
  }
  if (org.energyState !== undefined) {
    record(org.energyState);
    text(org.energyState.day, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(org.energyState.day) ||
      !Number.isSafeInteger(org.energyState.bonus) ||
      Number(org.energyState.bonus) < 0 ||
      !Number.isSafeInteger(org.energyState.elixirCount) ||
      Number(org.energyState.elixirCount) < 0
    )
      throw new Error("Invalid energy metadata.");
  }
  if (org.subtasks !== undefined) {
    record(org.subtasks);
    if (Object.keys(org.subtasks).length > 50000)
      throw new Error("Too many subtasks in backup.");
    for (const [child, parent] of Object.entries(org.subtasks)) {
      text(child, 36);
      requireUuid(child);
      text(parent, 36);
      requireUuid(parent);
    }
  }
  if (org.descriptions !== undefined) {
    record(org.descriptions);
    if (Object.keys(org.descriptions).length > 50000)
      throw new Error("Too many descriptions in backup.");
    for (const [uuid, desc] of Object.entries(org.descriptions)) {
      text(uuid, 36);
      requireUuid(uuid);
      text(desc, 10000);
    }
  }
  record(value.recovery);
  if (value.recovery.version !== 1)
    throw new Error("Invalid recovery journal.");
  list(value.recovery.entries, 50000);
  for (const item of value.recovery.entries) {
    record(item);
    task(item.task);
    text(item.deletedAt, 40);
    if (
      !Number.isFinite(Date.parse(item.deletedAt)) ||
      !["prepared", "deleted", "restoring"].includes(String(item.phase))
    )
      throw new Error("Invalid recovery entry.");
    if (item.placement !== undefined) {
      record(item.placement);
      text(item.placement.columnId, 160);
      if (item.placement.beforeUuid !== null) {
        text(item.placement.beforeUuid, 36);
        requireUuid(item.placement.beforeUuid);
      }
    }
  }
  record(value.timewarrior);
  if (value.timewarrior.available !== true)
    throw new Error(
      "This backup has no timer history. Use a complete export to restore the workspace.",
    );
  list(value.timewarrior.intervals, 50000);
  for (const interval of value.timewarrior.intervals) {
    record(interval);
    compactDate(interval.start);
    if (interval.end !== undefined) {
      compactDate(interval.end);
      if (String(interval.end) < String(interval.start))
        throw new Error("Invalid timer interval.");
    }
    if (interval.tags !== undefined) {
      list(interval.tags, 1000);
      for (const tag of interval.tags) text(tag, 2000);
    }
    if (interval.annotation !== undefined) text(interval.annotation, 8000);
  }
  const backup = structuredClone(value) as unknown as AsterBackup;
  // Only persisted fields enter organization storage; derived figures are recalculated.
  const { revision, filters, tags, projects, board, energyState, subtasks, descriptions } =
    backup.organization;
  backup.organization = {
    revision,
    filters,
    tags,
    ...(projects ? { projects } : {}),
    ...(board ? { board } : {}),
    ...(energyState ? { energyState } : {}),
    ...(subtasks ? { subtasks } : {}),
    ...(descriptions ? { descriptions } : {}),
  };
  return backup;
}
export function backupCounts(
  backup: Pick<AsterBackup, "taskwarrior" | "organization" | "timewarrior">,
): BackupCounts {
  return {
    tasks: backup.taskwarrior.tasks.length,
    projects: projectNames([
      ...(backup.organization.projects || []).map((project) => project.name),
      ...backup.taskwarrior.tasks.flatMap((task) =>
        task.status !== "deleted" && typeof task.project === "string"
          ? [task.project]
          : [],
      ),
    ]).length,
    labels: new Set([
      ...backup.organization.tags.map((tag) => tag.name),
      ...backup.taskwarrior.tasks.flatMap((task) =>
        task.status !== "deleted" && Array.isArray(task.tags)
          ? (task.tags as string[])
          : [],
      ),
    ]).size,
    filters: backup.organization.filters.length,
    columns: backup.organization.board?.columns.length || 0,
    intervals: backup.timewarrior.intervals?.length || 0,
  };
}
export function pausedBackup(backup: AsterBackup): AsterBackup {
  const result = structuredClone(backup);
  const captured = new Date(result.exportedAt)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  for (const task of result.taskwarrior.tasks) delete task.start;
  for (const interval of result.timewarrior.intervals || [])
    if (!interval.end) {
      if (interval.start > captured)
        throw new Error("An open timer starts after the export date.");
      interval.end = captured;
    }
  return result;
}
