import type { EnergySummary } from "@core/workspace/energy";
import type { Organization } from "@core/workspace/organization";
import type { Task, View } from "@shared/tasks";
import { useCallback, useState, type MutableRefObject } from "react";
import type { MutateOrigin } from "./use-task-editor";
import type { CompleteBehavior } from "./use-workspace-navigation";

export type UndoState = {
  task: Task;
  wasCompleted: boolean;
  wasStarted?: boolean;
  wasDeleted?: boolean;
  message?: string;
  board?: {
    columnId: string;
    beforeUuid: string | null;
    parentUuid: string | null;
  };
};

export type CompletionTransition = {
  uuid: string;
  checked: boolean;
  phase: "checking" | "leaving";
};

type TaskCompletionDeps = {
  completedView?: boolean;
  completeBehavior?: CompleteBehavior;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  organization: Organization;
  organizationSaving: boolean;
  loading: boolean;
  needsCheck: boolean;
  energy?: EnergySummary;
  isTimingTask?: (uuid: string) => boolean;
  writeLock: MutableRefObject<boolean>;
  isSubtask: (uuid: string) => boolean;
  setNotice: (message: string) => void;
  mutateWithOrigin: (
    route: string,
    data: unknown,
    origin?: MutateOrigin,
    beforeApply?: (tasks: Task[]) => Promise<void>,
  ) => Promise<boolean>;
};

function applyCompletionToList(
  prev: Task[],
  uuid: string,
  completedView: boolean,
  wasCompleted: boolean,
  childTask: boolean,
  keepCompleted: boolean,
): Task[] {
  if (completedView) {
    return wasCompleted
      ? prev.filter((item) => item.uuid !== uuid)
      : prev.map((item) =>
          item.uuid === uuid
            ? {
                ...item,
                status: "completed",
                end: item.end || new Date().toISOString(),
              }
            : item,
        );
  }
  if (!wasCompleted && !childTask && !keepCompleted) {
    return prev.filter((item) => item.uuid !== uuid);
  }
  const nextStatus = wasCompleted ? "pending" : "completed";
  return prev.map((item) =>
    item.uuid === uuid
      ? {
          ...item,
          status: nextStatus,
          end:
            nextStatus === "completed"
              ? item.end || new Date().toISOString()
              : undefined,
        }
      : item,
  );
}

