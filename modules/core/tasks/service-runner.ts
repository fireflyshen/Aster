import { TaskExecutionError } from "../connection/errors.ts";
import {
  runTaskwarrior,
  serializeWrite,
  type Executor,
} from "../connection/execute.ts";
import type { Connection } from "../connection/settings.ts";
import { requireUuid } from "./arguments.ts";
import { parseTaskwarriorTasks, type TaskwarriorTask } from "./model.ts";
import {
  importableTask,
  noteText,
  parseRawTasks,
  type RawTask,
} from "./raw.ts";

export const READ_OVERRIDES = [
  "rc.json.array=on",
  "rc.color=off",
  "rc.verbose=nothing",
  "rc.gc=off",
  "rc.hooks=off",
];

const PENDING_FILTER = ["(", "status:pending", "or", "status:waiting", ")"];

export type TaskScope = "pending" | "completed" | "deleted";

/** Formats a `Date` into Taskwarrior's compact UTC ISO timestamp (`YYYYMMDDTHHMMSSZ`). */
export function formatTaskwarriorTimestamp(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Creates the low-level Taskwarrior command, export/import, and recurrence runner. */
export function createTaskRunner(connection: Connection, executor: Executor) {
  let restoredSchema: Record<string, string> = {};
  let versionCheck: Promise<string> | undefined;
  let generatedAt = 0;

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

  const importTask = (task: RawTask) =>
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

  const isRecurrenceStale = () => Date.now() - generatedAt >= 60_000;

  const generateRecurrences = () =>
    serializeWrite(connection, async () => {
      if (!isRecurrenceStale()) return;
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
    setRestoredSchema(schema: Record<string, string>) {
      restoredSchema = { ...schema };
      generatedAt = 0;
    },
    invalidateRecurrences() {
      generatedAt = 0;
    },
    isRecurrenceStale,
    ensureVersion,
    run,
    write,
    rawTasks,
    rawTask,
    importTask,
    generateRecurrences,
    loadTasks,
    appendNote,
    afterWriteError,
  };
}

export type TaskRunner = ReturnType<typeof createTaskRunner>;
