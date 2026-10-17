import { executeProcess, runTaskwarrior, serializeWrite, type Executor } from "../connection/execute.ts";
import type { Connection } from "../connection/settings.ts";
import {
  addTaskArguments,
  editTaskArguments,
  reopenTaskArguments,
  taskActionArguments,
  waitTaskArguments,
  type TaskInput,
} from "./arguments.ts";
import { parseTaskwarriorTasks, type TaskwarriorTask } from "./model.ts";
import { parseProjects } from "./options.ts";

const READ_OVERRIDES = ["rc.json.array=on", "rc.color=off", "rc.verbose=nothing", "rc.gc=off", "rc.hooks=off"];
const PENDING_FILTER = ["(", "status:pending", "or", "status:waiting", ")"];
export type TaskScope = "pending" | "completed";

export function createTaskService(connection: Connection, executor: Executor = executeProcess) {
  const rawRun = (args: string[], write = false) => runTaskwarrior(connection, args, write, executor);
  let versionCheck: Promise<string> | undefined;
  const ensureVersion = () => {
    if (!versionCheck) {
      versionCheck = rawRun(["--version"])
        .then((output) => {
          const version = output.split(/\r?\n/)[0];
          if (!/^3\./.test(version))
            throw new Error(`Aster requires Taskwarrior 3. This connection returned “${version}”.`);
          return version;
        })
        .catch((error) => {
          versionCheck = undefined;
          throw error;
        });
    }
    return versionCheck;
  };
  const run = async (args: string[], write = false) => {
    await ensureVersion();
    return rawRun(args, write);
  };
  const write = (args: string[]) => serializeWrite(connection, () => run(args, true));
  const loadTasks = async (scope: TaskScope = "pending"): Promise<TaskwarriorTask[]> =>
    parseTaskwarriorTasks(
      await run([...(scope === "completed" ? ["status:completed"] : PENDING_FILTER), "export", ...READ_OVERRIDES]),
    );

  return {
    connection,
    loadTasks,
    async checkConnection() {
      const started = Date.now();
      const version = await ensureVersion();
      const pending = await loadTasks();
      return { version, pendingTasks: pending.length, elapsedMs: Date.now() - started };
    },
    async loadProjects() {
      return parseProjects(await run(["_projects", ...READ_OVERRIDES]));
    },
    addTask: (input: TaskInput) => write(addTaskArguments(input)),
    editTask: (uuid: string, input: TaskInput) => write(editTaskArguments(uuid, input)),
    completeTask: (uuid: string) => write(taskActionArguments(uuid, "done")),
    reopenTask: (uuid: string) => write(reopenTaskArguments(uuid)),
    deleteTask: (uuid: string) => write(taskActionArguments(uuid, "delete")),
    startTask: (uuid: string) => write(taskActionArguments(uuid, "start")),
    stopTask: (uuid: string) => write(taskActionArguments(uuid, "stop")),
    setTaskWait: (uuid: string, wait: string) => write(waitTaskArguments(uuid, wait)),
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
