import { TaskExecutionError } from "../connection/errors.ts";
import {
  executeProcess,
  runTaskwarrior,
  serializeWrite,
  type Executor,
} from "../connection/execute.ts";
import type { Connection } from "../connection/settings.ts";
import { inProject } from "../workspace/focus.ts";
import {
  projectNames,
  remapProject,
  validateProjectName,
} from "../workspace/projects.ts";
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
import { parseTaskwarriorTasks, type TaskwarriorTask } from "./model.ts";
import { isVirtualTag, parseProjects } from "./options.ts";
import {
  parseRawTasks,
  noteText,
  importableTask,
  type RawTask,
} from "./raw.ts";
import { exportTimewarrior } from "./timewarrior.ts";
import { validateRecurrence, validateUntil } from "./recurrence.ts";

const READ_OVERRIDES = [
  "rc.json.array=on",
  "rc.color=off",
  "rc.verbose=nothing",
  "rc.gc=off",
  "rc.hooks=off",
];
const PENDING_FILTER = ["(", "status:pending", "or", "status:waiting", ")"];
export type TaskScope = "pending" | "completed" | "deleted";

export function createTaskService(
  connection: Connection,
  executor: Executor = executeProcess,
) {
  let restoredSchema: Record<string, string> = {};
  const rawRun = (args: string[], write = false, input?: string) => {
    if (args.length === 1 && args[0] === "--version")
      return runTaskwarrior(connection, args, write, executor, input);
    const schema = Object.entries(restoredSchema).map(
      ([key, value]) => `rc.${key}=${value}`,
    );
    const literal = args.indexOf("--");
    return runTaskwarrior(
      connection,
      literal < 0
        ? [...args, ...schema]
        : [...args.slice(0, literal), ...schema, ...args.slice(literal)],
      write,
      executor,
      input,
    );
  };
  let versionCheck: Promise<string> | undefined;
  const ensureVersion = () => {
    if (!versionCheck) {
      versionCheck = rawRun(["--version"])
        .then((output) => {
          const version = output.split(/\r?\n/)[0];
          if (!/^3\./.test(version))
            throw new Error(
              `Aster requires Taskwarrior 3. This connection returned “${version}”.`,
            );
          return version;
        })
        .catch((error) => {
          versionCheck = undefined;
          throw error;
        });
    }
    return versionCheck;
  };
  const run = async (args: string[], write = false, input?: string) => {
    await ensureVersion();
    return rawRun(args, write, input);
  };
  const write = (args: string[]) =>
    serializeWrite(connection, () => run(args, true));
  const rawTasks = async (filter: string[] = []) =>
    parseRawTasks(await run([...filter, "export", ...READ_OVERRIDES]));
  const rawTask = async (uuid: string) => {
    const task = (await rawTasks([requireUuid(uuid)]))[0];
    if (!task) throw new Error("Task no longer exists. Refresh to continue.");
    return task;
  };
  const importTask = async (task: RawTask) =>
    run(
      [
        "import",
        "-",
        "rc.confirmation=off",
        "rc.recurrence.confirmation=no",
        "rc.gc=off",
        "rc.hooks=off",
      ],
      true,
      JSON.stringify([importableTask(task)]),
    );
  let generatedAt = 0;
  const generateRecurrences = async () =>
    serializeWrite(connection, async () => {
      if (Date.now() - generatedAt < 60_000) return;
      // Native reports generate occurrences and update the template mask. GC here rebuilds IDs, never purges.
      await run(
        [
          "all",
          "rc.report.all.columns=uuid",
          "rc.report.all.labels=",
          "rc.limit=0",
          "rc.gc=on",
          "rc.recurrence=on",
          "rc.hooks=off",
          "rc.color=off",
          "rc.verbose=nothing",
        ],
        true,
      );
      generatedAt = Date.now();
    });
  const loadTasks = async (
    scope: TaskScope = "pending",
  ): Promise<TaskwarriorTask[]> => {
    let rows = await rawTasks(
      scope === "pending"
        ? [
            "(",
            "status:pending",
            "or",
            "status:waiting",
            "or",
            "status:recurring",
            ")",
          ]
        : [`status:${scope}`],
    );
    if (
      scope === "pending" &&
      rows.some((task) => task.status === "recurring")
    ) {
      await generateRecurrences();
      rows = await rawTasks(PENDING_FILTER);
    }
    const tasks = parseTaskwarriorTasks(JSON.stringify(rows));
    return scope === "pending"
      ? tasks.filter((task) => ["pending", "waiting"].includes(task.status))
      : tasks;
  };
  const appendNote = (uuid: string, text: string) =>
    run(
      [
        requireUuid(uuid),
        "annotate",
        "rc.confirmation=off",
        "rc.recurrence.confirmation=no",
        "rc.gc=off",
        "--",
        noteText(text),
      ],
      true,
    );
  const afterWriteError = (error: unknown): never => {
    throw new TaskExecutionError(
      "Some changes may already be saved. Refresh and check before submitting again.",
      "unknown",
      error,
    );
  };

  return {
    connection,
    setRestoredSchema(schema: Record<string, string>) {
      restoredSchema = { ...schema };
      generatedAt = 0;
    },
    dataDirectory: () => run(["_get", "rc.data.location", ...READ_OVERRIDES]),
    loadTasks,
    exportTasks: () => rawTasks(),
    exportTimerHistory: () => exportTimewarrior(connection, executor),
    async exportSchema() {
      const output = await run(["_show", ...READ_OVERRIDES]);
      return Object.fromEntries(
        output.split(/\r?\n/).flatMap((line) => {
          const match = /^(uda\.[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line.trim());
          return match ? [[match[1], match[2]]] : [];
        }),
      );
    },
    rawTask,
    restoreTask(uuid: string, snapshot?: RawTask) {
      requireUuid(uuid);
      return serializeWrite(connection, async () => {
        const current = (await rawTasks([uuid]))[0];
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
            modified: new Date()
              .toISOString()
              .replace(/[-:]/g, "")
              .replace(/\.\d{3}/, ""),
          };
          delete restored.start;
          return importTask(restored);
        }
        return run(
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
        const task = await rawTask(uuid);
        if (task.status === "deleted")
          throw new Error("This task is already deleted.");
        await beforeDelete(task);
        return run(taskActionArguments(uuid, "delete"), true);
      });
    },
    removeNote(uuid: string, entry: string, description: string) {
      requireUuid(uuid);
      noteText(description);
      return serializeWrite(connection, async () => {
        const task = await rawTask(uuid);
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
        return importTask({
          ...task,
          annotations: notes,
          modified: new Date()
            .toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d{3}/, ""),
        });
      });
    },
    updateRecurrence(uuid: string, recur: string, until: string) {
      requireUuid(uuid);
      validateRecurrence(recur);
      validateUntil(until);
      if (!recur) throw new Error("Use Stop series to stop repeating.");
      return serializeWrite(connection, async () => {
        const task = await rawTask(uuid);
        if (task.status !== "recurring")
          throw new Error("This repeating series is no longer active.");
        return run(
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
        Date.now() - generatedAt >= 60_000 &&
        (await rawTasks(["status:recurring"])).some(
          (task) => task.status === "recurring",
        )
      )
        await generateRecurrences();
      return parseTaskwarriorTasks(
        await run([
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
      return parseProjects(await run(["_tags", ...READ_OVERRIDES])).filter(
        (tag) => !isVirtualTag(tag),
      );
    },
    changeTag(oldName: string, newName?: string) {
      tagName(oldName);
      if (newName !== undefined) tagName(newName);
      return write([
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
    changeProject(oldName: string, newName?: string) {
      validateProjectName(oldName);
      if (newName !== undefined) {
        validateProjectName(newName);
        if (newName !== oldName && inProject(newName, oldName))
          throw new Error("A project cannot be moved inside itself.");
      }
      return serializeWrite(connection, async () => {
        if (newName === oldName) return;
        const tasks = parseTaskwarriorTasks(
          await run(["status.not:deleted", "export", ...READ_OVERRIDES]),
        );
        const paths = [
          ...new Set(
            tasks
              .filter((task) => inProject(task.project, oldName))
              .map((task) => task.project!),
          ),
        ];
        if (newName !== undefined) {
          const outside = new Set(
            projectNames(
              tasks.flatMap((task) =>
                task.project && !inProject(task.project, oldName)
                  ? [task.project]
                  : [],
              ),
            ).map((name) => name.toLocaleLowerCase()),
          );
          for (const path of [oldName, ...paths]) {
            const target = remapProject(path, oldName, newName);
            validateProjectName(target);
            if (outside.has(target.toLocaleLowerCase()))
              throw new Error(
                "This project name already exists. Reload before moving.",
              );
          }
        }
        // Process exact paths deepest first; preserve each descendant's suffix and task state.
        paths.sort((a, b) => b.length - a.length);
        for (const path of paths) {
          try {
            await run(
              [
                "status.not:deleted",
                `project.is:${path}`,
                "modify",
                `project:${newName === undefined ? "" : remapProject(path, oldName, newName)}`,
                "rc.confirmation=off",
                "rc.recurrence.confirmation=no",
                "rc.bulk=0",
              ],
              true,
            );
          } catch (error) {
            throw new TaskExecutionError(
              "Project update unconfirmed. Some tasks may have moved. Reload and check the branch before submitting again.",
              "unknown",
              error,
            );
          }
        }
      });
    },
    async checkConnection() {
      const started = Date.now();
      const version = await ensureVersion();
      const pending = await loadTasks();
      return {
        version,
        pendingTasks: pending.length,
        elapsedMs: Date.now() - started,
      };
    },
    async loadProjects() {
      return parseProjects(
        await run(["status.not:deleted", "_projects", ...READ_OVERRIDES]),
      );
    },
    addTask(input: TaskInput) {
      const args = addTaskArguments(input);
      const note = input.note?.trim() ? noteText(input.note) : "";
      return serializeWrite(connection, async () => {
        const output = await run([...args, "rc.verbose=new-uuid"], true);
        try {
          if (note) {
            const uuid = output.match(
              /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
            )?.[0];
            if (!uuid) throw new Error("Created task ID unavailable.");
            await appendNote(uuid, note);
          }
          generatedAt = 0;
          return output;
        } catch (error) {
          return afterWriteError(error);
        }
      });
    },
    editTask(uuid: string, input: TaskInput) {
      const note = input.note?.trim() ? noteText(input.note) : "";
      return serializeWrite(connection, async () => {
        let values = input;
        if (input.recur !== undefined) {
          const current = await rawTask(uuid);
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
        const output = await run(editTaskArguments(uuid, values), true);
        try {
          if (note) await appendNote(uuid, note);
          generatedAt = 0;
          return output;
        } catch (error) {
          return afterWriteError(error);
        }
      });
    },
    completeTask: (uuid: string) => write(taskActionArguments(uuid, "done")),
    reopenTask: (uuid: string) => write(reopenTaskArguments(uuid)),
    deleteTask: (uuid: string) => write(taskActionArguments(uuid, "delete")),
    startTask: (uuid: string) => write(taskActionArguments(uuid, "start")),
    stopTask: (uuid: string) => write(taskActionArguments(uuid, "stop")),
    setTaskWait: (uuid: string, wait: string) =>
      write(waitTaskArguments(uuid, wait)),
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
