import { DatePicker } from "./date-picker";
import { ProjectPicker } from "./project-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Task, TaskInput } from "@shared/tasks";
import type { FormEvent } from "react";

type TaskFormProps = {
  draft: TaskInput;
  projects: string[];
  due: string;
  tags: string;
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskForm({
  draft,
  projects,
  due,
  tags,
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
      <div data-editor-body className="min-h-0 overflow-y-auto overscroll-contain px-6 pt-1 pb-6">
        <Label htmlFor="description" className="sr-only">
          Task name
        </Label>
        <Textarea
          id="description"
          placeholder="Task name"
          value={draft.description}
          onChange={(event) => {
            onDraftChange({ ...draft, description: event.target.value });
            onClearError();
          }}
          disabled={busy || needsCheck}
          required
          maxLength={2000}
          rows={3}
          aria-invalid={formError === "Enter a task name."}
          aria-describedby={formError ? "editor-error" : undefined}
          className="min-h-28 resize-none md:text-base"
        />
        <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-5 border-t pt-5 min-[360px]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="edit-project" className="text-xs leading-4 font-normal text-muted-foreground">
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
            <Label htmlFor="due" className="text-xs leading-4 font-normal text-muted-foreground">
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
            <Label htmlFor="tags" className="text-xs leading-4 font-normal text-muted-foreground">
              Labels
            </Label>
            <Input
              id="tags"
              placeholder="Separate with commas"
              value={tags}
              disabled={busy || needsCheck}
              onChange={(event) => {
                onTagsChange(event.target.value);
                onClearError();
              }}
              className="h-11 text-base md:text-base"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="priority" className="text-xs leading-4 font-normal text-muted-foreground">
              Priority
            </Label>
            <Select
              disabled={busy || needsCheck}
              value={draft.priority || "none"}
              onValueChange={(value) => {
                onDraftChange({ ...draft, priority: value === "none" ? "" : value });
                onClearError();
              }}
            >
              <SelectTrigger id="priority" className="h-11 min-h-11 w-full text-base data-[size=default]:h-11">
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
        {!!editing?.annotations.length && (
          <p className="mt-5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {editing.annotations.map((note) => note.description).join("\n")}
          </p>
        )}
        {formError && (
          <Alert id="editor-error" variant="destructive" className="mt-5">
            <AlertDescription>
              {formError}
              {needsCheck && (
                <Button type="button" variant="link" onClick={() => onCheck()} className="h-auto p-0 text-current">
                  Close and check tasks
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div
        data-editor-actions
        className="flex shrink-0 items-center justify-between gap-4 border-t px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:py-5"
      >
        {editing && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || needsCheck}
            onClick={() => onDelete()}
            className="h-11 px-0 text-xs text-destructive"
          >
            Delete task
          </Button>
        )}
        <Button type="submit" disabled={busy || needsCheck} className="ml-auto h-11 min-w-24">
          {busy ? <Spinner className="size-4" /> : "Save"}
        </Button>
      </div>
    </form>
  );
}
