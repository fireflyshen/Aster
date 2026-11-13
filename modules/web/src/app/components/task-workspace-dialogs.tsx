import { QuickAdd } from "@/features/tasks/quick-add";
import { SeriesEditor } from "@/features/tasks/series-editor";
import { TaskEditor } from "@/features/tasks/task-editor";
import { TaskForm } from "@/features/tasks/task-form";
import { TaskToast } from "@/features/tasks/task-toast";
import { api } from "@/lib/api";
import type { Organization } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import type { FormEvent, MutableRefObject } from "react";
import type { UndoState } from "../hooks/use-task-actions";
import { taskEditPayload } from "../lib/task-view";

export type TaskWorkspaceDialogsProps = {
  currentProject: string;
  organization: Organization;
  organizationSaving: boolean;
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
  draft: TaskInput;
  setDraft: (draft: TaskInput) => void;
  due: string;
  setDue: (due: string) => void;
  tags: string;
  setTags: (tags: string) => void;
  formError: string;
  setFormError: (err: string) => void;
  onOpenEditor: (task?: Task, initial?: TaskInput) => void;
  applyViewDefaults: <T extends TaskInput>(input: T) => T;
  onCreateTaskInView: (
    input: TaskInput & { taskDescription?: string },
    columnId?: string,
    origin?: "quick",
  ) => Promise<boolean>;
  onCreateSubtask: (parentUuid: string, input: TaskInput) => Promise<boolean>;
  onToggleTask: (task: Task, completed: boolean) => Promise<boolean>;
  onUnlinkSubtask: (childUuid: string) => Promise<boolean>;
  onDeleteTask: (task: Task, origin?: "editor") => Promise<boolean>;
  onSubmitTaskForm: (event: FormEvent) => void;
  onMutate: (
    route: string,
    data: unknown,
    origin?: "editor" | "quick" | "notes",
  ) => Promise<boolean>;
  onSetOrganization: React.Dispatch<React.SetStateAction<Organization>>;
};

/** Renders quick-add, toast undo, full task detail editor, and recurring series dialogs. */
export function TaskWorkspaceDialogs(props: TaskWorkspaceDialogsProps) {
  const {
    currentProject,
    organization,
    organizationSaving,
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
    onUnlinkSubtask,
    onDeleteTask,
    onSubmitTaskForm,
    onMutate,
    onSetOrganization,
  } = props;

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
        onAdd={(task) => onCreateTaskInView(task, undefined, "quick")}
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
        busy={busy}
        detail={Boolean(editing) && !seriesUuid}
        location={editing?.project || "收件箱"}
        title={seriesUuid ? "编辑重复任务" : editing ? "编辑任务" : "添加任务"}
        onOpenChange={(value) => {
          if (!writeLock.current) {
            setOpen(value);
            if (!value) setSeriesUuid("");
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
            draft={draft}
            taskDescription={
              editing ? organization.descriptions?.[editing.uuid] || "" : ""
            }
            onDescriptionChange={
              editing
                ? async (nextDescription) => {
                    const saved = await api<Organization>("organization", {
                      revision: organization.revision,
                      kind: "description",
                      action: "set",
                      uuid: editing.uuid,
                      description: nextDescription,
                    });
                    onSetOrganization(saved);
                  }
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
                        task: taskEditPayload(editing, { note: commentText }),
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
            projects={filterProjects}
            due={due}
            tags={tags}
            availableLabels={organization.tags}
            formError={formError}
            busy={busy}
            needsCheck={needsCheck}
            onCheck={() => setOpen(false)}
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
              editingParent ? () => onOpenEditor(editingParent) : undefined
            }
            onOpenSubtask={(child) => onOpenEditor(child)}
            onDraftChange={setDraft}
            onDueChange={setDue}
            onTagsChange={setTags}
            onClearError={() => setFormError("")}
            onEditSeries={setSeriesUuid}
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
          />
        )}
      </TaskEditor>
    </>
  );
}
