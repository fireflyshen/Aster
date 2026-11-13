import { Alert, confirmAlert, showToast, Toast } from "@raycast/api";
import { useRef, useState } from "react";
import { TaskExecutionError } from "../../../core/connection/errors.ts";
import type { TaskInput } from "../../../core/tasks/arguments.ts";
import { formatTaskDate } from "../../../core/tasks/date.ts";
import { taskDate } from "../../../core/tasks/quick-task.ts";
import type { TaskwarriorTask } from "../../../core/tasks/model.ts";
import type { TaskService } from "../../../core/tasks/service.ts";
import type { WorkspaceClient } from "../../../core/workspace/client.ts";
import { queryWorkspaceTasks } from "../../../core/workspace/task-views.ts";
import { focusProject } from "../../../core/workspace/focus.ts";
import type { Organization } from "../../../core/workspace/organization.ts";

export type TaskMutationAction = "complete" | "reopen" | "start" | "stop";

interface UseTaskListActionsOptions {
  service: TaskService;
  client: WorkspaceClient | undefined;
  organization: Organization | undefined;
  revalidateTasks: () => Promise<unknown>;
  revalidateWorkspace: () => Promise<unknown>;
}

/** Encapsulates task mutations, undo, Focus/Energy actions, and optimistic locks for MyTasks. */
export function useTaskListActions({
  service,
  client,
  organization,
  revalidateTasks,
  revalidateWorkspace,
}: UseTaskListActionsOptions) {
  const busy = useRef(false);
  const unconfirmed = useRef(new Set<string>());
  const [isMutating, setIsMutating] = useState(false);
  const [undoTask, setUndoTask] = useState<TaskwarriorTask>();
  const [pendingTask, setPendingTask] = useState<string>();

  async function refreshTasks() {
    const result = await revalidateTasks();
    // Raycast's usePromise resolves revalidation errors instead of rejecting.
    if (result instanceof Error) throw result;
  }

  async function refreshAll() {
    const [tasks] = await Promise.all([
      revalidateTasks(),
      revalidateWorkspace(),
    ]);
    if (tasks instanceof Error) throw tasks;
    unconfirmed.current.clear();
  }

  function runTaskAction(task: TaskwarriorTask, action: TaskMutationAction) {
    if (client?.taskAction) {
      return client.taskAction({ uuid: task.uuid, action });
    }
    return action === "complete"
      ? service.completeTask(task.uuid)
      : action === "reopen"
        ? service.reopenTask(task.uuid)
        : action === "start"
          ? service.startTask(task.uuid)
          : service.stopTask(task.uuid);
  }

  async function mutate(
    task: TaskwarriorTask,
    title: string,
    action: () => Promise<unknown>,
    reversible = false,
  ) {
    if (busy.current || unconfirmed.current.has(task.uuid)) return;
    busy.current = true;
    setIsMutating(true);
    setPendingTask(task.uuid);
    setUndoTask(undefined);
    const toast = await showToast({ style: Toast.Style.Animated, title });
    try {
      await action();
      toast.style = Toast.Style.Success;
      toast.message = task.description;
      if (reversible) setUndoTask(task);
      try {
        await Promise.all([refreshTasks(), revalidateWorkspace()]);
      } catch {
        toast.message = "Saved. Refresh to load the latest tasks.";
      }
    } catch (error) {
      if (error instanceof TaskExecutionError && error.outcome === "unknown") {
        unconfirmed.current.add(task.uuid);
      }
      toast.style = Toast.Style.Failure;
      toast.title =
        error instanceof TaskExecutionError && error.outcome === "unknown"
          ? "Result Unconfirmed"
          : "Could Not Update Task";
      toast.message = error instanceof Error ? error.message : String(error);
      await refreshTasks().catch(() => undefined);
    } finally {
      busy.current = false;
      setIsMutating(false);
      setPendingTask(undefined);
    }
  }

  async function undo() {
    if (!undoTask || busy.current) return;
    const task = undoTask;
    setUndoTask(undefined);
    await mutate(
      task,
      task.status === "completed" ? "Task completed" : "Task reopened",
      async () => {
        const matches = await queryWorkspaceTasks(
          service,
          {
            scope: task.status === "completed" ? "pending" : "completed",
          },
          client,
        );
        if (!matches.some((current) => current.uuid === task.uuid)) {
          throw new Error("This task has changed. Refresh before undoing.");
        }
        return task.status === "completed"
          ? runTaskAction(task, "complete")
          : runTaskAction(task, "reopen");
      },
    );
  }

  function startOrStopTask(task: TaskwarriorTask) {
    if (!task.start && organization?.timing?.available === false) {
      void showToast({
        style: Toast.Style.Failure,
        title: "Timer Data Unavailable",
        message:
          "Refresh before starting. Existing timers can still be stopped.",
      });
      return;
    }
    if (
      !task.start &&
      organization?.energy &&
      organization.energy.remaining <= 0
    ) {
      void showToast({
        style: Toast.Style.Failure,
        title: "Daily Energy Exhausted",
        message: `0/${organization.energy.max} remaining. Restore +30 energy or rest until 06:00.`,
      });
      return;
    }
    void mutate(task, task.start ? "Task stopped" : "Task started", () =>
      task.start ? runTaskAction(task, "stop") : runTaskAction(task, "start"),
    );
  }

  function deferTask(task: TaskwarriorTask, date: Date | null) {
    if (!date) return;
    const wait = formatTaskDate(date);
    void mutate(task, "Task deferred", () =>
      client?.taskAction
        ? client.taskAction({ uuid: task.uuid, action: "wait", wait })
        : service.setTaskWait(task.uuid, wait),
    );
  }

  function clearWaitingDate(task: TaskwarriorTask) {
    return mutate(task, "Task available", () =>
      client?.taskAction
        ? client.taskAction({
            uuid: task.uuid,
            action: "wait",
            wait: "",
          })
        : service.setTaskWait(task.uuid, ""),
    );
  }

  async function setTaskNextStep(task: TaskwarriorTask) {
    if (!task.project || !organization || !client) return;
    const project =
      focusProject(task.project, organization.projects) ||
      organization.projects?.find((p) => p.name === task.project);
    if (!project) return;
    try {
      await client.change({
        revision: organization.revision,
        kind: "project",
        action: "save",
        originalName: project.name,
        item: { ...project, nextTask: task.uuid },
      });
      await refreshAll();
      await showToast({
        style: Toast.Style.Success,
        title: "Next Step Updated",
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Set Next Step",
        message: (error as Error).message,
      });
    }
  }

  async function restoreElixir() {
    if (!client || !organization) return;
    try {
      await client.change({
        revision: organization.revision,
        kind: "energy",
        action: "elixir",
      });
      await refreshAll();
      await showToast({
        style: Toast.Style.Success,
        title: "Energy Restored (+30)",
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could Not Restore Energy",
        message: (error as Error).message,
      });
    }
  }

  function baseTaskInput(task: TaskwarriorTask): TaskInput {
    return {
      description: task.description,
      project: task.project,
      due: task.due ? formatTaskDate(task.due, task.due) : undefined,
      priority: task.priority,
      tags: [...task.tags],
    };
  }

  function editTaskPatch(
    task: TaskwarriorTask,
    title: string,
    patch: Partial<TaskInput>,
  ) {
    const next: TaskInput = { ...baseTaskInput(task), ...patch };
    return mutate(task, title, () =>
      client?.taskAction
        ? client.taskAction({
            uuid: task.uuid,
            action: "edit",
            task: next,
          })
        : service.editTask(task.uuid, next),
    );
  }

  function setPriority(task: TaskwarriorTask, priority: "H" | "M" | "L" | "") {
    const label =
      priority === "H"
        ? "Priority set to P1"
        : priority === "M"
          ? "Priority set to P2"
          : priority === "L"
            ? "Priority set to P3"
            : "Priority cleared";
    return editTaskPatch(task, label, { priority });
  }

  function rescheduleDue(
    task: TaskwarriorTask,
    date: Date | null,
    preserveTime = false,
  ) {
    const due = date
      ? preserveTime
        ? taskDate(date)
        : formatTaskDate(date, task.due)
      : undefined;
    return editTaskPatch(task, due ? "Due date updated" : "Due date cleared", {
      due,
    });
  }

  async function unlinkSubtask(task: TaskwarriorTask) {
    if (!client || !organization) return;
    await mutate(task, "Unlinked from parent", () =>
      client.change({
        revision: organization.revision,
        kind: "subtask",
        action: "unlink",
        childUuid: task.uuid,
      }),
    );
  }

  async function confirmDeleteTask(task: TaskwarriorTask) {
    const confirmed = await confirmAlert({
      title: "Delete this task?",
      message:
        task.description +
        (client?.taskAction
          ? "\nYou can restore it in Data & Recovery."
          : "\nThe shared workspace is disabled; this deletion will not have a recovery snapshot."),
      primaryAction: {
        title: "Delete Task",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;
    await mutate(task, "Task deleted", () =>
      client?.taskAction
        ? client.taskAction({ uuid: task.uuid, action: "delete" })
        : service.deleteTask(task.uuid),
    );
  }

  return {
    isMutating,
    undoTask,
    pendingTask,
    isTaskUnconfirmed: (uuid: string) => unconfirmed.current.has(uuid),
    refreshAll,
    mutate,
    runTaskAction,
    undo,
    startOrStopTask,
    deferTask,
    clearWaitingDate,
    setTaskNextStep,
    setPriority,
    rescheduleDue,
    unlinkSubtask,
    restoreElixir,
    confirmDeleteTask,
  };
}