/** Manages optimistic completion/timing transitions and undo toast notifications. */
export function useTaskCompletion(deps: TaskCompletionDeps) {
  const {
    completedView = false,
    completeBehavior = "hide",
    setTasks,
    organization,
    organizationSaving,
    loading,
    needsCheck,
    energy,
    isTimingTask,
    writeLock,
    isSubtask,
    setNotice,
    mutateWithOrigin,
  } = deps;

  const [toastOpen, setToastOpen] = useState(false);
  const [toastVersion, setToastVersion] = useState(0);
  const [undoTask, setUndoTask] = useState<UndoState>();
  const [addedProject, setAddedProject] = useState("");
  const [completion, setCompletion] = useState<CompletionTransition>();

  const showToast = useCallback(
    (nextUndo?: UndoState, nextAddedProject?: string) => {
      if (nextAddedProject !== undefined) setAddedProject(nextAddedProject);
      setUndoTask(nextUndo);
      setToastVersion((value) => value + 1);
      setToastOpen(true);
    },
    [],
  );

  const dismissUndo = useCallback(() => {
    setToastOpen(false);
    setUndoTask(undefined);
  }, []);

  const toggleTask = useCallback(
    async (task: Task, completed: boolean, offerUndo = true) => {
      if (writeLock.current || needsCheck || organizationSaving) return false;
      const started = performance.now();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      setCompletion({
        uuid: task.uuid,
        checked: !completed,
        phase: "checking",
      });
      const current = document.getElementById(`complete-${task.uuid}`);
      const hadFocus = document.activeElement === current;
      const checkboxes = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-task-row] [role="checkbox"]',
        ),
      ];
      const index = checkboxes.findIndex((item) => item === current);
      const neighbor = checkboxes[index + 1] || checkboxes[index - 1];
      const keepCompleted =
        completeBehavior === "strikethrough" && !completedView;
      const childTask = isSubtask(task.uuid);

      const saved = await mutateWithOrigin(
        "action",
        { uuid: task.uuid, action: completed ? "reopen" : "complete" },
        undefined,
        async (fresh) => {
          if (reducedMotion || keepCompleted) return;
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.max(0, 320 - (performance.now() - started)),
            ),
          );
          if (!childTask) {
            const staysVisible = fresh.some(
              (item) =>
                item.uuid === task.uuid &&
                (completedView
                  ? item.status === "completed"
                  : item.status !== "completed"),
            );
            if (!staysVisible) {
              setCompletion({
                uuid: task.uuid,
                checked: !completed,
                phase: "leaving",
              });
              await new Promise((resolve) => setTimeout(resolve, 210));
            }
          }
        },
      );

      if (saved) {
        setTasks((prev) =>
          applyCompletionToList(
            prev,
            task.uuid,
            completedView,
            completed,
            childTask,
            keepCompleted,
          ),
        );
      }

      setCompletion(undefined);
      if (saved && offerUndo) {
        showToast({ task, wasCompleted: completed });
      }
      if (saved && !offerUndo) {
        requestAnimationFrame(() => {
          document.getElementById(`complete-${task.uuid}`)?.focus();
        });
      }
      if (
        hadFocus &&
        (document.activeElement === document.body ||
          document.activeElement === current)
      ) {
        requestAnimationFrame(() => {
          const target = saved
            ? document.getElementById(current?.id || "") ||
              document.getElementById(neighbor?.id || "view-title")
            : document.getElementById(current?.id || "view-title");
          if (target instanceof HTMLButtonElement && target.disabled) {
            document.getElementById("view-title")?.focus();
          } else {
            target?.focus();
          }
        });
      }
      return saved;
    },
    [
      writeLock,
      needsCheck,
      organizationSaving,
      isSubtask,
      mutateWithOrigin,
      completedView,
      completeBehavior,
      setTasks,
      showToast,
    ],
  );

  const toggleStartTask = useCallback(
    async (task: Task, forcedAction?: "start" | "stop" | "clear_mark") => {
      if (writeLock.current || needsCheck || loading || organizationSaving) {
        return false;
      }
      const isTimeBackend = organization.timing?.backend === "time";
      const hardEnergyLimit =
        !isTimeBackend && organization.timing?.hardEnergyLimit !== false;
      const hasStart = Boolean(task.start) && task.status !== "completed";
      const isTiming = isTimingTask ? isTimingTask(task.uuid) : hasStart;
      const nextAction =
        forcedAction === "clear_mark"
          ? "stop"
          : (forcedAction ?? (isTiming ? "stop" : "start"));

      if (nextAction === "start" && organization.timing?.available === false) {
        setNotice(
          "计时记录暂不可用，请刷新后再开始任务。已开始的计时仍可正常停止。",
        );
        return false;
      }
      if (
        hardEnergyLimit &&
        nextAction === "start" &&
        energy &&
        energy.remaining !== null &&
        energy.remaining <= 0
      ) {
        setNotice(
          `今日精力已耗尽 (0/${energy.max})。请恢复 +30 精力或休息至 06:00。`,
        );
        return false;
      }
      dismissUndo();
      const saved = await mutateWithOrigin("action", {
        uuid: task.uuid,
        action: nextAction,
      });
      if (saved) {
        if (forcedAction === "clear_mark") {
          showToast({
            task,
            wasCompleted: false,
            message: "已清除进行中标记",
          });
        } else {
          showToast({
            task,
            wasCompleted: false,
            wasStarted: nextAction === "stop",
            message:
              nextAction === "stop"
                ? "已停止计时"
                : hardEnergyLimit
                  ? "已开始计时 (-5 精力)"
                  : "已开始计时",
          });
        }
      }
      return saved;
    },
    [
      writeLock,
      needsCheck,
      loading,
      organizationSaving,
      organization.timing?.available,
      organization.timing?.backend,
      organization.timing?.hardEnergyLimit,
      energy,
      isTimingTask,
      setNotice,
      dismissUndo,
      mutateWithOrigin,
      showToast,
    ],
  );

  const clearStartMark = useCallback(
    (task: Task) => toggleStartTask(task, "clear_mark"),
    [toggleStartTask],
  );

  return {
    toastOpen,
    setToastOpen,
    toastVersion,
    undoTask,
    addedProject,
    completion,
    showToast,
    dismissUndo,
    toggleTask,
    toggleStartTask,
    clearStartMark,
  };
}
