import { api, RequestError } from "@/lib/api";
import { isTaskOverdue, rescheduledTaskDue } from "@/features/tasks/task-date";
import type { TaskCostSummary, TimerSnapshot } from "@core/time/model";
import {
  displayedActiveActivitySeconds,
  displayedTaskCostFromSnapshot,
  displayedTaskSecondsFromSnapshot,
  mergeTimerSnapshot,
  snapshotLiveStatus,
  type TrackedTimerSnapshot,
} from "@core/time/snapshot";
import { liveEnergySummary } from "@core/workspace/energy";
import { inProject } from "@core/workspace/focus";
import type {
  Organization,
  OrganizationChange,
  WorkspacePreferences,
} from "@core/workspace/organization";
import { remapProject } from "@core/workspace/projects";
import type { Task } from "@shared/tasks";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectionStatusLabel, taskEditPayload } from "../lib/task-view";

type MutateOriginHandler = {
  onSuccess?: (
    origin?: "editor" | "quick" | "notes",
    response?: unknown,
  ) => void;
  onError?: (message: string, origin?: "editor" | "quick" | "notes") => void;
  onDoingLimit?: (error: unknown) => boolean;
};

/** Manages server synchronization for tasks, organization state, board persistence, and daily energy. */
export function useWorkspaceData({
  scope,
  isModalOpen,
  onProjectRemap,
}: {
  scope: string;
  isModalOpen: boolean;
  onProjectRemap: (updater: (current: string) => string) => void;
}) {
  const [organization, setOrganization] = useState<Organization>({
    revision: 0,
    filters: [],
    tags: [],
  });
  const [organizationError, setOrganizationError] = useState("");
  const [organizationReady, setOrganizationReady] = useState(false);
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [organizationBlocked, setOrganizationBlocked] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [monoNow, setMonoNow] = useState(() => performance.now());
  const [trackedSnapshot, setTrackedSnapshot] =
    useState<TrackedTimerSnapshot | null>(null);

  const generation = useRef(0);
  const organizationGeneration = useRef(0);
  const snapshotGeneration = useRef(0);
  const writeLock = useRef(false);
  const previousScope = useRef("");

  const applyTimerSnapshot = useCallback((incoming?: TimerSnapshot) => {
    if (!incoming) return;
    const receivedMonoMs = performance.now();
    setTrackedSnapshot((prev) =>
      mergeTimerSnapshot(prev, incoming, receivedMonoMs),
    );
    setMonoNow(receivedMonoMs);
  }, []);

  const loadOrganization = useCallback(async () => {
    const ticket = ++organizationGeneration.current;
    try {
      const result = await api<Organization>("organization");
      if (ticket !== organizationGeneration.current) return;
      setOrganization(result);
      applyTimerSnapshot(result.timerSnapshot);
      setOrganizationReady(true);
      setOrganizationError("");
      setOrganizationBlocked(false);
      return result;
    } catch (error) {
      if (ticket === organizationGeneration.current) {
        setOrganizationError((error as Error).message);
      }
    }
  }, [applyTimerSnapshot]);

  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);

  const load = useCallback(
    async (beforeApply?: (fresh: Task[]) => Promise<void>) => {
      const ticket = ++generation.current;
      setLoading(true);
      const layoutChange =
        ["scope=pending", "scope=board", "scope=all"].includes(
          previousScope.current,
        ) && ["scope=pending", "scope=board", "scope=all"].includes(scope);
      if (previousScope.current !== scope && !layoutChange) {
        setTasks([]);
        setLoaded(false);
      }
      try {
        const result = await api<{
          tasks: Task[];
          projects: string[];
          timerSnapshot?: TimerSnapshot;
        }>(`tasks?${scope}`);
        if (ticket !== generation.current) return false;
        if (beforeApply) await beforeApply(result.tasks);
        if (ticket !== generation.current) return false;
        setTasks(result.tasks);
        setProjects(result.projects);
        applyTimerSnapshot(result.timerSnapshot);
        setLoaded(true);
        setConnectionError(false);
        setNeedsCheck(false);
        setNotice("");
        previousScope.current = scope;
        return true;
      } catch (error) {
        if (ticket === generation.current) {
          setConnectionError(true);
          setNotice((error as Error).message);
        }
        return false;
      } finally {
        if (ticket === generation.current) setLoading(false);
      }
    },
    [scope, applyTimerSnapshot],
  );

  const isTimeMode =
    organization.timing?.backend === "time" ||
    trackedSnapshot?.snapshot.backend === "time";

  const refreshTimerSnapshot = useCallback(async () => {
    if (!isTimeMode) return;
    const ticket = ++snapshotGeneration.current;
    const prioritizedUuids = [
      ...tasks.filter((t) => t.status !== "completed").map((t) => t.uuid),
      ...tasks.filter((t) => t.status === "completed").map((t) => t.uuid),
    ].slice(0, 200);
    const qs =
      prioritizedUuids.length > 0
        ? `?uuids=${encodeURIComponent(prioritizedUuids.join(","))}`
        : "";
    try {
      const snap = await api<TimerSnapshot>(`time/snapshot${qs}`);
      if (ticket !== snapshotGeneration.current) return;
      applyTimerSnapshot(snap);
      setConnectionError(false);
    } catch {
      // Offline / transient failures keep existing snapshot and stop extrapolating at liveUntil.
      setMonoNow(performance.now());
    }
  }, [isTimeMode, tasks, applyTimerSnapshot]);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      setMonoNow(performance.now());
      if (!document.hidden && !isModalOpen && !writeLock.current) {
        if (isTimeMode) void refreshTimerSnapshot();
        void load();
        void loadOrganization();
      }
    };
    const onOffline = () => {
      setMonoNow(performance.now());
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", onOffline);
    };
  }, [load, loadOrganization, refreshTimerSnapshot, isModalOpen, isTimeMode]);

  const timerLiveStatus = isTimeMode
    ? snapshotLiveStatus(trackedSnapshot, monoNow)
    : undefined;

  const hasActiveTask = isTimeMode
    ? Boolean(timerLiveStatus?.canTick)
    : (organization.energy?.activeCount || 0) > 0 ||
      tasks.some((task) => Boolean(task.start) && task.status !== "completed");

  useEffect(() => {
    setNow(new Date());
    setMonoNow(performance.now());
    if (isTimeMode) {
      if (!timerLiveStatus?.canTick) return;
      const tickId = window.setInterval(() => {
        if (!document.querySelector("[data-board-scroll][data-drag-active]")) {
          setMonoNow(performance.now());
          setNow(new Date());
        }
      }, 1_000);
      return () => window.clearInterval(tickId);
    }
    if (!hasActiveTask) return;
    const id = window.setInterval(() => {
      // Avoid forcing full re-render while pointer drag animation is running.
      if (!document.querySelector("[data-board-scroll][data-drag-active]")) {
        setNow(new Date());
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [
    isTimeMode,
    timerLiveStatus?.canTick,
    hasActiveTask,
    organization.energy?.calculatedAt,
  ]);

  useEffect(() => {
    if (!isTimeMode || !loaded) return;
    const id = window.setInterval(() => {
      if (
        !document.hidden &&
        !isModalOpen &&
        !writeLock.current &&
        navigator.onLine !== false
      ) {
        void refreshTimerSnapshot();
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [isTimeMode, loaded, isModalOpen, refreshTimerSnapshot]);

  const energy = liveEnergySummary(
    organization.energy,
    isTimeMode && trackedSnapshot && !timerLiveStatus?.canTick
      ? organization.energy?.calculatedAt
        ? new Date(organization.energy.calculatedAt)
        : now
      : now,
  );

  const isTimingTask = useCallback(
    (taskUuid: string): boolean => {
      if (!isTimeMode) {
        return tasks.some(
          (t) =>
            t.uuid.toLowerCase() === taskUuid.toLowerCase() &&
            Boolean(t.start) &&
            t.status !== "completed",
        );
      }
      const activeUuid = trackedSnapshot?.snapshot.activeActivity?.taskUuid;
      return Boolean(
        activeUuid && activeUuid.toLowerCase() === taskUuid.toLowerCase(),
      );
    },
    [isTimeMode, tasks, trackedSnapshot],
  );

  const taskTrackedSeconds = useCallback(
    (task: Task): number | undefined => {
      if (isTimeMode) {
        if (organization.timing?.available === false) return undefined;
        return displayedTaskSecondsFromSnapshot(
          trackedSnapshot,
          task.uuid,
          monoNow,
        );
      }
      if (organization.timing?.available === false) return undefined;
      const key = task.uuid.toLowerCase();
      const base = organization.energy?.taskSeconds?.[key] ?? 0;
      if (!task.start || task.status === "completed") return base;
      const calculatedAt = organization.energy?.calculatedAt
        ? new Date(organization.energy.calculatedAt).getTime()
        : Number.NaN;
      if (!Number.isNaN(calculatedAt) && now.getTime() > calculatedAt) {
        return base + Math.floor((now.getTime() - calculatedAt) / 1000);
      }
      return base;
    },
    [
      isTimeMode,
      trackedSnapshot,
      monoNow,
      organization.timing?.available,
      organization.energy,
      now,
    ],
  );

  const activeActivitySeconds = isTimeMode
    ? displayedActiveActivitySeconds(trackedSnapshot, monoNow)
    : undefined;

  const taskCostSummary = useCallback(
    (task: Task): TaskCostSummary | undefined => {
      if (!isTimeMode || organization.timing?.available === false) {
        return undefined;
      }
      return displayedTaskCostFromSnapshot(trackedSnapshot, task.uuid, monoNow);
    },
    [isTimeMode, organization.timing?.available, trackedSnapshot, monoNow],
  );

  const changeOrganization = useCallback(
    async (change: OrganizationChange) => {
      if (writeLock.current || organizationBlocked || needsCheck) return false;
      writeLock.current = true;
      const isBackgroundBoardMove =
        (change.kind === "board" && change.action === "task.move") ||
        (change.kind === "subtask" && change.action === "unlink");
      if (!isBackgroundBoardMove) {
        setOrganizationSaving(true);
      }
      setOrganizationError("");
      organizationGeneration.current++;
      try {
        const result = await api<Organization>("organization", change);
        setOrganization(result);
        applyTimerSnapshot(result.timerSnapshot);
        if (change.kind === "project" && change.action !== "status") {
          const original = change.originalName || change.item.name;
          onProjectRemap((name) =>
            inProject(name, original)
              ? change.action === "delete"
                ? ""
                : remapProject(name, original, change.item.name)
              : name,
          );
        }
        if (
          change.kind !== "board" &&
          change.kind !== "energy" &&
          change.kind !== "description" &&
          change.kind !== "preferences" &&
          !(await load())
        ) {
          setNeedsCheck(true);
          setNotice("已保存，请刷新检查任务状态。");
        }
        return true;
      } catch (error) {
        setOrganizationError((error as Error).message);
        if (error instanceof RequestError && error.uncertain) {
          setOrganizationBlocked(true);
          setNeedsCheck(true);
        }
        return false;
      } finally {
        writeLock.current = false;
        if (!isBackgroundBoardMove) {
          setOrganizationSaving(false);
        }
      }
    },
    [organizationBlocked, needsCheck, onProjectRemap, load],
  );

  const mutate = useCallback(
    async (
      route: string,
      data: unknown,
      origin?: "editor" | "quick" | "notes",
      beforeApply?: (tasks: Task[]) => Promise<void>,
      callbacks?: MutateOriginHandler,
    ) => {
      if (writeLock.current || needsCheck) return false;
      writeLock.current = true;
      setBusy(true);
      setNotice("");
      try {
        const result = await api(route, data);
        callbacks?.onSuccess?.(origin, result);
        void loadOrganization();
        if (!(await load(beforeApply))) {
          setNotice("已保存，请刷新检查任务状态。");
          setNeedsCheck(true);
        }
        return true;
      } catch (error) {
        const message = (error as Error).message;
        if (error instanceof RequestError && error.uncertain) {
          setNeedsCheck(true);
          setNotice(message);
        }
        const handled = callbacks?.onDoingLimit?.(error);
        if (!handled) {
          if (origin) {
            callbacks?.onError?.(message, origin);
          } else {
            setNotice(message);
          }
        }
        return false;
      } finally {
        writeLock.current = false;
        setBusy(false);
      }
    },
    [needsCheck, load, loadOrganization],
  );

  const rescheduleOverdue = useCallback(
    async (overdueTasks: Task[], day: string) => {
      if (writeLock.current || needsCheck) return;
      const unique = [
        ...new Map(
          overdueTasks
            .filter(
              (task) =>
                ["pending", "waiting"].includes(task.status) &&
                isTaskOverdue(task),
            )
            .map((task) => [task.uuid, task]),
        ).values(),
      ];
      if (!unique.length) return;
      const edits = unique.map((item) => ({
        item,
        due: rescheduledTaskDue(item.due, day),
      }));
      writeLock.current = true;
      setBusy(true);
      setNotice("");
      let saved = 0;
      let failure = "";
      let uncertain = false;
      try {
        for (const { item, due } of edits) {
          await api("action", {
            uuid: item.uuid,
            action: "edit",
            task: taskEditPayload(item, { due }),
          });
          saved++;
        }
      } catch (error) {
        uncertain = error instanceof RequestError && error.uncertain;
        failure = `${saved ? `已调整 ${saved}/${edits.length} 项；` : ""}${(error as Error).message}`;
      } finally {
        if (saved) {
          void loadOrganization();
          if (!(await load())) {
            failure = `${failure ? `${failure} ` : "已保存。"}请刷新检查任务状态。`;
            uncertain = true;
          }
        }
        if (failure) setNotice(failure);
        if (uncertain) setNeedsCheck(true);
        writeLock.current = false;
        setBusy(false);
      }
    },
    [needsCheck, load, loadOrganization],
  );

  const restoreEnergy = useCallback(() => {
    setNotice("");
    return changeOrganization({
      revision: organization.revision,
      kind: "energy",
      action: "elixir",
    });
  }, [changeOrganization, organization.revision]);

  const prefsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const updatePreferences = useCallback((patch: WorkspacePreferences) => {
    setOrganization((prev) => ({
      ...prev,
      preferences: {
        ...(prev.preferences || {}),
        ...patch,
      },
    }));
    const next = prefsQueue.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await api<WorkspacePreferences>("preferences", patch);
        setOrganization((prev) => ({
          ...prev,
          preferences: saved,
        }));
      });
    prefsQueue.current = next;
    return next;
  }, []);

  const reloadAll = useCallback(async () => {
    const result = await loadOrganization();
    if (result) await load();
    return result;
  }, [loadOrganization, load]);

  const connectionLabel = connectionStatusLabel({
    loading,
    needsCheck,
    connectionError,
    loaded,
  });

  return {
    organization,
    setOrganization,
    organizationError,
    setOrganizationError,
    organizationReady,
    organizationSaving,
    setOrganizationSaving,
    organizationBlocked,
    organizationGeneration,
    tasks,
    setTasks,
    projects,
    loading,
    loaded,
    busy,
    needsCheck,
    setNeedsCheck,
    notice,
    setNotice,
    now,
    energy,
    isTimeMode,
    timerSnapshot: trackedSnapshot?.snapshot,
    timerLiveStatus,
    activeActivitySeconds,
    isTimingTask,
    refreshTimerSnapshot,
    writeLock,
    connectionLabel,
    taskTrackedSeconds,
    taskCostSummary,
    hourlyRateCents: trackedSnapshot?.snapshot.hourlyRateCents ?? 10_000,
    taskListHighlightCost:
      trackedSnapshot?.snapshot.taskListHighlightCost ?? true,
    load,
    loadOrganization,
    reloadAll,
    mutate,
    changeOrganization,
    updatePreferences,
    rescheduleOverdue,
    restoreEnergy,
  };
}
