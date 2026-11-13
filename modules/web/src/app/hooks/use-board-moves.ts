import { api } from "@/lib/api";
import {
  columnTasks,
  defaultBoard,
  inheritSubtaskColumns,
  placeTaskTree,
  taskColumnId,
  UNSECTIONED,
  unsectionedColumn,
  type BoardChange,
} from "@core/workspace/board";
import type {
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { useCallback, useState, type MutableRefObject } from "react";
import type { UndoState } from "./use-task-completion";

type BoardMovesDeps = {
  tasks: Task[];
  organization: Organization;
  setOrganization: React.Dispatch<React.SetStateAction<Organization>>;
  organizationReady: boolean;
  organizationBlocked: boolean;
  loading: boolean;
  needsCheck: boolean;
  writeLock: MutableRefObject<boolean>;
  changeOrganization: (change: OrganizationChange) => Promise<boolean>;
  dismissUndo: () => void;
  showToast: (nextUndo?: UndoState, nextAddedProject?: string) => void;
};

/** Encapsulates optimistic board reordering, subtask reparenting, and initial placement sync. */
export function useBoardMoves(deps: BoardMovesDeps) {
  const {
    tasks,
    organization,
    setOrganization,
    organizationReady,
    organizationBlocked,
    loading,
    needsCheck,
    writeLock,
    changeOrganization,
    dismissUndo,
    showToast,
  } = deps;

  const [expandedDrop, setExpandedDrop] = useState<{
    uuid: string;
    version: number;
  }>();

  const moveTask = useCallback(
    async (
      task: Task,
      columnId: string,
      beforeUuid: string | null = null,
      offerUndo = true,
      parentUuid: string | null | undefined = undefined,
    ) => {
      if (
        writeLock.current ||
        needsCheck ||
        loading ||
        organizationBlocked ||
        !organizationReady
      ) {
        return false;
      }
      const board = inheritSubtaskColumns(
        organization.board || defaultBoard(),
        tasks,
        organization.subtasks || {},
      );
      const target =
        columnId === UNSECTIONED
          ? unsectionedColumn
          : board.columns.find((column) => column.id === columnId);
      if (!target) return false;
      const source = taskColumnId(task, board);
      const oldParent = organization.subtasks?.[task.uuid] || null;
      const nextParent = parentUuid === undefined ? oldParent : parentUuid;
      const items = columnTasks(tasks, board, source).filter(
        (item) => (organization.subtasks?.[item.uuid] || null) === oldParent,
      );
      const index = items.findIndex((item) => item.uuid === task.uuid);
      const next = items[index + 1]?.uuid || null;
      if (
        source === columnId &&
        oldParent === nextParent &&
        (beforeUuid === next || beforeUuid === task.uuid)
      ) {
        return true;
      }

      dismissUndo();
      const previous = organization;
      const links = { ...organization.subtasks };
      if (nextParent) links[task.uuid] = nextParent;
      else delete links[task.uuid];

      setOrganization({
        ...organization,
        subtasks: links,
        board: placeTaskTree(
          board,
          tasks,
          links,
          task.uuid,
          columnId,
          beforeUuid,
        ),
      });
      if (nextParent) {
        setExpandedDrop({ uuid: nextParent, version: performance.now() });
      }
      try {
        const saved = await changeOrganization({
          kind: "board",
          action: "task.move",
          revision: organization.revision,
          uuid: task.uuid,
          columnId,
          beforeUuid,
          parentUuid,
        });
        if (!saved) setOrganization(previous);
        if (saved && offerUndo) {
          showToast({
            task,
            wasCompleted: task.status === "completed",
            message: `任务已移至「${target.id === UNSECTIONED ? "未分区" : target.name}」`,
            board: {
              columnId: source,
              beforeUuid: next,
              parentUuid: oldParent,
            },
          });
        }
        return saved;
      } catch {
        setOrganization(previous);
        return false;
      }
    },
    [
      writeLock,
      needsCheck,
      loading,
      organizationBlocked,
      organizationReady,
      organization,
      tasks,
      dismissUndo,
      setOrganization,
      changeOrganization,
      showToast,
    ],
  );

  const changeBoard = useCallback(
    (change: BoardChange) => {
      dismissUndo();
      return changeOrganization(change);
    },
    [dismissUndo, changeOrganization],
  );

  const persistCreatedMetadata = useCallback(
    async (
      createdUuid: string,
      taskDescription?: string,
      columnId?: string,
    ) => {
      let rev = organization.revision;
      if (taskDescription?.trim()) {
        try {
          const latest = await api<Organization>("organization", {
            revision: rev,
            kind: "description",
            action: "set",
            uuid: createdUuid,
            description: taskDescription.trim(),
          });
          setOrganization(latest);
          rev = latest.revision;
        } catch {
          /* Task saved; description syncs on reload. */
        }
      }
      if (columnId && columnId !== UNSECTIONED) {
        try {
          const latest = await api<Organization>("organization", {
            kind: "board",
            action: "task.move",
            revision: rev,
            uuid: createdUuid,
            columnId,
            beforeUuid: null,
          });
          setOrganization(latest);
        } catch {
          /* Task saved; column placement syncs on reload. */
        }
      }
    },
    [organization.revision, setOrganization],
  );

  const unlinkSubtask = useCallback(
    (childUuid: string) =>
      changeOrganization({
        revision: organization.revision,
        kind: "subtask",
        action: "unlink",
        childUuid,
      }),
    [changeOrganization, organization.revision],
  );

  return {
    expandedDrop,
    moveTask,
    changeBoard,
    persistCreatedMetadata,
    unlinkSubtask,
  };
}
