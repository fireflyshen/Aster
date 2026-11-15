import { Button } from "@/components/ui/button";
import {
  ComposerTokenBar,
  ComposerToolbar,
} from "@/features/tasks/composer-toolbar";
import { useComposerDraft } from "@/features/tasks/use-composer-draft";
import type { SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { Hash, Plus, Tag } from "lucide-react";
import type { FormEvent } from "react";

/** Inline task composer supporting smart `#`/`@`/date/priority syntax and compact row editing. */
export function TodoistTaskComposer({
  mode = "add",
  compact = true,
  disabled = false,
  ariaLabel = "添加任务",
  placeholder = "任务名称",
  defaultProject = "",
  defaultDue = "",
  initialValue,
  initialDescription = "",
  projects = [],
  availableLabels = [],
  onSubmitTask,
  onOpenFullEditor,
  onCancel,
}: {
  mode?: "add" | "edit";
  compact?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  defaultProject?: string;
  defaultDue?: string;
  initialValue?: TaskInput & { taskDescription?: string };
  initialNotePreview?: string;
  initialDescription?: string;
  projects?: string[];
  availableLabels?: SavedTag[];
  onSubmitTask?: (
    task: TaskInput & { taskDescription?: string },
  ) => Promise<boolean>;
  onOpenFullEditor?: (draft?: TaskInput & { taskDescription?: string }) => void;
  onCancel?: () => void;
}) {
  const draftState = useComposerDraft({
    mode,
    defaultProject,
    defaultDue,
    initialValue,
    initialDescription,
    projects,
    availableLabels,
    onCancel,
  });

  const {
    editing,
    setEditing,
    title,
    setTitle,
    note,
    setNote,
    setManualDue,
    setManualPriority,
    setManualProject,
    setManualTags,
    priorityOpen,
    setPriorityOpen,
    error,
    setError,
    submitting,
    setSubmitting,
    titleRef,
    parsed,
    dueToken,
    activeDueDay,
    activePriority,
    activeProject,
    activeTags,
    projectSuggestions,
    labelSuggestions,
    applySuggestion,
    removeToken,
    setField,
    clearFields,
    resetOrClose,
    buildTaskInput,
  } = draftState;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || submitting || !onSubmitTask) return;
    const built = buildTaskInput();
    if (built.error) {
      setError(built.error);
      titleRef.current?.focus();
      return;
    }
    if (!built.task.description.trim()) {
      if (mode === "add") {
        resetOrClose();
      } else {
        setError("请输入任务名称。");
        titleRef.current?.focus();
      }
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const ok = await onSubmitTask(built.task);
      if (ok) {
        if (mode === "edit") {
          onCancel?.();
        } else {
          clearFields(true);
          requestAnimationFrame(() => titleRef.current?.focus());
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing && mode === "add") {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          if (!onSubmitTask) {
            onOpenFullEditor?.();
            return;
          }
          clearFields(false);
          setEditing(true);
          requestAnimationFrame(() => titleRef.current?.focus());
        }}
        className="task-add-button group/add text-muted-foreground hover:text-primary"
      >
        <span className="flex size-[18px] items-center justify-center rounded-full text-primary transition-colors group-hover/add:bg-primary group-hover/add:text-primary-foreground">
          <Plus className="size-3.5" strokeWidth={2} />
        </span>
        添加任务
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      data-todoist-composer={mode}
      data-compact={compact}
      className={cn(compact ? "my-1.5" : "mt-1.5")}
    >
      <div className="task-composer-shell animate-in fade-in-0 zoom-in-98 rounded-[10px] border border-border bg-card p-3 shadow-xs transition-colors duration-150 ease-out focus-within:border-ring/60">
        <div className="relative space-y-1">
          <input
            ref={titleRef}
            type="text"
            autoFocus={mode === "edit"}
            value={title}
            disabled={disabled || submitting}
            aria-label={ariaLabel}
            placeholder={placeholder}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                resetOrClose();
                return;
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "e" &&
                onOpenFullEditor
              ) {
                event.preventDefault();
                const built = buildTaskInput();
                resetOrClose();
                onOpenFullEditor(built.task);
              }
            }}
            className="w-full bg-transparent text-sm leading-5 font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
          />

          {(projectSuggestions.length > 0 || labelSuggestions.length > 0) && (
            <div className="absolute top-7 left-0 z-30 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-md">
              {projectSuggestions.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applySuggestion(p, "#")}
                  className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-foreground hover:bg-accent"
                >
                  <Hash className="size-3 text-muted-foreground" />
                  <span className="truncate">{p}</span>
                </button>
              ))}
              {labelSuggestions.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => applySuggestion(l.name, "@")}
                  className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-foreground hover:bg-accent"
                >
                  <Tag className="size-3 text-muted-foreground" />
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            data-composer-note
            rows={1}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = `${Math.max(24, el.scrollHeight)}px`;
              }
            }}
            value={note}
            disabled={disabled || submitting}
            aria-label="任务描述"
            placeholder="描述"
            onInput={(event) => {
              const el = event.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.max(24, el.scrollHeight)}px`;
            }}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                resetOrClose();
                return;
              }
              if (
                (event.key === "Enter" && (event.metaKey || event.ctrlKey)) ||
                (event.key === "Enter" &&
                  !event.shiftKey &&
                  !note.includes("\n"))
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="w-full resize-none bg-transparent text-xs leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <ComposerTokenBar tokens={parsed.tokens} onRemoveToken={removeToken} />

        <ComposerToolbar
          mode={mode}
          disabled={disabled}
          submitting={submitting}
          canSubmit={Boolean(title.trim())}
          activeDueDay={activeDueDay}
          activePriority={activePriority}
          activeProject={activeProject}
          activeTags={activeTags}
          projects={projects}
          availableLabels={availableLabels}
          priorityOpen={priorityOpen}
          onPriorityOpenChange={setPriorityOpen}
          onReturnFocus={() => titleRef.current?.focus()}
          onDueChange={(nextDay) => {
            setManualDue(nextDay || null);
            if (!nextDay && dueToken) {
              removeToken(dueToken);
            } else if (nextDay) {
              setField("due", nextDay);
            }
          }}
          onPriorityChange={(value, quickWord) => {
            setManualPriority(value);
            setField("priority", value ? quickWord : "");
          }}
          onTagsChange={setManualTags}
          onProjectChange={(nextProject) => {
            setManualProject(nextProject);
            setField("project", nextProject ? `#${nextProject}` : "");
          }}
          onOpenFullEditor={
            onOpenFullEditor
              ? () => {
                  const built = buildTaskInput();
                  resetOrClose();
                  onOpenFullEditor(built.task);
                }
              : undefined
          }
          onCancel={resetOrClose}
        />
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
