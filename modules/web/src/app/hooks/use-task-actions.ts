import { api } from "@/lib/api";
import { taskDate } from "@core/tasks/quick-task";
import {
  defaultBoard,
  inheritSubtaskColumns,
  placeTaskTree,
  taskColumnId,
  UNSECTIONED,
  unsectionedColumn,
  columnTasks,
  type BoardChange,
} from "@core/workspace/board";
import type { EnergySummary } from "@core/workspace/energy";
import type {
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import type { Task, TaskInput, View } from "@shared/tasks";
import {
  useCallback,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
import {
  BLANK_TASK_INPUT,
  formatInitialDue,
  isoDueFromInput,
  taskEditPayload,
  taskToDraft,
  withViewDefaults,
} from "../lib/task-view";

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

type TaskActionsDeps = {
  view: View;
  currentProject: string;
  activeTagName?: string;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  organization: Organization;
  setOrganization: React.Dispatch<React.SetStateAction<Organization>>;
  organizationReady: boolean;
  organizationSaving: boolean;
  organizationBlocked: boolean;
  loading: boolean;
  busy: boolean;
  needsCheck: boolean;
  energy?: EnergySummary;
  writeLock: MutableRefObject<boolean>;
  isSubtask: (uuid: string) => boolean;
  setNotice: (message: string) => void;
  mutate: (
    route: string,
    data: unknown,
    origin?: "editor" | "quick" | "notes",
    beforeApply?: (tasks: Task[]) => Promise<void>,
    callbacks?: {
      onSuccess?: (origin?: "editor" | "quick" | "notes") => void;
      onError?: (
        message: string,
        origin?: "editor" | "quick" | "notes",
      ) => void;
    },
  ) => Promise<boolean>;
  changeOrganization: (change: OrganizationChange) => Promise<boolean>;
  reloadAll: () => Promise<Organization | undefined>;
};

/** Encapsulates task creation, editing, drag moves, completion transitions, and undo toast state. */
export function useTaskActions(deps: TaskActionsDeps) {
  const {
    view,
    currentProject,
    activeTagName,
    tasks,
    setTasks,
    organization,
    setOrganization,
    organizationReady,
    organizationSaving,
    organizationBlocked,
    loading,
    busy,
    needsCheck,
    energy,
    writeLock,
    isSubtask,
    setNotice,
    mutate,
    changeOrganization,
    reloadAll,
  } = deps;

  const [open, setOpen] = useState(false);
  const [seriesUuid, setSeriesUuid] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickProject, setQuickProject] = useState("");
  const [quickError, setQuickError] = useState("");
  const [toastOpen, setToastOpen] = useState(false);
  const [toastVersion, setToastVersion] = useState(0);
  const [undoTask, setUndoTask] = useState<UndoState>();
  const [addedProject, setAddedProject] = useState("");
  const [expandedDrop, setExpandedDrop] = useState<{
    uuid: string;
    version: number;
  }>();
  const [completion, setCompletion] = useState<{
    uuid: string;
    checked: boolean;
    phase: "checking" | "leaving";
  }>();
  const [editing, setEditing] = useState<Task>();
  const [draft, setDraft] = useState<TaskInput>(BLANK_TASK_INPUT);
  const [tags, setTags] = useState("");
  const [due, setDue] = useState("");
  const [formError, setFormError] = useState("");

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

  const mutateWithOrigin = useCallback(
    (
      route: string,
      data: unknown,
      origin?: "editor" | "quick" | "notes",
      beforeApply?: (tasks: Task[]) => Promise<void>,
    ) =>
      mutate(route, data, origin, beforeApply, {
        onSuccess: (src) => {
          if (src === "editor") setOpen(false);
          if (src === "quick") setQuickOpen(false);
        },
        onError: (msg, src) => {
          if (src === "editor" || src === "notes") setFormError(msg);
          else if (src === "quick") setQuickError(msg);
        },
      }),
    [mutate],
  );

  const openQuickAdd = useCallback(() => {
    if (writeLock.current || needsCheck || open) return;
    setQuickProject("");
    setQuickError("");
    setQuickOpen(true);
  }, [writeLock, needsCheck, open]);

  const applyViewDefaults = useCallback(
    <T extends TaskInput>(input: T) =>
      withViewDefaults(input, { currentProject, view, activeTagName }),
    [currentProject, view, activeTagName],
  );

  const openEditor = useCallback(
    (task?: Task, initial?: TaskInput) => {
      if (busy || needsCheck) return;
      setSeriesUuid("");
      setEditing(task);
      setDraft(taskToDraft(task, initial));
      setTags((task?.tags || initial?.tags)?.join(", ") || "");
      setDue(formatInitialDue(task, initial));
      setFormError("");
      setOpen(true);
    },
    [busy, needsCheck],
  );

  const submitTaskForm = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (writeLock.current || needsCheck) return;
      if (!draft.description.trim()) {
        setFormError("请输入任务名称。");
        document.getElementById("description")?.focus();
        return;
      }
      const existing = isoDueFromInput(editing?.due || draft.due);
      const date = due
        ? existing && existing.slice(0, 10) === due
          ? new Date(existing)
          : new Date(`${due}T00:00:00`)
        : undefined;
      const task: TaskInput = {
        ...draft,
        description: draft.description.replace(/[\r\n]+/g, " ").trim(),
        due: date ? taskDate(date) : "",
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      void mutateWithOrigin(
        editing ? "action" : "tasks",
        editing ? { uuid: editing.uuid, action: "edit", task } : task,
        "editor",
      );
    },
    [writeLock, needsCheck, draft, editing, due, tags, mutateWithOrigin],
  );

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
      const childTask = isSubtask(task.uuid);

      const saved = await mutateWithOrigin(
        "action",
        { uuid: task.uuid, action: completed ? "reopen" : "complete" },
        undefined,
        async (fresh) => {
          if (reducedMotion) return;
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
                (view === "completed"
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
          view === "completed"
            ? completed
              ? prev.filter((item) => item.uuid !== task.uuid)
              : prev.map((item) =>
                  item.uuid === task.uuid
                    ? { ...item, status: "completed" }
                    : item,
                )
            : !completed
              ? childTask
                ? prev.map((item) =>
                    item.uuid === task.uuid
                      ? { ...item, status: "completed" }
                      : item,
                  )
                : prev.filter((item) => item.uuid !== task.uuid)
              : prev.map((item) =>
                  item.uuid === task.uuid
                    ? { ...item, status: "pending" }
                    : item,
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
      view,
      setTasks,
      showToast,
    ],
  );

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

  const createTaskInView = useCallback(
    async (
      input: TaskInput & { taskDescription?: string },
      columnId?: string,
      origin?: "quick",
    ) => {
      if (writeLock.current || needsCheck) return false;
      const knownUuids = new Set(tasks.map((item) => item.uuid));
      const prepared = applyViewDefaults(input);
      const saved = await mutateWithOrigin(
        "tasks",
        prepared,
        origin,
        async (fresh) => {
          const created = fresh.find((item) => !knownUuids.has(item.uuid));
          if (created) {
            await persistCreatedMetadata(
              created.uuid,
              input.taskDescription,
              columnId,
            );
          }
        },
      );
      if (saved && origin === "quick") {
        setQuickProject("");
        showToast(undefined, prepared.project || "");
      }
      return Boolean(saved);
    },
    [
      writeLock,
      needsCheck,
      tasks,
      applyViewDefaults,
      mutateWithOrigin,
      persistCreatedMetadata,
      showToast,
    ],
  );

  const createSubtask = useCallback(
    async (parentUuid: string, input: TaskInput) => {
      if (writeLock.current || needsCheck) return false;
      const prepared = applyViewDefaults(input);
      const saved = await mutateWithOrigin("tasks", {
        ...prepared,
        parentUuid,
      });
      return Boolean(saved);
    },
    [writeLock, needsCheck, applyViewDefaults, mutateWithOrigin],
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

  const toggleStartTask = useCallback(
    async (task: Task) => {
      if (writeLock.current || needsCheck || loading || organizationSaving) {
        return false;
      }
      const started = Boolean(task.start) && task.status !== "completed";
      if (!started && organization.timing?.available === false) {
        setNotice(
          "计时记录暂不可用，请刷新后再开始任务。已开始的计时仍可正常停止。",
        );
        return false;
      }
      if (!started && energy && energy.remaining <= 0) {
        setNotice(
          `今日精力已耗尽 (0/${energy.max})。请恢复 +30 精力或休息至 06:00。`,
        );
        return false;
      }
      dismissUndo();
      const saved = await mutateWithOrigin("action", {
        uuid: task.uuid,
        action: started ? "stop" : "start",
      });
      if (saved) {
        showToast({
          task,
          wasCompleted: false,
          wasStarted: started,
          message: started ? "已停止计时" : "已开始计时 (-5 精力)",
        });
      }
      return saved;
    },
    [
      writeLock,
      needsCheck,
      loading,
      organizationSaving,
      organization.timing?.available,
      energy,
      setNotice,
      dismissUndo,
      mutateWithOrigin,
      showToast,
    ],
  );

  const deleteTask = useCallback(
    (task: Task, origin?: "editor") =>
      mutateWithOrigin(
        "action",
        { uuid: task.uuid, action: "delete" },
        origin,
      ).then((saved) => {
        if (saved) {
          showToast({
            task,
            wasCompleted: task.status === "completed",
            wasDeleted: true,
            message: "已删除任务",
          });
        }
        return saved;
      }),
    [mutateWithOrigin, showToast],
  );

  const saveInlineTask = useCallback(
    async (task: Task, nextTask: TaskInput & { taskDescription?: string }) => {
      const saved = await mutateWithOrigin("action", {
        uuid: task.uuid,
        action: "edit",
        task: nextTask,
      });
      if (saved && nextTask.taskDescription !== undefined) {
        try {
          const latest = await api<Organization>("organization", {
            revision: organization.revision,
            kind: "description",
            action: "set",
            uuid: task.uuid,
            description: nextTask.taskDescription,
          });
          setOrganization(latest);
        } catch {
          /* Description syncs on next reload. */
        }
      }
      return Boolean(saved);
    },
    [mutateWithOrigin, organization.revision, setOrganization],
  );

  const patchTaskFields = useCallback(
    (task: Task, overrides: Partial<TaskInput>) =>
      void mutateWithOrigin("action", {
        uuid: task.uuid,
        action: "edit",
        task: taskEditPayload(task, overrides),
      }),
    [mutateWithOrigin],
  );

  const handleToastAction = useCallback(
    (onNavigateToAdded: (project: string) => void) => {
      if (!undoTask) {
        onNavigateToAdded(addedProject);
        return;
      }
      setToastOpen(false);
      if (undoTask.wasDeleted) {
        void mutateWithOrigin("action", {
          uuid: undoTask.task.uuid,
          action: "restore",
        });
      } else if (undoTask.board) {
        void moveTask(
          undoTask.task,
          undoTask.board.columnId,
          undoTask.board.beforeUuid,
          false,
          undoTask.board.parentUuid,
        );
      } else if (undoTask.wasStarted !== undefined) {
        void mutateWithOrigin("action", {
          uuid: undoTask.task.uuid,
          action: undoTask.wasStarted ? "start" : "stop",
        });
      } else {
        void toggleTask(undoTask.task, !undoTask.wasCompleted, false);
      }
    },
    [undoTask, addedProject, mutateWithOrigin, moveTask, toggleTask],
  );

  return {
    open,
    setOpen,
    seriesUuid,
    setSeriesUuid,
    quickOpen,
    setQuickOpen,
    quickProject,
    setQuickProject,
    quickError,
    setQuickError,
    toastOpen,
    setToastOpen,
    toastVersion,
    undoTask,
    addedProject,
    expandedDrop,
    completion,
    editing,
    setEditing,
    draft,
    setDraft,
    tags,
    setTags,
    due,
    setDue,
    formError,
    setFormError,
    dismissUndo,
    mutateWithOrigin,
    openQuickAdd,
    applyViewDefaults,
    openEditor,
    submitTaskForm,
    toggleTask,
    moveTask,
    changeBoard,
    reloadBoard: reloadAll,
    createTaskInView,
    createSubtask,
    unlinkSubtask,
    toggleStartTask,
    deleteTask,
    saveInlineTask,
    patchTaskFields,
    handleToastAction,
  };
}
