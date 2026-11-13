import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FocusPicker } from "@/features/projects/focus-picker";
import { ProjectEditor } from "@/features/projects/project-editor";
import { ProjectTransition } from "@/features/projects/project-transition";
import { RecoveryCenter } from "@/features/recovery/recovery-center";
import { QuickAdd } from "@/features/tasks/quick-add";
import { SeriesEditor } from "@/features/tasks/series-editor";
import { TaskEditor } from "@/features/tasks/task-editor";
import { TaskForm } from "@/features/tasks/task-form";
import { TaskToast } from "@/features/tasks/task-toast";
import { api } from "@/lib/api";
import type { ProjectStatus } from "@core/workspace/focus";
import type {
  Organization,
  OrganizationChange,
  SavedFilter,
  SavedTag,
} from "@core/workspace/organization";
import { projectNames } from "@core/workspace/projects";
import type { Task, TaskInput, View } from "@shared/tasks";
import type { FormEvent, MutableRefObject } from "react";
import type { UndoState } from "../hooks/use-task-actions";
import { taskEditPayload } from "../lib/task-view";
import { CommandPalette } from "../command-palette";

type WorkspaceModalsProps = {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  layout: "list" | "board";
  currentProject: string;
  organizationPage: boolean;
  organization: Organization;
  organizationError: string;
  organizationReady: boolean;
  organizationSaving: boolean;
  organizationBlocked: boolean;
  organizationGeneration: MutableRefObject<number>;
  filterProjects: string[];
  tasks: Task[];
  busy: boolean;
  loading: boolean;
  needsCheck: boolean;
  notice: string;
  setNeedsCheck: (value: boolean) => void;
  writeLock: MutableRefObject<boolean>;
  recoveryOpen: boolean;
  setRecoveryOpen: (open: boolean) => void;

  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  quickProject: string;
  setQuickProject: (value: string) => void;
  quickError: string;
  setQuickError: (value: string) => void;
  openQuickAdd: () => void;

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

  editingProject?: string;
  setEditingProject: (name: string | undefined) => void;
  newProjectParent: string;
  focusPickerOpen: boolean;
  setFocusPickerOpen: (open: boolean) => void;
  transitionProject?: { name: string; status: ProjectStatus };
  setTransitionProject: (
    value: { name: string; status: ProjectStatus } | undefined,
  ) => void;
  deletingProject?: { name: string; revision: number };
  setDeletingProject: (
    value:
      | { name: string; revision: number }
      | ((
          current: { name: string; revision: number } | undefined,
        ) => { name: string; revision: number } | undefined)
      | undefined,
  ) => void;

  onToggleLayout: () => void;
  onSelectView: (view: View) => void;
  onSelectProject: (name: string) => void;
  onSelectEntry: (entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) => void;
  onOpenOrganization: () => void;
  onEditProject: (name: string) => void;
  onTransitionProject: (name: string, status: ProjectStatus) => void;
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
  onChangeOrganization: (change: OrganizationChange) => Promise<boolean>;
  onSetOrganization: React.Dispatch<React.SetStateAction<Organization>>;
  onSetOrganizationError: (err: string) => void;
  onSetOrganizationSaving: (saving: boolean) => void;
  onLoadOrganization: () => Promise<Organization | undefined>;
  onReloadAll: () => Promise<Organization | undefined>;
};

