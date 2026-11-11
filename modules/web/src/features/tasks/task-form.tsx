import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { recurrenceLabel } from "@core/tasks/recurrence";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { ArrowUpRight, ChevronLeft, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DatePicker } from "./date-picker";
import { LabelsPicker } from "./labels-picker";
import { ProjectPicker } from "./project-picker";
import { RepeatEnd, RepeatSelect } from "./repeat-fields";

type TaskFormProps = {
  draft: TaskInput;
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
  onDueChange: (due: string) => void;
  onTagsChange: (tags: string) => void;
  onClearError: () => void;
  onCheck: () => void;
  onDelete: () => void;
  onEditSeries: (uuid: string) => void;
  onRemoveNote: (entry: string, description: string) => Promise<boolean>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskForm({
  draft,
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
  onDueChange,
  onTagsChange,
  onClearError,
  onCheck,
  onDelete,
  onEditSeries,
  onRemoveNote,
  onSubmit,
}: TaskFormProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  async function handleCreateSubtask(e?: FormEvent) {
    if (e) e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed || !onAddSubtask) return;
    setAddingSubtask(true);
    try {
      const ok = await onAddSubtask({
        description: trimmed,
        project: draft.project,
        tags: [],
      });
      if (ok) {
        setNewSubtaskTitle("");
      }
    } finally {
      setAddingSubtask(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex min-h-0 flex-col"
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
        className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-4 pb-5"
      >
        {parentTask && onNavigateToParent && (
          <button
            type="button"
            onClick={onNavigateToParent}
            className="group/parent mb-3 -mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronLeft className="size-3.5 transition-transform group-hover/parent:-translate-x-0.5" />
            <span className="truncate max-w-[280px]">Back to: {parentTask.description}</span>
          </button>
        )}
        <Label htmlFor="description" className="sr-only">
          Task name
        </Label>
        <Textarea
          id="description"
          placeholder="Task name"
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
          disabled={busy || needsCheck}
          required
          maxLength={2000}
          rows={1}
          aria-invalid={formError === "Enter a task name."}
          aria-describedby={formError ? "editor-error" : undefined}
          className="min-h-8 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-base leading-6 font-semibold shadow-none focus-visible:ring-0 md:text-lg dark:bg-transparent"
        />
        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3.5 border-t border-border/70 pt-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label
              htmlFor="edit-project"
              className="text-xs leading-4 font-normal text-muted-foreground"
            >
              Project
            </Label>
            <ProjectPicker
              value={draft.project || ""}
              projects={projects}
              onChange={(project) => {
                onDraftChange({ ...draft, project });
                onClearError();
              }}
              disabled={busy || needsCheck}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label
              htmlFor="due"
              className="text-xs leading-4 font-normal text-muted-foreground"
            >
              Due date
            </Label>
            <DatePicker
              value={due}
              onChange={(value) => {
                onDueChange(value);
                onClearError();
              }}
              disabled={busy || needsCheck}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label
              htmlFor="tags"
              className="text-xs leading-4 font-normal text-muted-foreground"
            >
              Labels
            </Label>
            <LabelsPicker
              value={tags
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean)}
              choices={availableLabels}
              disabled={busy || needsCheck}
              onChange={(tags) => {
                onTagsChange(tags.join(", "));
                onClearError();
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label
              htmlFor="priority"
              className="text-xs leading-4 font-normal text-muted-foreground"
            >
              Priority
            </Label>
            <Select
              disabled={busy || needsCheck}
              value={draft.priority || "none"}
              onValueChange={(value) => {
                onDraftChange({
                  ...draft,
                  priority: value === "none" ? "" : value,
                });
                onClearError();
              }}
            >
              <SelectTrigger
                id="priority"
                className="h-11 min-h-11 w-full text-base data-[size=default]:h-11 md:min-h-9 md:text-sm md:data-[size=default]:h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="L">Low</SelectItem>
                <SelectItem value="M">Medium</SelectItem>
                <SelectItem value="H">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3.5 grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label
              htmlFor="repeat"
              className="text-xs leading-4 font-normal text-muted-foreground"
            >
              Repeat
            </Label>
            {editing?.parent ? (
              <div className="flex min-h-11 items-center justify-between gap-2 md:min-h-9">
                <span className="text-sm text-muted-foreground">
                  {recurrenceLabel(editing.recur || "Repeating")}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-9 px-0 text-xs"
                  disabled={busy || needsCheck}
                  onClick={() => onEditSeries(editing.parent!)}
                >
                  Edit series
                </Button>
              </div>
            ) : (
              <RepeatSelect
                value={draft.recur || ""}
                disabled={busy || needsCheck}
                onChange={(recur) => {
                  onDraftChange({
                    ...draft,
                    recur,
                    until: recur ? draft.until : "",
                  });
                  onClearError();
                }}
              />
            )}
          </div>
          {!!draft.recur && !editing?.parent && (
            <RepeatEnd
              value={draft.until || ""}
              disabled={busy || needsCheck}
              onChange={(until) => {
                onDraftChange({ ...draft, until });
                onClearError();
              }}
            />
          )}
        </div>
        <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
          <Label
            htmlFor="task-note"
            className="text-xs font-normal text-muted-foreground"
          >
            Notes
          </Label>
          {!!editing?.annotations.length && (
            <div className="divide-y rounded-lg border px-3">
              {editing.annotations.map((note, index) => (
                <div
                  key={`${note.entry}-${index}`}
                  className="group/note flex items-start gap-3 py-2.5"
                >
                  <p className="min-w-0 flex-1 text-sm leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {note.description}
                  </p>
                  {note.entry && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-mr-1 size-7 shrink-0 text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover/note:opacity-100 md:group-focus-within/note:opacity-100"
                      aria-label={`Remove note ${index + 1}`}
                      disabled={busy || needsCheck}
                      onClick={() =>
                        void onRemoveNote(note.entry!, note.description)
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <Textarea
            id="task-note"
            placeholder={
              editing?.annotations.length ? "Add another note…" : "Add a note…"
            }
            value={draft.note || ""}
            maxLength={8000}
            rows={2}
            disabled={busy || needsCheck}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                note: event.target.value,
              });
              onClearError();
            }}
            className="min-h-16 resize-y md:text-sm"
          />
        </div>
        {editing && (
          <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-normal text-muted-foreground">
                Subtasks{" "}
                {subtasks && subtasks.length > 0 && (
                  <span className="tabular-nums">
                    ({subtasks.filter((s) => s.status === "completed").length}/
                    {subtasks.length})
                  </span>
                )}
              </Label>
            </div>
            {subtasks && subtasks.length > 0 && (
              <div className="divide-y rounded-lg border border-border/70 px-3">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.uuid}
                    className="group/subtask flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Checkbox
                        id={`form-sub-${subtask.uuid}`}
                        checked={subtask.status === "completed"}
                        disabled={busy || needsCheck}
                        onCheckedChange={() =>
                          onToggleSubtask?.(
                            subtask,
                            subtask.status !== "completed",
                          )
                        }
                        className={cn(
                          "size-4 rounded-full shadow-none cursor-pointer",
                          subtask.status !== "completed"
                            ? cn(
                                "border border-muted-foreground/60 bg-transparent",
                                subtask.priority === "H" && "border-red-500 bg-red-500/10",
                                subtask.priority === "M" && "border-amber-500 bg-amber-500/10",
                                subtask.priority === "L" && "border-blue-500 bg-blue-500/10",
                              )
                            : cn(
                                "text-white",
                                subtask.priority === "H" &&
                                  "border-red-500 bg-red-500 data-[state=checked]:border-red-500 data-[state=checked]:bg-red-500 dark:border-red-500 dark:bg-red-500 dark:data-[state=checked]:border-red-500 dark:data-[state=checked]:bg-red-500 dark:data-[state=checked]:text-white",
                                subtask.priority === "M" &&
                                  "border-amber-500 bg-amber-500 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500 dark:border-amber-500 dark:bg-amber-500 dark:data-[state=checked]:border-amber-500 dark:data-[state=checked]:bg-amber-500 dark:data-[state=checked]:text-white",
                                subtask.priority === "L" &&
                                  "border-blue-500 bg-blue-500 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 dark:border-blue-500 dark:bg-blue-500 dark:data-[state=checked]:border-blue-500 dark:data-[state=checked]:bg-blue-500 dark:data-[state=checked]:text-white",
                                !subtask.priority &&
                                  "border-muted-foreground/70 bg-muted-foreground/70 data-[state=checked]:border-muted-foreground/70 data-[state=checked]:bg-muted-foreground/70 dark:border-muted-foreground/70 dark:bg-muted-foreground/70 dark:data-[state=checked]:border-muted-foreground/70 dark:data-[state=checked]:bg-muted-foreground/70 dark:data-[state=checked]:text-white",
                              ),
                        )}
                      />
                      {onOpenSubtask ? (
                        <button
                          type="button"
                          onClick={() => onOpenSubtask(subtask)}
                          className={cn(
                            "text-sm font-normal truncate text-left hover:underline cursor-pointer flex-1",
                            subtask.status === "completed" &&
                              "line-through text-muted-foreground/60",
                          )}
                          title={`Open subtask: ${subtask.description}`}
                        >
                          {subtask.description}
                        </button>
                      ) : (
                        <span
                          className={cn(
                            "text-sm font-normal truncate",
                            subtask.status === "completed" &&
                              "line-through text-muted-foreground/60",
                          )}
                        >
                          {subtask.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-80 md:opacity-0 md:group-hover/subtask:opacity-100 transition-opacity">
                      {onUnlinkSubtask && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          title="Turn into top-level task"
                          aria-label="Turn into top-level task"
                          disabled={busy || needsCheck}
                          onClick={() => onUnlinkSubtask(subtask.uuid)}
                        >
                          <ArrowUpRight className="size-3.5" />
                        </Button>
                      )}
                      {onDeleteSubtask && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          title="Delete subtask"
                          aria-label="Delete subtask"
                          disabled={busy || needsCheck}
                          onClick={() => onDeleteSubtask(subtask.uuid)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {onAddSubtask && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Add a subtask…"
                  value={newSubtaskTitle}
                  disabled={busy || needsCheck || addingSubtask}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateSubtask();
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 shrink-0 px-3 text-xs"
                  disabled={
                    !newSubtaskTitle.trim() ||
                    busy ||
                    needsCheck ||
                    addingSubtask
                  }
                  onClick={() => void handleCreateSubtask()}
                >
                  {addingSubtask ? <Spinner className="size-3.5" /> : "Add"}
                </Button>
              </div>
            )}
          </div>
        )}
        {formError && (
          <Alert id="editor-error" variant="destructive" className="mt-4">
            <AlertDescription>
              {formError}
              {needsCheck && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => onCheck()}
                  className="h-auto p-0 text-current"
                >
                  Close and check tasks
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div
        data-editor-actions
        className="flex shrink-0 items-center justify-between gap-4 border-t border-border/70 px-5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:py-3.5"
      >
        {editing && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || needsCheck}
            onClick={() => onDelete()}
            className="-ml-2.5 h-9 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Delete task
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onCheck()}
            className="h-9"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || needsCheck}
            className="h-9 min-w-20"
          >
            {busy ? <Spinner className="size-4" /> : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
