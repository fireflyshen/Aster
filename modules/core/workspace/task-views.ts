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

/** Executes a task query through the shared workspace server when reachable, falling back to TaskService only when the server is unreachable. */
export async function queryWorkspaceTasks(
  service: TaskService,
  query: WorkspaceTaskQuery,
  client?: WorkspaceClient,
): Promise<TaskwarriorTask[]> {
  if (client?.tasks) {
    try {
      return (await client.tasks(query)).tasks;
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "UNAVAILABLE") {
        throw error;
      }
    }
  }
  if (query.filter !== undefined) return service.filterTasks(query.filter);
  if (query.scope === "board" || query.scope === "all") {
    const [pending, completed] = await Promise.all([
      service.loadTasks("pending"),
      service.loadTasks("completed"),
    ]);
    return [...pending, ...completed];
  }
  return service.loadTasks(
    query.scope === "completed" ? "completed" : "pending",
  );
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
        tags: uniqueTags(result.tasks.flatMap((task) => task.tags)).filter(
          (tag) => !isVirtualTag(tag),
        ),
      };
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "UNAVAILABLE") {
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

/** Loads the filtered task list for any Raycast Desktop view. */
export async function loadTaskView(
  service: TaskService,
  view: string,
  organization?: Organization,
  expression = "",
  client?: WorkspaceClient,
): Promise<TaskwarriorTask[]> {
  if (view === "expression") {
    return queryWorkspaceTasks(service, { filter: expression }, client);
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
    return queryWorkspaceTasks(service, { filter: filter.expression }, client);
  }
  if (view.startsWith("column:")) {
    if (!organization) {
      throw new Error(
        "Web workspace unavailable. Refresh or choose another view.",
      );
    }
    const tasks = await queryWorkspaceTasks(
      service,
      { scope: "board" },
      client,
    );
    return columnTasks(
      tasks,
      organization.board || defaultBoard(),
      view.slice(7),
    );
  }
  const scope = view === "completed" ? "completed" : "pending";
  const tasks = await queryWorkspaceTasks(service, { scope }, client);
  if (view === "focus" || view === "later") {
    if (!organization) {
      throw new Error(
        "Shared Focus unavailable. Refresh before choosing projects.",
      );
    }
    return tasks.filter((task) =>
      view === "focus"
        ? focusProject(task.project, organization.projects)?.nextTask ===
          task.uuid
        : !!task.project && !focusProject(task.project, organization.projects),
    );
  }
  if (view === "inbox") return tasks.filter((task) => !task.project);
  if (view === "active") return tasks.filter((task) => !!task.start);
  if (view.startsWith("project:"))
    return tasks.filter((task) => inProject(task.project, view.slice(8)));
  if (view.startsWith("tag:"))
    return tasks.filter((task) => task.tags.includes(view.slice(4)));
  return tasksForView(tasks, view as TaskView);
}
