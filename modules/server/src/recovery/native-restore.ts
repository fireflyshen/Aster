import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { executeProcess } from "../../core/connection/execute.ts";
import { buildCommand } from "../../core/connection/command.ts";
import type { TaskService } from "../../core/tasks/service.ts";
import { resolveTimewarriorCommand } from "../../core/tasks/timewarrior.ts";
import { importableTask, parseRawTasks } from "../../core/tasks/raw.ts";
import type { AsterBackup, RawInterval } from "./backup-validation.ts";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function canonicalTasks(tasks: AsterBackup["taskwarrior"]["tasks"]) {
  return tasks
    .map((task) => {
      const result = importableTask(task);
      if (Array.isArray(result.tags)) result.tags = [...result.tags].sort();
      if (Array.isArray(result.depends))
        result.depends = [...result.depends].sort();
      return result;
    })
    .sort((a, b) => String(a.uuid).localeCompare(String(b.uuid)));
}
export function canonicalIntervals(intervals: RawInterval[]) {
  return intervals
    .map(({ start, end, tags = [], annotation }) => ({
      start,
      ...(end ? { end } : {}),
      ...(tags.length ? { tags: [...tags].sort() } : {}),
      ...(annotation ? { annotation } : {}),
    }))
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        String(a.end).localeCompare(String(b.end)),
    );
}
export async function sqliteSnapshot(from: string, to: string) {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(db, to);
  } finally {
    db.close();
  }
  const copied = new DatabaseSync(to, { readOnly: true });
  try {
    if (
      Object.values(copied.prepare("PRAGMA integrity_check").get() || {})[0] !==
      "ok"
    )
      throw new Error("SQLite backup failed its integrity check.");
  } finally {
    copied.close();
  }
}
export function timerCommand(
  service: TaskService,
  args: string[],
  directory?: string,
) {
  const command = buildCommand(
    {
      ...service.connection,
      taskCommand: resolveTimewarriorCommand(service.connection.taskCommand),
      taskrc: undefined,
    },
    args,
  );
  if (directory)
    command.env = {
      ...process.env,
      ...command.env,
      TIMEWARRIORDB: directory,
    };
  return executeProcess(command);
}
export async function nativePaths(service: TaskService) {
  if (service.connection.kind !== "local")
    throw new Error(
      "Whole-workspace restore must run on the machine that stores Taskwarrior data.",
    );
  const tasks = (await service.dataDirectory()).trim();
  const result = await timerCommand(service, ["diagnostics"]);
  const timers = /^\s*Database:\s+(.+?)\s+\(/m.exec(result.stdout)?.[1];
  if (!tasks.startsWith("/") || !timers?.startsWith("/"))
    throw new Error("Cannot locate native task and timer data safely.");
  return {
    database: join(tasks, "taskchampion.sqlite3"),
    timers: join(timers, "data"),
  };
}
export async function stageNative(
  service: TaskService,
  data: AsterBackup,
  directory: string,
) {
  const tasks = join(directory, "task-stage");
  const timers = join(directory, "timer-stage");
  await mkdir(tasks, { recursive: true, mode: 0o700 });
  await mkdir(timers, { recursive: true, mode: 0o700 });
  const config = [
    `rc.data.location=${tasks}`,
    "rc.confirmation=off",
    "rc.gc=off",
    "rc.hooks=off",
    "rc.json.array=on",
    ...Object.entries(data.taskwarrior.uda || {}).map(
      ([key, value]) => `rc.${key}=${value}`,
    ),
  ];
  const run = async (args: string[], input?: string) => {
    const command = buildCommand(service.connection, [...args, ...config]);
    command.input = input;
    return executeProcess(command);
  };
  if ((await run(["_get", "rc.data.location"])).stdout.trim() !== tasks)
    throw new Error(
      "The configured task command does not honor an isolated database. Restore stopped before importing.",
    );
  if (data.taskwarrior.tasks.length)
    await run(
      ["import", "-"],
      JSON.stringify(data.taskwarrior.tasks.map(importableTask)),
    );
  const exported = parseRawTasks((await run(["export"])).stdout);
  if (
    canonical(canonicalTasks(exported)) !==
    canonical(canonicalTasks(data.taskwarrior.tasks))
  )
    throw new Error(
      "Taskwarrior could not reproduce every task attribute. The live workspace was not changed.",
    );
  await sqliteSnapshot(
    join(tasks, "taskchampion.sqlite3"),
    join(directory, "tasks.sqlite3"),
  );
  const diagnostic = await timerCommand(service, ["diagnostics"], timers);
  if (/^\s*Database:\s+(.+?)\s+\(/m.exec(diagnostic.stdout)?.[1] !== timers)
    throw new Error(
      "The configured timer command does not honor an isolated database. Restore stopped before replaying intervals.",
    );
  for (const interval of [...data.timewarrior.intervals!].sort((a, b) =>
    a.start.localeCompare(b.start),
  )) {
    await timerCommand(
      service,
      ["track", interval.start, "-", interval.end!, ":yes"],
      timers,
    );
    if (interval.tags?.length)
      await timerCommand(
        service,
        ["tag", "@1", ":yes", ...interval.tags],
        timers,
      );
    if (interval.annotation)
      await timerCommand(
        service,
        ["annotate", "@1", ":yes", interval.annotation],
        timers,
      );
  }
  const intervals = JSON.parse(
    (await timerCommand(service, ["export", ":yes"], timers)).stdout,
  ) as RawInterval[];
  if (
    canonical(canonicalIntervals(intervals)) !==
    canonical(canonicalIntervals(data.timewarrior.intervals!))
  )
    throw new Error(
      "Timewarrior could not reproduce every interval, tag or annotation. The live workspace was not changed.",
    );
  await mkdir(join(timers, "data"), { recursive: true, mode: 0o700 });
  return {
    database: join(directory, "tasks.sqlite3"),
    timers: join(timers, "data"),
  };
}
