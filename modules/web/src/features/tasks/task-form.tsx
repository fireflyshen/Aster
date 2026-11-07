import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LabelsPicker } from "./labels-picker";
import type { SavedTag } from "@core/workspace/organization";
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
import type { Task, TaskInput } from "@shared/tasks";
import type { FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { RepeatSelect, RepeatEnd } from "./repeat-fields";
import { recurrenceLabel } from "@core/tasks/recurrence";
import { DatePicker } from "./date-picker";
import { ProjectPicker } from "./project-picker";

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
  const [removing, setRemoving] = useState<{
    entry: string;
    description: string;
  }>();
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
        className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-1 pb-5"
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
          disabled={busy || needsCheck}
          required
          maxLength={2000}
          rows={3}
          aria-invalid={formError === "Enter a task name."}
          aria-describedby={formError ? "editor-error" : undefined}
          className="min-h-28 resize-none md:min-h-24 md:text-sm"
        />
        <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-5 border-t pt-5 sm:grid-cols-2 md:gap-y-4">
          <div className="flex min-w-0 flex-col gap-2">
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
          <div className="flex min-w-0 flex-col gap-2">
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
          <div className="flex min-w-0 flex-col gap-2">
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
          <div className="flex min-w-0 flex-col gap-2">
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
        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
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
        <div className="mt-5 space-y-3 border-t pt-5">
          <Label
            htmlFor="task-note"
            className="text-xs font-normal text-muted-foreground"
          >
            Notes
          </Label>
          {!!editing?.annotations.length && (
            <div className="divide-y rounded-md border px-3">
              {editing.annotations.map((note, index) => (
                <div
                  key={`${note.entry}-${index}`}
                  className="group/note flex items-start gap-3 py-3"
                >
                  <p className="min-w-0 flex-1 text-sm leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {note.description}
                  </p>
                  {note.entry && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-mr-1 size-7 shrink-0 text-muted-foreground md:opacity-0 md:group-hover/note:opacity-100 md:group-focus-within/note:opacity-100"
                      aria-label={`Remove note ${index + 1}`}
                      disabled={busy || needsCheck}
                      onClick={() =>
                        setRemoving({
                          entry: note.entry!,
                          description: note.description,
                        })
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
            className="min-h-20 resize-y md:text-sm"
          />
        </div>
        <AlertDialog
          open={!!removing}
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined);
          }}
        >
          <AlertDialogContent className="sm:max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this note?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the note from this task.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (removing)
                    void onRemoveNote(removing.entry, removing.description);
                }}
              >
                Remove note
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {formError && (
          <Alert id="editor-error" variant="destructive" className="mt-5">
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
        className="flex shrink-0 items-center justify-between gap-4 border-t px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:py-4"
      >
        {editing && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || needsCheck}
            onClick={() => onDelete()}
            className="-ml-2.5 h-11 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive md:h-9"
          >
            Delete task
          </Button>
        )}
        <Button
          type="submit"
          disabled={busy || needsCheck}
          className="ml-auto h-11 min-w-24 md:h-9 md:min-w-20"
        >
          {busy ? <Spinner className="size-4" /> : "Save"}
        </Button>
      </div>
    </form>
  );
}
