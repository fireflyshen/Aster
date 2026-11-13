import { api, RequestError } from "@/lib/api";
import { taskDate } from "@core/tasks/quick-task";
import { liveEnergySummary } from "@core/workspace/energy";
import { inProject } from "@core/workspace/focus";
import type { Organization, OrganizationChange } from "@core/workspace/organization";
import { remapProject } from "@core/workspace/projects";
import type { Task } from "@shared/tasks";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectionStatusLabel, taskEditPayload } from "../lib/task-view";

type MutateOriginHandler = {
  onSuccess?: (origin?: "editor" | "quick" | "notes") => void;
  onError?: (message: string, origin?: "editor" | "quick" | "notes") => void;
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

  const generation = useRef(0);
  const organizationGeneration = useRef(0);
  const writeLock = useRef(false);
  const previousScope = useRef("");

  const loadOrganization = useCallback(async () => {
    const ticket = ++organizationGeneration.current;
    try {
      const result = await api<Organization>("organization");
      if (ticket !== organizationGeneration.current) return;
      setOrganization(result);
      setOrganizationReady(true);
      setOrganizationError("");
      setOrganizationBlocked(false);
      return result;
    } catch (error) {
      if (ticket === organizationGeneration.current) {
        setOrganizationError((error as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);

  const load = useCallback(
    async (beforeApply?: (fresh: Task[]) => Promise<void>) => {
      const ticket = ++generation.current;
      setLoading(true);
      const layoutChange =
        ["scope=pending", "scope=board"].includes(previousScope.current) &&
        ["scope=pending", "scope=board"].includes(scope);
      if (previousScope.current !== scope && !layoutChange) {
        setTasks([]);
        setLoaded(false);
      }
      try {
        const result = await api<{ tasks: Task[]; projects: string[] }>(
          `tasks?${scope}`,
        );
        if (ticket !== generation.current) return false;
        if (beforeApply) await beforeApply(result.tasks);
        if (ticket !== generation.current) return false;
        setTasks(result.tasks);
        setProjects(result.projects);
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
    [scope],
  );

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && !isModalOpen && !writeLock.current) {
        void load();
        void loadOrganization();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load, loadOrganization, isModalOpen]);

  const hasActiveTask =
    (organization.energy?.activeCount || 0) > 0 ||
    tasks.some((task) => Boolean(task.start) && task.status !== "completed");

  useEffect(() => {
    setNow(new Date());
    if (!hasActiveTask) return;
    const id = window.setInterval(() => {
      // Avoid forcing full re-render while pointer drag animation is running.
      if (!document.querySelector("[data-board-scroll][data-drag-active]")) {
        setNow(new Date());
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [hasActiveTask, organization.energy?.calculatedAt]);

  const energy = liveEnergySummary(organization.energy, now);

  const taskTrackedSeconds = useCallback(
    (task: Task): number | undefined => {
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
    [organization.timing?.available, organization.energy, now],
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
        await api(route, data);
        callbacks?.onSuccess?.(origin);
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
        if (origin) {
          callbacks?.onError?.(message, origin);
        } else {
          setNotice(message);
        }
        return false;
      } finally {
        writeLock.current = false;
        setBusy(false);
      }
    },
    [needsCheck, load, loadOrganization],
  );

  const rescheduleOverdueToToday = useCallback(
    async (overdueTasks: Task[]) => {
      if (writeLock.current || needsCheck || !overdueTasks.length) return;
      writeLock.current = true;
      setBusy(true);
      setNotice("");
      const todayDue = taskDate(new Date());
      try {
        for (const item of overdueTasks) {
          await api("action", {
            uuid: item.uuid,
            action: "edit",
            task: taskEditPayload(item, { due: todayDue }),
          });
        }
        void loadOrganization();
        if (!(await load())) {
          setNotice("已保存，请刷新检查任务状态。");
          setNeedsCheck(true);
        }
      } catch (error) {
        if (error instanceof RequestError && error.uncertain) {
          setNeedsCheck(true);
        }
        setNotice((error as Error).message);
      } finally {
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
    writeLock,
    connectionLabel,
    taskTrackedSeconds,
    load,
    loadOrganization,
    reloadAll,
    mutate,
    changeOrganization,
    rescheduleOverdueToToday,
    restoreEnergy,
  };
}
