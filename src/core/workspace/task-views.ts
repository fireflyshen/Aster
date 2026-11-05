import { tasksForView, type TaskView } from "../tasks/model.ts";
import type { TaskService } from "../tasks/service.ts";
import { columnTasks, defaultBoard } from "./board.ts";
import { focusProject, inProject } from "./focus.ts";
import type { Organization } from "./organization.ts";

export async function loadTaskView(service: TaskService, view: string, organization?: Organization, expression = "") {
  if (view === "expression") return service.filterTasks(expression);
  if (view.startsWith("filter:")) {
    const filter = organization?.filters.find((item) => item.id === view.slice(7));
    if (!filter) throw new Error("Saved filter unavailable. Refresh the web workspace or choose another view.");
    return service.filterTasks(filter.expression);
  }
  if (view.startsWith("column:")) {
    if (!organization) throw new Error("Web workspace unavailable. Refresh or choose another view.");
    const tasks = (await Promise.all([service.loadTasks(), service.loadTasks("completed")])).flat();
    return columnTasks(tasks, organization.board || defaultBoard(), view.slice(7));
  }
  const scope = view === "completed" ? "completed" : "pending";
  const tasks = await service.loadTasks(scope);
  if (view === "focus" || view === "later") {
    if (!organization) throw new Error("Shared Focus unavailable. Refresh before choosing projects.");
    return tasks.filter((task) =>
      view === "focus"
        ? focusProject(task.project, organization.projects)?.nextTask === task.uuid
        : !!task.project && !focusProject(task.project, organization.projects),
    );
  }
  if (view === "inbox") return tasks.filter((task) => !task.project);
  if (view === "active") return tasks.filter((task) => !!task.start);
  if (view.startsWith("project:")) return tasks.filter((task) => inProject(task.project, view.slice(8)));
  if (view.startsWith("tag:")) return tasks.filter((task) => task.tags.includes(view.slice(4)));
  return tasksForView(tasks, view as TaskView);
}
