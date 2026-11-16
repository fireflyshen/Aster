import type { HabitTaskActions } from "@/features/habits/habit-task-controls";
import {
  buildBindInputFromDraft,
  currentLocalTodayDate,
  type TaskHabitDraft,
} from "@/features/habits/task-habit-field";
import { QuickAdd } from "@/features/tasks/quick-add";
import { SeriesEditor } from "@/features/tasks/series-editor";
import { TaskEditor } from "@/features/tasks/task-editor";
import { TaskForm } from "@/features/tasks/task-form";
import { TaskToast } from "@/features/tasks/task-toast";
import { useEditorGuard } from "@/features/tasks/use-editor-guard";
import type { BindTaskHabitInput, HabitListItem } from "@core/habits/model";
import { effectiveState, type TaskState } from "@core/tasks/state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TaskCostSummary } from "@core/time/model";
import type {
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import type { FormEvent, MutableRefObject } from "react";
import type { UndoState } from "../hooks/use-task-actions";
import { taskEditPayload } from "../lib/task-view";

export type TaskWorkspaceDialogsProps = {
  currentProject: string;
  organization: Organization;
  organizationSaving: boolean;
  organizationError: string;
  organizationBlocked: boolean;
  filterProjects: string[];
  busy: boolean;
  loading: boolean;
  needsCheck: boolean;
  notice: string;
  writeLock: MutableRefObject<boolean>;
  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  quickProject: string;
  setQuickProject: (value: string) => void;
  quickError: string;
  setQuickError: (value: string) => void;
  toastOpen: boolean;
  setToastOpen: (open: boolean) => void;
  toastVersion: number;
  undoTask?: UndoState;
  addedProject: string;
  onToastAction: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  seriesUuid: string;
  setSeriesUuid: (uuid: string) => void;
  editing?: Task;
  setEditing: (task: Task | undefined) => void;
  editingParent?: Task;
  subtasksMap: Map<string, Task[]>;
  draft: TaskInput & {
    taskDescription?: string;
    habitPreset?: boolean;
    habitDraft?: TaskHabitDraft;
  };
  setDraft: (draft: TaskInput) => void;
  due: string;
  setDue: (due: string) => void;
  tags: string;
  setTags: (tags: string) => void;
  formError: string;
  setFormError: (err: string) => void;
  onOpenEditor: (
    task?: Task,
    initial?: TaskInput & {
      taskDescription?: string;
      habitPreset?: boolean;
      habitDraft?: TaskHabitDraft;
    },
  ) => void;
  applyViewDefaults: <T extends TaskInput>(input: T) => T;
  onCreateTaskInView: (
    input: TaskInput & { taskDescription?: string },
    columnId?: string,
    origin?: "quick",
    onCreated?: (createdUuid: string) => Promise<void> | void,
  ) => Promise<boolean>;
  habitByTaskUuid?: Map<string, HabitListItem>;
  habitTodayDate?: string;
  habitActions?: HabitTaskActions;
  onBindTaskHabit?: (input: BindTaskHabitInput) => Promise<unknown>;
  onUnbindTaskHabit?: (taskUuid: string) => Promise<unknown>;
  onCreateSubtask: (parentUuid: string, input: TaskInput) => Promise<boolean>;
  onToggleTask: (task: Task, completed: boolean) => Promise<boolean>;
  onToggleStart?: (task: Task) => Promise<boolean>;
  onClearStartMark?: (task: Task) => Promise<boolean>;
  isTimingTask?: (uuid: string) => boolean;
  onUnlinkSubtask: (childUuid: string) => Promise<boolean>;
  onDeleteTask: (task: Task, origin?: "editor") => Promise<boolean>;
  onSubmitTaskForm: (
    event: FormEvent,
    keepOpen?: boolean,
    taskDescription?: string,
    onCreatedOrUpdated?: (taskUuid?: string) => Promise<void> | void,
  ) => void;
  isTimeMode?: boolean;
  hourlyRateCents?: number;
  taskCostSummary?: (task: Task) => TaskCostSummary | undefined;
  onRefreshTimeSnapshot?: () => Promise<unknown>;
  onMutate: (
    route: string,
    data: unknown,
    origin?: "editor" | "quick" | "notes",
  ) => Promise<boolean>;
  onSetOrganization: React.Dispatch<React.SetStateAction<Organization>>;
  onChangeOrganization: (change: OrganizationChange) => Promise<boolean>;
  onReloadAll: () => Promise<Organization | undefined>;
  onChangeState?: (
    task: Task,
    state: TaskState,
  ) => Promise<boolean> | boolean | void;
};

/** Renders quick-add, toast undo, full task detail editor, and recurring series dialogs. */
export function TaskWorkspaceDialogs(props: TaskWorkspaceDialogsProps) {
  const {
    currentProject,
    organization,
    organizationSaving,
    organizationError,
    organizationBlocked,
    filterProjects,
    busy,
    loading,
    needsCheck,
    notice,
    writeLock,
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
    onToastAction,
    open,
    setOpen,
    seriesUuid,
    setSeriesUuid,
    editing,
    setEditing,
    editingParent,
    subtasksMap,
    draft,
    setDraft,
    due,
    setDue,
    tags,
    setTags,
    formError,
    setFormError,
    onOpenEditor,
    applyViewDefaults,
    onCreateTaskInView,
    onCreateSubtask,
    onToggleTask,
    onToggleStart,
    onClearStartMark,
    isTimingTask,
    onUnlinkSubtask,
    onDeleteTask,
    onSubmitTaskForm,
    onMutate,
    onChangeOrganization,
    onReloadAll,
    isTimeMode = false,
    hourlyRateCents = 10_000,
    taskCostSummary,
    onRefreshTimeSnapshot,
    habitByTaskUuid,
    habitTodayDate,
    habitActions,
    onBindTaskHabit,
    onUnbindTaskHabit,
    onChangeState,
  } = props;

  const editorBusy = busy || organizationSaving;
  const guard = useEditorGuard(open, editorBusy);
  const closeEditor = () =>
    guard.requestLeave(() => {
      setOpen(false);
      setSeriesUuid("");
    });

  return (
    <>
      <QuickAdd
        open={quickOpen}
        projects={filterProjects}
        availableLabels={organization.tags}
        defaultProject={quickProject || currentProject}
        busy={busy}
        blocked={needsCheck}
        error={quickError}
        onClearError={() => setQuickError("")}
        onCheck={() => {
          setQuickOpen(false);
          setQuickProject("");
        }}
        onOpenChange={(value) => {
          if (!writeLock.current) {
            setQuickOpen(value);
            if (!value) setQuickProject("");
          }
        }}
        onAdd={(task, habitDraft) =>
          onCreateTaskInView(
            task,
            undefined,
            "quick",
            habitDraft?.enabled && onBindTaskHabit
              ? async (createdUuid) => {
                  await onBindTaskHabit(
                    buildBindInputFromDraft(
                      createdUuid,
                      habitDraft,
                      habitTodayDate || currentLocalTodayDate(),
                    ),
                  );
                }
              : undefined,
          )
        }
        onEdit={(task) => {
          setQuickOpen(false);
          setQuickProject("");
          onOpenEditor(undefined, applyViewDefaults(task));
        }}
      />

      <TaskToast
        key={toastVersion}
        open={toastOpen}
        onOpenChange={setToastOpen}
        message={
          undoTask ? (
            undoTask.message ||
            (undoTask.wasCompleted ? "已重新打开任务" : "1 个任务已完成")
          ) : (
            <>
              任务已添加至{" "}
              <span className="underline underline-offset-2">
                {addedProject || "收件箱"}
              </span>
            </>
          )
        }
        actionLabel={undoTask ? "撤销" : "打开"}
        actionDescription={undoTask ? "撤销操作" : "查看任务"}
        disabled={busy || needsCheck || organizationSaving || loading}
        onAction={onToastAction}
      />

      <TaskEditor
        open={open}
        busy={editorBusy}
        detail={Boolean(editing) && !seriesUuid}
        location={editing?.project || "收件箱"}
        title={seriesUuid ? "编辑重复任务" : editing ? "编辑任务" : "添加任务"}
        onOpenChange={(value) => {
          if (!writeLock.current) {
            if (value) setOpen(true);
            else closeEditor();
          }
        }}
      >
        {seriesUuid ? (
          <SeriesEditor
            key={seriesUuid}
            uuid={seriesUuid}
            busy={busy}
            blocked={needsCheck}
            notice={notice}
            onClose={() => setSeriesUuid("")}
            onSave={(recur, until) =>
              onMutate("action", {
                uuid: seriesUuid,
                action: "recurrence.edit",
                recur,
                until,
              })
            }
            onStop={() =>
              onMutate("action", {
                uuid: seriesUuid,
                action: "delete",
              })
            }
          />
        ) : (
          <TaskForm
            key={editing?.uuid || "new-task"}
            onToggleTask={
              editing
                ? () => {
                    const target = editing;
                    void onToggleTask(
                      target,
                      target.status === "completed",
                    ).then((saved) => {
                      if (saved) {
                        setEditing({
                          ...target,
                          status:
                            target.status === "completed"
                              ? "pending"
                              : "completed",
                        });
                      }
                    });
                  }
                : undefined
            }
            timingActive={
              editing
                ? isTimingTask
                  ? isTimingTask(editing.uuid)
                  : Boolean(editing.start) && editing.status !== "completed"
                : false
            }
            timingUnavailable={organization.timing?.available === false}
            onToggleStart={
              editing && onToggleStart
                ? () => {
                    const target = editing;
                    const wasTiming = isTimingTask
                      ? isTimingTask(target.uuid)
                      : Boolean(target.start) && target.status !== "completed";
                    void onToggleStart(target).then((saved) => {
                      if (saved) {
                        setEditing({
                          ...target,
                          start: wasTiming ? "" : new Date().toISOString(),
                        });
                      }
                    });
                  }
                : undefined
            }
            onClearStartMark={
              editing && onClearStartMark
                ? () => {
                    const target = editing;
                    void onClearStartMark(target).then((saved) => {
                      if (saved) {
                        setEditing({
                          ...target,
                          start: "",
                        });
                      }
                    });
                  }
                : undefined
            }
            draft={draft}
            taskDescription={
              editing
                ? organization.descriptions?.[editing.uuid] || ""
                : draft.taskDescription || ""
            }
            onDescriptionChange={
              editing
                ? (nextDescription) =>
                    onChangeOrganization({
                      revision: organization.revision,
                      kind: "description",
                      action: "set",
                      uuid: editing.uuid,
                      description: nextDescription,
                    })
                : undefined
            }
            onAddComment={
              editing
                ? async (commentText) => {
                    const saved = await onMutate(
                      "action",
                      {
                        uuid: editing.uuid,
                        action: "edit",
                        task: taskEditPayload(editing, {
                          note: commentText,
                        }),
                      },
                      "notes",
                    );
                    if (saved) {
                      setEditing({
                        ...editing,
                        annotations: [
                          ...editing.annotations,
                          {
                            entry: new Date()
                              .toISOString()
                              .replace(/[-:]/g, "")
                              .replace(/\.\d{3}/, ""),
                            description: commentText,
                          },
                        ],
                      });
                    }
                    return saved;
                  }
                : undefined
            }
            editing={editing}
            effectiveRowState={
              editing && !habitByTaskUuid?.get(editing.uuid)
                ? effectiveState(
                    editing,
                    organization,
                    new Set(habitByTaskUuid?.keys() ?? []),
                  )
                : null
            }
            onChangeState={
              editing &&
              onChangeState &&
              !editingParent &&
              !habitByTaskUuid?.get(editing.uuid)
                ? (targetState) => {
                    const target = editing;
                    void Promise.resolve(
                      onChangeState(target, targetState),
                    ).then((saved) => {
                      if (saved) {
                        setEditing({ ...target, state: targetState });
                      }
                    });
                  }
                : undefined
            }
            projects={filterProjects}
            due={due}
            tags={tags}
            availableLabels={organization.tags}
            formError={
              formError ||
              organizationError ||
              (needsCheck || /精力|计时/.test(notice) ? notice : "")
            }
            busy={editorBusy}
            needsCheck={needsCheck || organizationBlocked}
            onCheck={closeEditor}
            onReload={() =>
              void onReloadAll().then((result) => {
                if (result) setFormError("");
              })
            }
            onDirtyChange={guard.setDirty}
            parentTask={editingParent}
            subtasks={editing ? subtasksMap.get(editing.uuid) || [] : []}
            onAddSubtask={
              editing
                ? (input) => onCreateSubtask(editing.uuid, input)
                : undefined
            }
            onToggleSubtask={(child) =>
              void onToggleTask(child, child.status === "completed")
            }
            onDeleteSubtask={(childUuid) =>
              void onMutate("action", {
                uuid: childUuid,
                action: "delete",
              })
            }
            onUnlinkSubtask={(childUuid) => void onUnlinkSubtask(childUuid)}
            onNavigateToParent={
              editingParent
                ? () => guard.requestLeave(() => onOpenEditor(editingParent))
                : undefined
            }
            onOpenSubtask={(child) =>
              guard.requestLeave(() => onOpenEditor(child))
            }
            onDraftChange={setDraft}
            onDueChange={setDue}
            onTagsChange={setTags}
            onClearError={() => setFormError("")}
            onEditSeries={(uuid) =>
              guard.requestLeave(() => setSeriesUuid(uuid))
            }
            onRemoveNote={async (entry, description) => {
              if (!editing) return false;
              const saved = await onMutate(
                "action",
                {
                  uuid: editing.uuid,
                  action: "note.remove",
                  entry,
                  description,
                },
                "notes",
              );
              if (saved) {
                setEditing({
                  ...editing,
                  annotations: editing.annotations.filter(
                    (note) =>
                      !(
                        note.entry === entry && note.description === description
                      ),
                  ),
                });
              }
              return saved;
            }}
            onDelete={() => {
              if (!editing) return;
              void onDeleteTask(editing, "editor");
            }}
            onSubmit={onSubmitTaskForm}
            isTimeMode={isTimeMode}
            hourlyRateCents={hourlyRateCents}
            costSummary={
              editing && taskCostSummary ? taskCostSummary(editing) : undefined
            }
            onRefreshTimeSnapshot={onRefreshTimeSnapshot}
            habit={editing ? habitByTaskUuid?.get(editing.uuid) : undefined}
            initialHabitPreset={!editing && Boolean(draft.habitPreset)}
            initialHabitDraft={!editing ? draft.habitDraft : undefined}
            habitTodayDate={habitTodayDate}
            habitActions={habitActions}
            onBindTaskHabit={onBindTaskHabit}
            onUnbindTaskHabit={onUnbindTaskHabit}
          />
        )}
      </TaskEditor>
      <AlertDialog
        open={guard.confirming}
        onOpenChange={(value) => {
          if (!value) guard.cancel();
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            guard.restoreFocus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              任务编辑、描述，以及尚未发送的评论或子任务会被放弃。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={editorBusy}
              onClick={guard.discard}
            >
              放弃更改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
