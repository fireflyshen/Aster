import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { taskDate } from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { AlignLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { TaskCheckbox } from "./task-checkbox";
import { toDueDay } from "./task-date";
import { TaskDetailComments } from "./task-detail-comments";
import { TaskDetailSidebar } from "./task-detail-sidebar";
import { TaskDetailSubtasks } from "./task-detail-subtasks";

type TaskFormProps = {
  draft: TaskInput;
  taskDescription?: string;
  projects: string[];
  due: string;
  tags: string;
  availableLabels: SavedTag[];
  formError: string;
  editing?: Task;
  parentTask?: Task;
  busy: boolean;
  needsCheck: boolean;
  subtasks?: Task[];
  onAddSubtask?: (input: TaskInput) => Promise<boolean>;
  onToggleSubtask?: (subtask: Task, completed: boolean) => void;
  onDeleteSubtask?: (subtaskUuid: string) => void;
  onUnlinkSubtask?: (subtaskUuid: string) => void;
  onNavigateToParent?: () => void;
  onOpenSubtask?: (subtask: Task) => void;
  onDraftChange: (draft: TaskInput) => void;
  onDescriptionChange?: (description: string) => Promise<boolean | void>;
  onAddComment?: (text: string) => Promise<boolean>;
  onDueChange: (due: string) => void;
  onTagsChange: (tags: string) => void;
  onClearError: () => void;
  onCheck: () => void;
  onDelete: () => void;
  onEditSeries: (uuid: string) => void;
  onRemoveNote: (entry: string, description: string) => Promise<boolean>;
  onToggleTask?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/** Orchestrates the task detail / editing form and right-side properties rail. */
export function TaskForm({
  draft,
  taskDescription = "",
  projects,
  due,
  tags,
  availableLabels,
  formError,
  editing,
  parentTask,
  busy,
  needsCheck,
  subtasks = [],
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUnlinkSubtask,
  onNavigateToParent,
  onOpenSubtask,
  onDraftChange,
  onDescriptionChange,
  onAddComment,
  onDueChange,
  onTagsChange,
  onClearError,
  onCheck,
  onDelete,
  onEditSeries,
  onRemoveNote,
  onSubmit,
  onToggleTask,
}: TaskFormProps) {
  const [descriptionDraft, setDescriptionDraft] = useState(taskDescription || "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);

  useEffect(() => {
    if (!editingDescription) {
      setDescriptionDraft(taskDescription || "");
    }
  }, [taskDescription, editingDescription]);

  async function handleSaveDescription() {
    if (!onDescriptionChange) {
      setEditingDescription(false);
      return;
    }
    setSavingDescription(true);
    try {
      await onDescriptionChange(descriptionDraft.trim());
      setEditingDescription(false);
    } finally {
      setSavingDescription(false);
    }
  }

  function handleCancelDescription() {
    setDescriptionDraft(taskDescription || "");
    setEditingDescription(false);
  }

  const originalDue = editing?.due ? toDueDay(editing.due) : "";
  const changed =
    !editing ||
    draft.description !== editing.description ||
    (draft.project || "") !== (editing.project || "") ||
    (draft.priority || "") !== (editing.priority || "") ||
    (draft.recur || "") !== (editing.recur || "") ||
    (draft.until || "") !==
      (editing.until ? taskDate(new Date(editing.until)) : "") ||
    due !== originalDue ||
    tags !== editing.tags.join(", ") ||
    descriptionDraft.trim() !== (taskDescription || "").trim() ||
    !!draft.note?.trim();

  const locked = busy || needsCheck;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="task-detail-form flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229
        ) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <div
        data-editor-body
        className="task-detail-layout min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="task-detail-main">
          {parentTask && onNavigateToParent && (
            <button
              type="button"
              onClick={onNavigateToParent}
              className="group/parent mb-3 -mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-[220px] truncate font-normal">
                {parentTask.description}
              </span>
              <ChevronRight className="size-3 text-muted-foreground/70 transition-transform group-hover/parent:translate-x-0.5" />
            </button>
          )}

          <div className="task-detail-title items-start">
            {editing && onToggleTask && (
              <div className="mt-1 shrink-0">
                <TaskCheckbox
                  id={`detail-complete-${editing.uuid}`}
                  size="lg"
                  checked={editing.status === "completed"}
                  completed={editing.status === "completed"}
                  priority={editing.priority}
                  description={editing.description}
                  disabled={locked}
                  onComplete={onToggleTask}
                />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <Label htmlFor="description" className="sr-only">
                任务名称
              </Label>
              <Textarea
                id="description"
                placeholder="任务名称"
                value={draft.description}
                onChange={(event) => {
                  onDraftChange({
                    ...draft,
                    description: event.target.value,
                  });
                  onClearError();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={locked}
                required
                maxLength={2000}
                rows={1}
                aria-invalid={Boolean(formError)}
                aria-describedby={formError ? "editor-error" : undefined}
                className="min-h-8 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-lg leading-6 font-semibold shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent"
              />

              <div className="task-detail-description mt-2">
                {editingDescription ? (
                  <div className="rounded-[10px] border border-border bg-transparent p-2.5 transition-colors focus-within:border-foreground/35">
                    <div className="flex items-start gap-2">
                      <AlignLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      <Textarea
                        id="task-description-input"
                        autoFocus
                        placeholder="描述"
                        value={descriptionDraft}
                        onChange={(event) =>
                          setDescriptionDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            handleCancelDescription();
                          }
                          if (
                            event.key === "Enter" &&
                            (event.metaKey || event.ctrlKey)
                          ) {
                            event.preventDefault();
                            void handleSaveDescription();
                          }
                        }}
                        rows={2}
                        disabled={locked || savingDescription}
                        className="min-h-[50px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-foreground shadow-none outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-muted-foreground/60 dark:bg-transparent"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={locked || savingDescription}
                        onClick={handleCancelDescription}
                        className="h-7 rounded-[6px] border-0 px-3 text-xs font-medium shadow-none"
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={locked || savingDescription}
                        onClick={() => void handleSaveDescription()}
                        className="h-7 rounded-[6px] px-3 text-xs font-semibold shadow-none"
                      >
                        {savingDescription ? (
                          <Spinner className="size-3" />
                        ) : (
                          "保存"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditingDescription(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setEditingDescription(true);
                      }
                    }}
                    className="-ml-1.5 flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40"
                  >
                    <AlignLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground/65" />
                    {descriptionDraft.trim() ? (
                      <p className="flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">
                        {descriptionDraft}
                      </p>
                    ) : (
                      <span className="select-none text-sm text-muted-foreground/60">
                        描述
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {editing && (
            <TaskDetailSubtasks
              subtasks={subtasks}
              project={draft.project}
              disabled={locked}
              onAddSubtask={onAddSubtask}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onUnlinkSubtask={onUnlinkSubtask}
              onOpenSubtask={onOpenSubtask}
            />
          )}

          <TaskDetailComments
            annotations={editing?.annotations}
            disabled={locked}
            onAddComment={onAddComment}
            onRemoveNote={onRemoveNote}
          />

          {formError && (
            <Alert id="editor-error" variant="destructive" className="mt-4">
              <AlertDescription className="flex items-center gap-2">
                <span>{formError}</span>
                {needsCheck && (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => onCheck()}
                    className="h-auto p-0 text-current"
                  >
                    关闭并刷新任务
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <TaskDetailSidebar
          draft={draft}
          projects={projects}
          due={due}
          tags={tags}
          availableLabels={availableLabels}
          editing={editing}
          disabled={locked}
          onDraftChange={onDraftChange}
          onDueChange={onDueChange}
          onTagsChange={onTagsChange}
          onClearError={onClearError}
          onEditSeries={onEditSeries}
          onDelete={onDelete}
        />
      </div>

      {(changed || busy || Boolean(formError)) && (
        <div
          data-editor-actions
          className="flex shrink-0 items-center justify-between gap-4 border-t border-border/70 px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:py-3.5"
        >
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onCheck()}
              className="h-8 rounded-[6px]"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={locked}
              className="h-8 min-w-18 rounded-[6px]"
            >
              {busy ? <Spinner className="size-4" /> : "保存"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
