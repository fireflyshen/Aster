import {
  executeProcess,
  serializeWrite,
  type Executor,
} from "../connection/execute.ts";
import type { Connection } from "../connection/settings.ts";
import {
  addTaskArguments,
  editTaskArguments,
  reopenTaskArguments,
  requireUuid,
  taskActionArguments,
  waitTaskArguments,
  type TaskInput,
} from "./arguments.ts";
import { filterArguments, tagName } from "./filter.ts";
import { parseTaskwarriorTasks } from "./model.ts";
import { isVirtualTag, parseProjects } from "./options.ts";
import { noteText, type RawTask } from "./raw.ts";
import { remapProjectBranch } from "./project-migration.ts";
import { validateRecurrence, validateUntil } from "./recurrence.ts";
import {
  createTaskRunner,
  formatTaskwarriorTimestamp,
  READ_OVERRIDES,
  type TaskScope,
} from "./service-runner.ts";
import { exportTimewarrior } from "./timewarrior.ts";

export type { TaskScope };

/** Creates the domain service for querying and mutating Taskwarrior & Timewarrior tasks. */
export function createTaskService(
  connection: Connection,
  executor: Executor = executeProcess,
) {
  const runner = createTaskRunner(connection, executor);

  return {
    connection,
    setRestoredSchema: runner.setRestoredSchema,
    dataDirectory: () =>
      runner.run(["_get", "rc.data.location", ...READ_OVERRIDES]),
    loadTasks: runner.loadTasks,
    exportTasks: () => runner.rawTasks(),
    exportTimerHistory: () => exportTimewarrior(connection, executor),
    async exportSchema() {
      const output = await runner.run(["_show", ...READ_OVERRIDES]);
      return Object.fromEntries(
        output.split(/\r?\n/).flatMap((line) => {
          const match = /^(uda\.[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line.trim());
          return match ? [[match[1], match[2]]] : [];
        }),
      );
    },
    rawTask: runner.rawTask,
    restoreTask(uuid: string, snapshot?: RawTask) {
      requireUuid(uuid);
      return serializeWrite(connection, async () => {
        const current = (await runner.rawTasks([uuid]))[0];
        if (current && current.status !== "deleted")
          throw new Error(
            "This task is no longer deleted. Refresh to check it.",
          );
        if (!current && !snapshot)
          throw new Error("Task is no longer retained by Taskwarrior.");
        const status =
          snapshot?.status ||
          (current?.recur && !current?.parent ? "recurring" : "pending");
        if (!["pending", "waiting", "completed", "recurring"].includes(status))
          throw new Error("Task cannot be restored.");
        if (!current) {
          const restored: RawTask = {
            ...snapshot!,
            status,
            modified: formatTaskwarriorTimestamp(),
          };
          delete restored.start;
          return runner.importTask(restored);
        }
        return runner.run(
          [
            uuid,
            "modify",
            `status:${status}`,
            `end:${status === "completed" ? snapshot?.end || "" : ""}`,
            "start:",
            "rc.confirmation=off",
            "rc.recurrence.confirmation=no",
            "rc.gc=off",
          ],
          true,
        );
      });
    },
    deleteWithSnapshot(
      uuid: string,
      beforeDelete: (task: RawTask) => Promise<void>,
    ) {
      requireUuid(uuid);
      return serializeWrite(connection, async () => {
        const task = await runner.rawTask(uuid);
        if (task.status === "deleted")
          throw new Error("This task is already deleted.");
        await beforeDelete(task);
        return runner.run(taskActionArguments(uuid, "delete"), true);
      });
    },
    removeNote(uuid: string, entry: string, description: string) {
      requireUuid(uuid);
      noteText(description);
      return serializeWrite(connection, async () => {
        const task = await runner.rawTask(uuid);
        if (task.status === "deleted")
          throw new Error("Restore the task before editing notes.");
        const index =
          task.annotations?.findIndex(
            (note) => note.entry === entry && note.description === description,
          ) ?? -1;
        if (index < 0)
          throw Object.assign(
            new Error("This note has changed. Reload before removing it."),
            { status: 409 },
          );
        const notes = [...task.annotations!];
        notes.splice(index, 1);
        return runner.importTask({
          ...task,
          annotations: notes,
          modified: formatTaskwarriorTimestamp(),
        });
      });
    },
    updateRecurrence(uuid: string, recur: string, until: string) {
      requireUuid(uuid);
      validateRecurrence(recur);
      validateUntil(until);
      if (!recur) throw new Error("Use Stop series to stop repeating.");
      return serializeWrite(connection, async () => {
        const task = await runner.rawTask(uuid);
        if (task.status !== "recurring")
          throw new Error("This repeating series is no longer active.");
        return runner.run(
          [
            uuid,
            "modify",
            `recur:${recur}`,
            `until:${until}`,
            "rc.confirmation=off",
            "rc.recurrence.confirmation=no",
            "rc.gc=off",
          ],
          true,
        );
      });
    },
    async filterTasks(expression: string) {
      const filters = filterArguments(expression);
      if (
        runner.isRecurrenceStale() &&
        (await runner.rawTasks(["status:recurring"])).some(
          (task) => task.status === "recurring",
        )
      ) {
        await runner.generateRecurrences();
      }
      return parseTaskwarriorTasks(
        await runner.run([
          "status.not:deleted",
          "status.not:recurring",
          "(",
          ...filters,
          ")",
          "export",
          ...READ_OVERRIDES,
        ]),
      ).filter((task) => task.status !== "recurring");
    },
    async loadTags() {
      return parseProjects(
        await runner.run(["_tags", ...READ_OVERRIDES]),
      ).filter((tag) => !isVirtualTag(tag));
    },
    changeTag(oldName: string, newName?: string) {
      tagName(oldName);
      if (newName !== undefined) tagName(newName);
      return runner.write([
        "status.not:deleted",
        `+${oldName}`,
        "modify",
        `-${oldName}`,
        ...(newName ? [`+${newName}`] : []),
        "rc.confirmation=off",
        "rc.recurrence.confirmation=no",
        "rc.bulk=0",
      ]);
    },
    changeProject: (oldName: string, newName?: string) =>
      remapProjectBranch(connection, runner, oldName, newName),
    async checkConnection() {
      const started = Date.now();
      const version = await runner.ensureVersion();
      const pending = await runner.loadTasks();
      return {
        version,
        pendingTasks: pending.length,
        elapsedMs: Date.now() - started,
      };
    },
    async loadProjects() {
      return parseProjects(
        await runner.run(["status.not:deleted", "_projects", ...READ_OVERRIDES]),
      );
    },
    addTask(input: TaskInput) {
      const args = addTaskArguments(input);
      const note = input.note?.trim() ? noteText(input.note) : "";
      return serializeWrite(connection, async () => {
        const output = await runner.run([...args, "rc.verbose=new-uuid"], true);
        try {
          if (note) {
            const uuid = output.match(
              /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
            )?.[0];
            if (!uuid) throw new Error("Created task ID unavailable.");
            await runner.appendNote(uuid, note);
          }
          runner.invalidateRecurrences();
          return output;
        } catch (error) {
          return runner.afterWriteError(error);
        }
      });
    },
    editTask(uuid: string, input: TaskInput) {
      const note = input.note?.trim() ? noteText(input.note) : "";
      return serializeWrite(connection, async () => {
        let values = input;
        if (input.recur !== undefined) {
          const current = await runner.rawTask(uuid);
          if (current.parent) {
            if (input.recur !== current.recur)
              throw new Error("Use Edit series to change this repeating task.");
            values = {
              ...input,
              recur: undefined,
              until: undefined,
            };
          } else if (input.recur === current.recur) {
            values = { ...input, recur: undefined };
          } else if (input.recur && !input.due)
            throw new Error("Choose a first due date for this repeating task.");
        }
        const output = await runner.run(editTaskArguments(uuid, values), true);
        try {
          if (note) await runner.appendNote(uuid, note);
          runner.invalidateRecurrences();
          return output;
        } catch (error) {
          return runner.afterWriteError(error);
        }
      });
    },
    completeTask: (uuid: string) => runner.write(taskActionArguments(uuid, "done")),
    reopenTask: (uuid: string) => runner.write(reopenTaskArguments(uuid)),
    deleteTask: (uuid: string) => runner.write(taskActionArguments(uuid, "delete")),
    startTask: (uuid: string) => runner.write(taskActionArguments(uuid, "start")),
    stopTask: (uuid: string) => runner.write(taskActionArguments(uuid, "stop")),
    setTaskWait: (uuid: string, wait: string) =>
      runner.write(waitTaskArguments(uuid, wait)),
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
