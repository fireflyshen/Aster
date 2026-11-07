import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { requireUuid } from "../../../src/core/tasks/arguments.ts";
import type { RawTask } from "../../../src/core/tasks/raw.ts";
import type { createTaskService } from "../../../src/core/tasks/service.ts";
import type { createOrganizationService } from "./organization-service.ts";
import type { DeletedTask } from "../shared/recovery.ts";

type Entry = {
  task: RawTask;
  deletedAt: string;
  phase: "prepared" | "deleted" | "restoring";
  inferred?: boolean;
  placement?: { columnId: string; beforeUuid: string | null };
};
type Journal = { version: 1; entries: Entry[] };
export function createRecoveryService(
  service: ReturnType<typeof createTaskService>,
  organization: ReturnType<typeof createOrganizationService>,
  path: string,
) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const operation = queue.catch(() => undefined).then(fn);
    queue = operation;
    return operation;
  }
  async function read(): Promise<Journal> {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (
        value.version !== 1 ||
        !Array.isArray(value.entries) ||
        value.entries.some(
          (e: Entry) =>
            !e.task?.uuid ||
            !["prepared", "deleted", "restoring"].includes(e.phase),
        )
      )
        throw new Error(
          "Recovery file is invalid. Keep the file and check your backup.",
        );
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, entries: [] };
      throw error;
    }
  }
  async function persist(value: Journal) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, path);
  }
  async function listing() {
    const [journal, native] = await Promise.all([
      read(),
      service.exportTasks(),
    ]);
    const current = new Map(native.map((task) => [task.uuid, task]));
    const saved = new Map(
      journal.entries.map((entry) => [entry.task.uuid, entry]),
    );
    const rows: DeletedTask[] = [];
    const add = (task: RawTask, entry?: Entry) =>
      rows.push({
        uuid: task.uuid,
        description: task.description,
        project: typeof task.project === "string" ? task.project : undefined,
        deletedAt:
          entry?.deletedAt ||
          (typeof task.end === "string" ? task.end : undefined),
        restoreStatus:
          entry?.task.status ||
          (task.recur && !task.parent ? "recurring" : "pending"),
        tracked: !!entry && !entry.inferred,
        finishing: entry?.phase === "restoring" && task.status !== "deleted",
      });
    for (const task of native)
      if (task.status === "deleted") add(task, saved.get(task.uuid));
    for (const entry of journal.entries) {
      const task = current.get(entry.task.uuid);
      if (
        (!task && entry.phase !== "prepared") ||
        (task?.status !== "deleted" && entry.phase === "restoring")
      )
        add(task || entry.task, entry);
    }
    return {
      tasks: rows.sort((a, b) =>
        (b.deletedAt || "").localeCompare(a.deletedAt || ""),
      ),
    };
  }
  return {
    list: () => serial(listing),
    delete: (uuid: string) =>
      serial(async () => {
        const journal = await read();
        await service.deleteWithSnapshot(uuid, async (task) => {
          const workspace = await organization.snapshot();
          const board = workspace.board;
          const index = board?.order.indexOf(uuid) ?? -1;
          journal.entries = journal.entries.filter(
            (entry) => entry.task.uuid !== uuid,
          );
          journal.entries.push({
            task,
            phase: "prepared",
            deletedAt: new Date().toISOString(),
            placement: board
              ? {
                  columnId:
                    board.placements.find((item) => item.uuid === uuid)
                      ?.columnId || "unsectioned",
                  beforeUuid:
                    index >= 0 ? board.order[index + 1] || null : null,
                }
              : undefined,
          });
          await persist(journal);
        });
        try {
          journal.entries.find((entry) => entry.task.uuid === uuid)!.phase =
            "deleted";
          await persist(journal);
        } catch (error) {
          throw Object.assign(error as Error, { outcome: "unknown" });
        }
      }),
    restore: (uuid: string) =>
      serial(async () => {
        requireUuid(uuid);
        const journal = await read();
        let entry = journal.entries.find((item) => item.task.uuid === uuid);
        const current = (await service.exportTasks()).find(
          (task) => task.uuid === uuid,
        );
        if (!entry && current?.status === "deleted") {
          // Older/CLI deletions have no pre-delete snapshot: be explicit about the fallback.
          entry = {
            task: {
              ...current,
              status:
                current.recur && !current.parent ? "recurring" : "pending",
            },
            phase: "deleted",
            inferred: true,
            deletedAt: new Date().toISOString(),
          };
          journal.entries.push(entry);
        }
        if (
          !entry ||
          (current &&
            current.status !== "deleted" &&
            entry.phase !== "restoring")
        )
          throw new Error(
            "This task is no longer deleted. Refresh to check it.",
          );
        entry.phase = "restoring";
        await persist(journal);
        try {
          if (!current || current.status === "deleted")
            await service.restoreTask(uuid, entry.task);
          await organization.restorePlacement(uuid, entry.placement);
          journal.entries = journal.entries.filter((item) => item !== entry);
          await persist(journal);
        } catch (error) {
          throw Object.assign(error as Error, { outcome: "unknown" });
        }
      }),
    export: () =>
      serial(async () => {
        // Check metadata revision around native reads; never retry a write.
        for (let attempt = 0; attempt < 3; attempt++) {
          const organizationBefore = await organization.snapshot();
          const startedAt = new Date().toISOString();
          const [tasks, recovery, timewarrior, uda] = await Promise.all([
            service.exportTasks(),
            read(),
            service.exportTimerHistory().then(
              (intervals) => ({ available: true, intervals }),
              () => ({ available: false, intervals: null }),
            ),
            service.exportSchema(),
          ]);
          const after = await organization.snapshot();
          if (after.revision !== organizationBefore.revision) continue;
          return {
            format: "aster-backup",
            version: 1,
            startedAt,
            exportedAt: new Date().toISOString(),
            taskwarrior: { tasks, uda },
            organization: after,
            recovery,
            timewarrior,
            warnings: timewarrior.available
              ? []
              : [
                  "Timewarrior could not be exported. Timer history is missing from this backup.",
                ],
          };
        }
        throw new Error(
          "Workspace is changing. Wait for changes to finish, then export again.",
        );
      }),
  };
}
