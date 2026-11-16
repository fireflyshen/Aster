import { api, RequestError } from "@/lib/api";
import type { DoingLimitCandidate } from "@/features/tasks/state-dialogs";
import type { TaskState } from "@core/tasks/state";
import type { Task } from "@shared/tasks";
import { useCallback, useEffect, useState, type MutableRefObject } from "react";

export interface StateSummaryTaskItem {
  uuid: string;
  description: string;
  project?: string;
  due?: string;
  scheduled?: string;
  wait?: string;
  waitReason?: string;
  priority?: string;
  urgency: number;
  start?: string;
  depends: string[];
  blocked: boolean;
}

export interface StateAnomalyItem {
  uuid: string;
  description: string;
  project?: string;
  type: "missing_state" | "doing_over_limit";
  detail: string;
}

export interface StateSummaryData {
  limit: number;
  doing: StateSummaryTaskItem[];
  counts: Record<TaskState, number>;
  upcoming: Array<{ uuid: string; description: string; scheduled: string }>;
  waitingDue: StateSummaryTaskItem[];
  parkedReviewDue: StateSummaryTaskItem[];
  promotionBlocked: StateSummaryTaskItem[];
  anomalies: StateAnomalyItem[];
}

export interface StateHistoryEntryItem {
  at: string;
  uuid: string;
  from: string | null;
  to: string;
  source: string;
  actor?: string;
  reason?: string;
  waitReason?: string;
  checkDate?: string;
}

type DoingLimitPrompt = {
  targetDescription?: string;
  limit?: number;
  doing: DoingLimitCandidate[];
  retry: (replaceUuid: string) => Promise<void>;
};

/** Orchestrates Web task state transitions, waiting/doing-limit dialogs, and `/api/state/summary` polling. */
export function useTaskStateActions(deps: {
  tasks: Task[];
  writeLock: MutableRefObject<boolean>;
  needsCheck: boolean;
  setNotice: (message: string) => void;
  reloadAll: () => Promise<unknown>;
}) {
  const { writeLock, needsCheck, setNotice, reloadAll } = deps;
  const [summary, setSummary] = useState<StateSummaryData | null>(null);
  const [waitingTask, setWaitingTask] = useState<Task | null>(null);
  const [doingLimitPrompt, setDoingLimitPrompt] =
    useState<DoingLimitPrompt | null>(null);
  const [stateBusy, setStateBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const refreshSummary = useCallback(async () => {
    try {
      const next = await api<StateSummaryData>("state/summary");
      setSummary(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary, deps.tasks.length]);

  const executeStateSet = useCallback(
    async (
      payload: {
        uuid: string;
        state: TaskState;
        waitReason?: string;
        checkDate?: string;
        scheduled?: string;
        replaceUuid?: string;
      },
      targetDescription?: string,
    ): Promise<boolean> => {
      if (writeLock.current || needsCheck) return false;
      setStateBusy(true);
      setDialogError("");
      setNotice("");
      try {
        await api("action", { action: "state.set", ...payload });
        await Promise.all([reloadAll(), refreshSummary()]);
        return true;
      } catch (error) {
        if (
          error instanceof RequestError &&
          error.code === "STATE_DOING_LIMIT" &&
          Array.isArray(error.details?.doing)
        ) {
          const candidates = error.details.doing as DoingLimitCandidate[];
          const limit =
            typeof error.details.limit === "number"
              ? error.details.limit
              : undefined;
          setDoingLimitPrompt({
            targetDescription,
            limit,
            doing: candidates,
            retry: async (replaceUuid: string) => {
              await api("action", {
                action: "state.set",
                ...payload,
                replaceUuid,
              });
              await Promise.all([reloadAll(), refreshSummary()]);
            },
          });
          return false;
        }
        const msg =
          error instanceof Error ? error.message : "状态修改失败，请重试。";
        if (waitingTask) setDialogError(msg);
        else setNotice(msg);
        return false;
      } finally {
        setStateBusy(false);
      }
    },
    [writeLock, needsCheck, setNotice, reloadAll, refreshSummary, waitingTask],
  );

  const changeTaskState = useCallback(
    async (task: Task, targetState: TaskState): Promise<boolean> => {
      if (targetState === "waiting") {
        setDialogError("");
        setWaitingTask(task);
        return false;
      }
      return executeStateSet(
        { uuid: task.uuid, state: targetState },
        task.description,
      );
    },
    [executeStateSet],
  );

  const submitWaiting = useCallback(
    async (waitReason: string, checkDate: string) => {
      if (!waitingTask) return;
      const ok = await executeStateSet(
        {
          uuid: waitingTask.uuid,
          state: "waiting",
          waitReason,
          checkDate,
        },
        waitingTask.description,
      );
      if (ok) {
        setWaitingTask(null);
      }
    },
    [waitingTask, executeStateSet],
  );

  const scheduleTask = useCallback(
    async (task: Task, scheduled: string): Promise<boolean> => {
      if (writeLock.current || needsCheck) return false;
      setStateBusy(true);
      setNotice("");
      try {
        await api("action", {
          action: "schedule",
          uuid: task.uuid,
          scheduled,
        });
        await Promise.all([reloadAll(), refreshSummary()]);
        return true;
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "设置日期失败，请重试。",
        );
        return false;
      } finally {
        setStateBusy(false);
      }
    },
    [writeLock, needsCheck, setNotice, reloadAll, refreshSummary],
  );

  const openDoingLimitReplace = useCallback(
    (
      targetDescription: string,
      doing: DoingLimitCandidate[],
      retry: (replaceUuid: string) => Promise<void>,
      limit?: number,
    ) => {
      setDialogError("");
      setDoingLimitPrompt({ targetDescription, limit, doing, retry });
    },
    [],
  );

  const confirmDoingLimitReplace = useCallback(
    async (replaceUuid: string) => {
      if (!doingLimitPrompt) return;
      setStateBusy(true);
      setDialogError("");
      try {
        await doingLimitPrompt.retry(replaceUuid);
        setDoingLimitPrompt(null);
      } catch (error) {
        setDialogError(
          error instanceof Error ? error.message : "替换失败，请重试。",
        );
      } finally {
        setStateBusy(false);
      }
    },
    [doingLimitPrompt],
  );

  return {
    summary,
    refreshSummary,
    stateBusy,
    dialogError,
    waitingTask,
    closeWaiting: () => {
      setWaitingTask(null);
      setDialogError("");
    },
    submitWaiting,
    doingLimitPrompt,
    closeDoingLimit: () => {
      setDoingLimitPrompt(null);
      setDialogError("");
    },
    openDoingLimitReplace,
    confirmDoingLimitReplace,
    changeTaskState,
    scheduleTask,
  };
}
