import {
    tasksForView,
    type TaskView,
    type TaskwarriorTask,
} from "../tasks/model.ts";
import { isVirtualTag, uniqueTags } from "../tasks/options.ts";
import type { TaskService } from "../tasks/service.ts";
import { columnTasks, defaultBoard } from "./board.ts";
import {
    WorkspaceError,
    type WorkspaceClient,
    type WorkspaceTaskQuery,
} from "./client.ts";
import { focusProject, inProject } from "./focus.ts";
import type { Organization } from "./organization.ts";

/** Executes a task query through the shared workspace server when reachable, returning tasks and any project catalog included by the server. */
export async function queryWorkspaceTasksWithCatalog(
    service: TaskService,
    query: WorkspaceTaskQuery,
    client?: WorkspaceClient,
): Promise<{ tasks: TaskwarriorTask[]; projects?: string[] }> {
    if (client?.tasks) {
        try {
            return await client.tasks(query);
        } catch (error) {
            if (
                !(error instanceof WorkspaceError) ||
                error.code !== "UNAVAILABLE"
            ) {
                throw error;
            }
        }
    }
    if (query.filter !== undefined) {
        return { tasks: await service.filterTasks(query.filter) };
    }
    if (query.scope === "board" || query.scope === "all") {
        const [pending, completed] = await Promise.all([
            service.loadTasks("pending"),
            service.loadTasks("completed"),
        ]);
        return { tasks: [...pending, ...completed] };
    }
    return {
        tasks: await service.loadTasks(
            query.scope === "completed" ? "completed" : "pending",
        ),
    };
}

/** Executes a task query through the shared workspace server when reachable, falling back to TaskService only when the server is unreachable. */
export async function queryWorkspaceTasks(
    service: TaskService,
    query: WorkspaceTaskQuery,
    client?: WorkspaceClient,
): Promise<TaskwarriorTask[]> {
    return (await queryWorkspaceTasksWithCatalog(service, query, client)).tasks;
}

/** Loads project names and user tags via the shared workspace server when reachable, falling back to TaskService. */
export async function loadTaskCatalog(
    service: TaskService,
    client?: WorkspaceClient,
): Promise<{ projects: string[]; tags: string[] }> {
    if (client?.tasks) {
        try {
            const result = await client.tasks({ scope: "all" });
            return {
                projects: result.projects,
                tags: uniqueTags(
                    result.tasks.flatMap((task) => task.tags),
                ).filter((tag) => !isVirtualTag(tag)),
            };
        } catch (error) {
            if (
                !(error instanceof WorkspaceError) ||
                error.code !== "UNAVAILABLE"
            ) {
                throw error;
            }
        }
    }
    const [projects, tags] = await Promise.all([
        service.loadProjects(),
        service.loadTags(),
    ]);
    return { projects, tags };
}

/** Loads filtered tasks along with server-reported project catalog in a single round-trip. */
export async function loadTaskViewWithCatalog(
    service: TaskService,
    view: string,
    organization?: Organization,
    expression = "",
    client?: WorkspaceClient,
): Promise<{ tasks: TaskwarriorTask[]; projects?: string[] }> {
    if (view === "expression") {
        return queryWorkspaceTasksWithCatalog(
            service,
            { filter: expression },
            client,
        );
    }
    if (view.startsWith("filter:")) {
        const filter = organization?.filters.find(
            (item) => item.id === view.slice(7),
        );
        if (!filter) {
            throw new Error(
                "Saved filter unavailable. Refresh the web workspace or choose another view.",
            );
        }
        return queryWorkspaceTasksWithCatalog(
            service,
            { filter: filter.expression },
            client,
        );
    }
    if (view.startsWith("column:")) {
        if (!organization) {
            throw new Error(
                "Web workspace unavailable. Refresh or choose another view.",
            );
        }
        const result = await queryWorkspaceTasksWithCatalog(
            service,
            { scope: "board" },
            client,
        );
        return {
            tasks: columnTasks(
                result.tasks,
                organization.board || defaultBoard(),
                view.slice(7),
            ),
            projects: result.projects,
        };
    }
    const scope = view === "completed" ? "completed" : "pending";
    const result = await queryWorkspaceTasksWithCatalog(
        service,
        { scope },
        client,
    );
    const { tasks, projects } = result;
    if (view === "focus" || view === "later") {
        if (!organization) {
            throw new Error(
                "Shared Focus unavailable. Refresh before choosing projects.",
            );
        }
        return {
            tasks: tasks.filter((task) =>
                view === "focus"
                    ? focusProject(task.project, organization.projects)
                          ?.nextTask === task.uuid
                    : !!task.project &&
                      !focusProject(task.project, organization.projects),
            ),
            projects,
        };
    }
    if (view === "inbox") {
        return { tasks: tasks.filter((task) => !task.project), projects };
    }
    if (view === "active") {
        return { tasks: tasks.filter((task) => !!task.start), projects };
    }
    if (view.startsWith("project:")) {
        return {
            tasks: tasks.filter((task) =>
                inProject(task.project, view.slice(8)),
            ),
            projects,
        };
    }
    if (view.startsWith("tag:")) {
        return {
            tasks: tasks.filter((task) => task.tags.includes(view.slice(4))),
            projects,
        };
    }
    return { tasks: tasksForView(tasks, view as TaskView), projects };
}

/** Loads the filtered task list for any Raycast Desktop view. */
export async function loadTaskView(
    service: TaskService,
    view: string,
    organization?: Organization,
    expression = "",
    client?: WorkspaceClient,
): Promise<TaskwarriorTask[]> {
    return (
        await loadTaskViewWithCatalog(
            service,
            view,
            organization,
            expression,
            client,
        )
    ).tasks;
}
