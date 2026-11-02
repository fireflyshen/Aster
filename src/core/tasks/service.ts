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
    taskActionArguments,
    waitTaskArguments,
    type TaskInput,
} from "./arguments.ts";
import { filterArguments, tagName } from "./filter.ts";
import { parseTaskwarriorTasks, type TaskwarriorTask } from "./model.ts";
import { isVirtualTag, parseProjects } from "./options.ts";

const READ_OVERRIDES = [
    "rc.json.array=on",
    "rc.color=off",
    "rc.verbose=nothing",
    "rc.gc=off",
    "rc.hooks=off",
];
const PENDING_FILTER = ["(", "status:pending", "or", "status:waiting", ")"];
export type TaskScope = "pending" | "completed";

export function createTaskService(
    connection: Connection,
    executor: Executor = executeProcess,
) {
    const rawRun = (args: string[], write = false) =>
        runTaskwarrior(connection, args, write, executor);
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
    const run = async (args: string[], write = false) => {
        await ensureVersion();
        return rawRun(args, write);
    };
    const write = (args: string[]) =>
        serializeWrite(connection, () => run(args, true));
    const loadTasks = async (
        scope: TaskScope = "pending",
    ): Promise<TaskwarriorTask[]> =>
        parseTaskwarriorTasks(
            await run([
                ...(scope === "completed"
                    ? ["status:completed"]
                    : PENDING_FILTER),
                "export",
                ...READ_OVERRIDES,
            ]),
        );

    return {
        connection,
        loadTasks,
        async filterTasks(expression: string) {
            return parseTaskwarriorTasks(
                await run([
                    "status.not:deleted",
                    "(",
                    ...filterArguments(expression),
                    ")",
                    "export",
                    ...READ_OVERRIDES,
                ]),
            );
        },
        async loadTags() {
            return parseProjects(
                await run(["_tags", ...READ_OVERRIDES]),
            ).filter((tag) => !isVirtualTag(tag));
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
                    await run([
                        "status.not:deleted",
                        "export",
                        ...READ_OVERRIDES,
                    ]),
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
                                task.project &&
                                !inProject(task.project, oldName)
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
                await run([
                    "status.not:deleted",
                    "_projects",
                    ...READ_OVERRIDES,
                ]),
            );
        },
        addTask: (input: TaskInput) => write(addTaskArguments(input)),
        editTask: (uuid: string, input: TaskInput) =>
            write(editTaskArguments(uuid, input)),
        completeTask: (uuid: string) =>
            write(taskActionArguments(uuid, "done")),
        reopenTask: (uuid: string) => write(reopenTaskArguments(uuid)),
        deleteTask: (uuid: string) =>
            write(taskActionArguments(uuid, "delete")),
        startTask: (uuid: string) => write(taskActionArguments(uuid, "start")),
        stopTask: (uuid: string) => write(taskActionArguments(uuid, "stop")),
        setTaskWait: (uuid: string, wait: string) =>
            write(waitTaskArguments(uuid, wait)),
    };
}

export type TaskService = ReturnType<typeof createTaskService>;
