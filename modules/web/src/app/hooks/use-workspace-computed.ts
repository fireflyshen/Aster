import type {
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import { projectNames } from "@core/workspace/projects";
import type { Task, View } from "@shared/tasks";
import { useCallback, useEffect, useMemo } from "react";
import {
  computeSubtaskHierarchy,
  computeViewCounts,
  filterVisibleTasks,
} from "../lib/task-view";
import type { ActiveEntry } from "./use-workspace-navigation";

/** Computes active filter/tag item, subtask hierarchy maps, project names, and view badges. */
export function useWorkspaceHierarchy({
  activeEntry,
  organization,
  tasks,
  projects,
}: {
  activeEntry: ActiveEntry | undefined;
  organization: Organization;
  tasks: Task[];
  projects: string[];
}) {
  const activeItem = useMemo(() => {
    if (!activeEntry) return undefined;
    if (activeEntry.kind === "filter") {
      return (
        organization.filters?.find((f) => f.id === activeEntry.item.id) ||
        activeEntry.item
      );
    }
    return (
      organization.tags?.find((t) => t.id === activeEntry.item.id) ||
      activeEntry.item
    );
  }, [activeEntry, organization.filters, organization.tags]);

  const activeTagName =
    activeEntry?.kind === "tag" ? activeItem?.name : undefined;

  const { subtasksMap, taskLinks } = useMemo(
    () => computeSubtaskHierarchy(tasks, organization),
    [tasks, organization],
  );

  const isSubtask = useCallback(
    (uuid: string) => Boolean(taskLinks[uuid]),
    [taskLinks],
  );

  const filterProjects = useMemo(
    () =>
      projectNames([
        ...projects,
        ...(organization.projects || []).map((p) => p.name),
      ]),
    [projects, organization.projects],
  );

  const viewCounts = useMemo(() => computeViewCounts(tasks), [tasks]);

  return {
    activeItem,
    activeTagName,
    subtasksMap,
    taskLinks,
    isSubtask,
    filterProjects,
    viewCounts,
  };
}

/** Computes visible top-level tasks, active parent task, and inline project field saving. */
export function useWorkspaceDerivedState({
  tasks,
  view,
  activeItem,
  activeEntry,
  currentProject,
  organizationPage,
  query,
  completingUuid,
  editing,
  taskLinks,
  organization,
  changeOrganization,
}: {
  tasks: Task[];
  view: View;
  activeItem: ReturnType<typeof useWorkspaceHierarchy>["activeItem"];
  activeEntry: ActiveEntry | undefined;
  currentProject: string;
  organizationPage: boolean;
  query: string;
  completingUuid: string | undefined;
  editing: Task | undefined;
  taskLinks: Record<string, string>;
  organization: Organization;
  changeOrganization: (change: OrganizationChange) => Promise<boolean>;
}) {
  const visibleTasks = useMemo(
    () =>
      filterVisibleTasks({
        tasks,
        view,
        activeItem,
        inbox:
          view === "pending" &&
          !currentProject &&
          !activeEntry &&
          !organizationPage,
        currentProject,
        query,
        completingUuid,
      }),
    [
      tasks,
      view,
      activeItem,
      activeEntry,
      currentProject,
      organizationPage,
      query,
      completingUuid,
    ],
  );

  const topLevelVisible = useMemo(() => {
    const visibleIds = new Set(visibleTasks.map((t) => t.uuid));
    return visibleTasks.filter((t) => {
      const parentUuid = taskLinks[t.uuid];
      return !parentUuid || !visibleIds.has(parentUuid);
    });
  }, [visibleTasks, taskLinks]);

  const editingParent = useMemo(() => {
    if (!editing) return undefined;
    const parentUuid = taskLinks[editing.uuid];
    return parentUuid ? tasks.find((t) => t.uuid === parentUuid) : undefined;
  }, [editing, taskLinks, tasks]);

  const saveProjectField = useCallback(
    (name: string, patch: { outcome?: string; nextTask?: string }) => {
      const existing = (organization.projects || []).find(
        (item) => item.name === name,
      );
      return changeOrganization({
        revision: organization.revision,
        kind: "project",
        action: "save",
        item: {
          description: "",
          ...(existing || {}),
          name,
          ...patch,
        },
      });
    },
    [organization.projects, organization.revision, changeOrganization],
  );

  return {
    visibleTasks,
    topLevelVisible,
    editingParent,
    saveProjectField,
  };
}

/** Keeps navigation's modal-open flag synced so background polling pauses while editing dialogs are open. */
export function useModalOpenSync(
  openFlags: boolean[],
  setSubModalOpen: (open: boolean) => void,
) {
  const anyOpen = openFlags.some(Boolean);
  useEffect(() => {
    setSubModalOpen(anyOpen);
  }, [anyOpen, setSubModalOpen]);
}
