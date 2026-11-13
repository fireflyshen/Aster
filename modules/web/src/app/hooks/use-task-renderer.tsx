import { toDueDay } from "@/features/tasks/task-date";
import { TaskRow } from "@/features/tasks/task-row";
import type { Organization } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { format } from "date-fns";
import type { ReactNode } from "react";
import type { CompletionTransition } from "./use-task-completion";

export type TaskRenderFn = (
  task: Task,
  extraActions?: ReactNode,
  variant?: "list" | "card",
  depth?: number,
  renderSubtaskWrapper?: (
    child: Task,
    defaultRender: (child: Task) => ReactNode,
  ) => ReactNode,
) => ReactNode;

interface UseTaskRendererOptions {
  now: Date;
  currentProject: string;
  organization: Organization;
  filterProjects: string[];
  subtasksMap: Map<string, Task[]>;
  taskLinks: Record<string, string>;
  rowDisabled: boolean;
  completion: CompletionTransition | undefined;
  expandedDrop: { uuid: string; version: number } | undefined;
  taskTrackedSeconds: (task: Task) => number | undefined;
  openEditor: (task?: Task, initial?: TaskInput) => void;
  toggleTask: (task: Task, nextCompleted: boolean) => unknown;
  toggleStartTask: (task: Task) => unknown;
  patchTaskFields: (
    task: Task,
    patch: { due?: string; priority?: "H" | "M" | "L" | "" },
  ) => unknown;
  saveInlineTask: (
    task: Task,
    input: TaskInput & { taskDescription?: string },
  ) => Promise<boolean>;
  deleteTask: (task: Task) => unknown;
  createSubtask: (
    parentUuid: string,
    input: TaskInput & { taskDescription?: string },
  ) => Promise<boolean>;
  unlinkSubtask: (uuid: string) => unknown;
}

/** Builds the recursive `TaskRow` render callback bound to workspace task actions and state. */
export function useTaskRenderer(options: UseTaskRendererOptions): TaskRenderFn {
  const {
    now,
    currentProject,
    organization,
    filterProjects,
    subtasksMap,
    taskLinks,
    rowDisabled,
    completion,
    expandedDrop,
    taskTrackedSeconds,
    openEditor,
    toggleTask,
    toggleStartTask,
    patchTaskFields,
    saveInlineTask,
    deleteTask,
    createSubtask,
    unlinkSubtask,
  } = options;

  const todayDayKey = format(now, "yyyy-MM-dd");

  const renderTask: TaskRenderFn = (
    task,
    extraActions,
    variant = "list",
    depth = 0,
    renderSubtaskWrapper,
  ) => {
    const subtasks = subtasksMap.get(task.uuid) || [];
    const dueDay = task.due ? toDueDay(task.due) : "";
    const overdue = Boolean(
      dueDay && task.status !== "completed" && dueDay < todayDayKey,
    );
    const isRowTransition = completion?.uuid === task.uuid;
    const completed =
      task.status === "completed" ||
      Boolean(isRowTransition && completion?.checked);

    const renderPlainChild = (child: Task): ReactNode =>
      renderTask(child, undefined, variant, depth + 1, renderSubtaskWrapper);

    const renderSubtaskNode = (child: Task): ReactNode =>
      renderSubtaskWrapper
        ? renderSubtaskWrapper(child, renderPlainChild)
        : renderPlainChild(child);

    return (
      <TaskRow
        key={task.uuid}
        task={task}
        completed={completed}
        overdue={overdue}
        disabled={rowDisabled}
        onEdit={() => openEditor(task)}
        onComplete={() => void toggleTask(task, !completed)}
        onToggleStart={() => void toggleStartTask(task)}
        onDueChange={(nextDue) => void patchTaskFields(task, { due: nextDue })}
        onPriorityChange={(priority) =>
          void patchTaskFields(task, { priority })
        }
        onSaveInline={(input) => saveInlineTask(task, input)}
        onDelete={() => void deleteTask(task)}
        projects={filterProjects}
        availableLabels={organization.tags || []}
        extraActions={extraActions}
        trackedSeconds={taskTrackedSeconds(task)}
        timingUnavailable={organization.timing?.available === false}
        showProject={!currentProject}
        variant={variant}
        transition={isRowTransition ? completion : undefined}
        subtasks={subtasks}
        isSubtask={Boolean(taskLinks[task.uuid])}
        depth={depth}
        description={organization.descriptions?.[task.uuid]}
        onAddSubtask={(input) => createSubtask(task.uuid, input)}
        onUnlinkSubtask={
          taskLinks[task.uuid] ? () => void unlinkSubtask(task.uuid) : undefined
        }
        onToggleSubtask={(subtask, nextCompleted) =>
          void toggleTask(subtask, nextCompleted)
        }
        onEditSubtask={(subtask) => openEditor(subtask)}
        renderSubtask={renderSubtaskNode}
        expandSubtasks={
          expandedDrop?.uuid === task.uuid ? expandedDrop.version : undefined
        }
      />
    );
  };

  return renderTask;
}
