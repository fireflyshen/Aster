import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Trash2 } from "lucide-react";
import type { FormEvent } from "react";
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
  busy: boolean;
  needsCheck: boolean;
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
  busy,
  needsCheck,
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