/** Consolidates command palette, toast notifications, quick add, and management dialogs. */
export function WorkspaceModals(props: WorkspaceModalsProps) {
  const {
    commandOpen,
    setCommandOpen,
    layout,
    currentProject,
    organizationPage,
    organization,
    organizationError,
    organizationReady,
    organizationSaving,
    organizationBlocked,
    organizationGeneration,
    filterProjects,
    tasks,
    busy,
    loading,
    needsCheck,
    notice,
    setNeedsCheck,
    writeLock,
    recoveryOpen,
    setRecoveryOpen,
    quickOpen,
    setQuickOpen,
    quickProject,
    setQuickProject,
    quickError,
    setQuickError,
    openQuickAdd,
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
    editingProject,
    setEditingProject,
    newProjectParent,
    focusPickerOpen,
    setFocusPickerOpen,
    transitionProject,
    setTransitionProject,
    deletingProject,
    setDeletingProject,
    onToggleLayout,
    onSelectView,
    onSelectProject,
    onSelectEntry,
    onOpenOrganization,
    onEditProject,
    onTransitionProject,
    onOpenEditor,
    applyViewDefaults,
    onCreateTaskInView,
    onCreateSubtask,
    onToggleTask,
    onUnlinkSubtask,
    onDeleteTask,
    onSubmitTaskForm,
    onMutate,
    onChangeOrganization,
    onSetOrganization,
    onSetOrganizationError,
    onReloadAll,
  } = props;

  const activeProjectMeta =
    editingProject !== undefined
      ? organization.projects?.find((item) => item.name === editingProject)
      : undefined;

  return (
    <>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        layout={layout}
        currentProject={organizationPage ? "" : currentProject}
        organization={organization}
        projects={projectNames(filterProjects)}
        tasks={tasks}
        onAddTask={openQuickAdd}
        onAddProject={() => onEditProject("")}
        onFocusPicker={() => setFocusPickerOpen(true)}
        onToggleLayout={onToggleLayout}
        onView={onSelectView}
        onProject={onSelectProject}
        onEditProject={onEditProject}
        onProjectStatus={onTransitionProject}
        onEntry={onSelectEntry}
        onOrganization={onOpenOrganization}
        onRecovery={() => setRecoveryOpen(true)}
        onEditTask={(task) => onOpenEditor(task)}
      />

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

      {editingProject !== undefined && (
        <ProjectEditor
          project={editingProject}
          projects={projectNames(filterProjects)}
          initialParent={newProjectParent || undefined}
          color={activeProjectMeta?.color}
          description={activeProjectMeta?.description || ""}
          outcome={activeProjectMeta?.outcome || ""}
          nextTask={activeProjectMeta?.nextTask || ""}
          revision={organization.revision}
          busy={organizationSaving}
          blocked={!organizationReady || organizationBlocked || needsCheck}
          error={organizationError}
          onClose={() => setEditingProject(undefined)}
          onReload={onReloadAll}
          onSave={async (
            name,
            description,
            revision,
            outcome,
            nextTask,
            color,
          ) => {
            const isNew = !editingProject;
            const saved = await onChangeOrganization({
              kind: "project",
              action: "save",
              revision,
              originalName: editingProject,
              item: {
                name,
                description,
                outcome,
                nextTask,
                color,
              },
            });
            if (saved && isNew && !organizationPage) {
              onSelectProject(name);
            }
            return saved;
          }}
        />
      )}

      {focusPickerOpen && !transitionProject && (
        <FocusPicker
          data={organization}
          busy={organizationSaving}
          error={organizationError}
          onClose={() => setFocusPickerOpen(false)}
          onChoose={(name) => onTransitionProject(name, "active")}
          onCreateAndFocus={async (name, outcome, replaceProject) => {
            if (writeLock.current || organizationBlocked || needsCheck) {
              return false;
            }
            writeLock.current = true;
            props.onSetOrganizationSaving(true);
            onSetOrganizationError("");
            organizationGeneration.current++;
            try {
              const created = await api<Organization>("organization", {
                kind: "project",
                action: "save",
                revision: organization.revision,
                item: {
                  name,
                  description: "",
                  outcome,
                  nextTask: "",
                },
              });
              const activated = await api<Organization>("organization", {
                kind: "project",
                action: "status",
                revision: created.revision,
                name,
                status: "active",
                outcome,
                ...(replaceProject ? { replaceProject } : {}),
              });
              onSetOrganization(activated);
              await onReloadAll();
              return true;
            } catch (error) {
              onSetOrganizationError((error as Error).message);
              return false;
            } finally {
              writeLock.current = false;
              props.onSetOrganizationSaving(false);
            }
          }}
        />
      )}

      {transitionProject && (
        <ProjectTransition
          key={`${transitionProject.name}:${transitionProject.status}`}
          project={
            organization.projects?.find(
              (item) => item.name === transitionProject.name,
            ) || {
              name: transitionProject.name,
              description: "",
            }
          }
          status={transitionProject.status}
          data={organization}
          busy={organizationSaving}
          blocked={!organizationReady || organizationBlocked || needsCheck}
          error={organizationError}
          onBack={
            focusPickerOpen ? () => setTransitionProject(undefined) : undefined
          }
          onClose={() => {
            setTransitionProject(undefined);
            setFocusPickerOpen(false);
          }}
          onSave={onChangeOrganization}
          onReload={onReloadAll}
        />
      )}

      <AlertDialog
        open={Boolean(deletingProject)}
        onOpenChange={(next) => {
          if (!next && !organizationSaving) setDeletingProject(undefined);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除项目“{deletingProject?.name}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该项目及其所有子项目将被移除，旗下任务将移动至“收件箱”，任务完成状态、标签和看板列结构均会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {organizationError && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center gap-2">
                <span>{organizationError}</span>
                <Button
                  variant="link"
                  disabled={organizationSaving}
                  className="h-auto p-0 text-current"
                  onClick={async () => {
                    const latest = await onReloadAll();
                    if (latest) {
                      setDeletingProject((current) =>
                        current
                          ? { ...current, revision: latest.revision }
                          : undefined,
                      );
                    }
                  }}
                >
                  重新加载并检查
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={organizationSaving}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                organizationSaving ||
                !organizationReady ||
                organizationBlocked ||
                needsCheck
              }
              onClick={(event) => {
                event.preventDefault();
                if (deletingProject) {
                  void onChangeOrganization({
                    kind: "project",
                    action: "delete",
                    revision: deletingProject.revision,
                    originalName: deletingProject.name,
                    item: {
                      name: deletingProject.name,
                      description: "",
                    },
                  }).then((saved) => {
                    if (saved) setDeletingProject(undefined);
                  });
                }
              }}
            >
              {organizationSaving ? <Spinner /> : "删除项目"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {recoveryOpen && (
        <RecoveryCenter
          onClose={() => setRecoveryOpen(false)}
          onUnconfirmed={() => setNeedsCheck(true)}
          busy={busy}
          blocked={needsCheck}
          notice={notice}
          onRestore={(uuid) => onMutate("action", { uuid, action: "restore" })}
          onRefresh={onReloadAll}
        />
      )}
    </>
  );
}
