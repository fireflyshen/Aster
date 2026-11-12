import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { DatePicker } from "@/features/tasks/date-picker";
import { LabelsPicker } from "@/features/tasks/labels-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import {
  parseQuickTask,
  taskDate,
  type QuickToken,
} from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import {
  CalendarDays,
  Check,
  CornerDownLeft,
  Flag,
  Hash,
  ListPlus,
  Plus,
  Tag,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

const isoDate = (value: string) =>
  value
    .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:00Z")
    .replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z",
    );

const toDayString = (raw: string | undefined): string => {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try {
    return format(new Date(isoDate(raw)), "yyyy-MM-dd");
  } catch {
    return "";
  }
};

const PRIORITIES: {
  value: "H" | "M" | "L" | "";
  label: string;
  short: string;
  iconClass: string;
  chipClass: string;
}[] = [
  {
    value: "H",
    label: "Priority 1",
    short: "P1",
    iconClass: "fill-red-500/20 text-red-600 dark:text-red-400",
    chipClass:
      "border-red-500/35 bg-red-500/8 text-red-600 hover:bg-red-500/14 dark:text-red-400",
  },
  {
    value: "M",
    label: "Priority 2",
    short: "P2",
    iconClass: "fill-amber-500/20 text-amber-600 dark:text-amber-400",
    chipClass:
      "border-amber-500/35 bg-amber-500/8 text-amber-600 hover:bg-amber-500/14 dark:text-amber-400",
  },
  {
    value: "L",
    label: "Priority 3",
    short: "P3",
    iconClass: "fill-blue-500/20 text-blue-600 dark:text-blue-400",
    chipClass:
      "border-blue-500/35 bg-blue-500/8 text-blue-600 hover:bg-blue-500/14 dark:text-blue-400",
  },
  {
    value: "",
    label: "Priority 4",
    short: "Priority",
    iconClass: "text-muted-foreground",
    chipClass: "border-input text-muted-foreground",
  },
];

export function TodoistTaskComposer({
  mode = "add",
  compact = true,
  disabled = false,
  ariaLabel = "Add task",
  placeholder = "Task name",
  defaultProject = "",
  defaultDue = "",
  initialValue,
  initialNotePreview = "",
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
  initialValue?: TaskInput;
  initialNotePreview?: string;
  projects?: string[];
  availableLabels?: SavedTag[];
  onSubmitTask?: (task: TaskInput) => Promise<boolean>;
  onOpenFullEditor?: (draft?: TaskInput) => void;
  onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(mode === "edit");
  const [title, setTitle] = useState(initialValue?.description || "");
  const [note, setNote] = useState(initialValue?.note || "");

  // Manual overrides set explicitly via the buttons/chips
  const [manualDue, setManualDue] = useState<string | null | undefined>(
    undefined,
  );
  const [manualPriority, setManualPriority] = useState<
    "H" | "M" | "L" | "" | undefined
  >(undefined);
  const [manualProject, setManualProject] = useState<string | undefined>(
    undefined,
  );
  const [manualTags, setManualTags] = useState<string[] | undefined>(
    initialValue?.tags,
  );

  const [priorityOpen, setPriorityOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Parse natural language expressions in real time
  const parsed = useMemo(() => parseQuickTask(title), [title]);

  const dueToken = parsed.tokens.find((t) => t.kind === "due" && !t.ignored);
  const priorityToken = parsed.tokens.find(
    (t) => t.kind === "priority" && !t.ignored,
  );
  const projectToken = parsed.tokens.find(
    (t) => t.kind === "project" && !t.ignored,
  );
  const tagTokens = parsed.tokens.filter((t) => t.kind === "tag" && !t.ignored);

  // Active resolved values:
  // Natural language tokens typed in the input take immediate precedence over defaults
  const activeDueDay: string = useMemo(() => {
    if (dueToken) {
      return toDayString(dueToken.value);
    }
    if (manualDue !== undefined) {
      return manualDue || "";
    }
    if (initialValue?.due) {
      return toDayString(initialValue.due);
    }
    if (defaultDue) {
      return toDayString(defaultDue);
    }
    return "";
  }, [dueToken, manualDue, initialValue?.due, defaultDue]);

  const activePriority: "H" | "M" | "L" | "" = useMemo(() => {
    if (priorityToken) {
      return (priorityToken.value as "H" | "M" | "L" | "") || "";
    }
    if (manualPriority !== undefined) {
      return manualPriority;
    }
    return (initialValue?.priority as "H" | "M" | "L" | "") || "";
  }, [priorityToken, manualPriority, initialValue?.priority]);

  const activeProject: string = useMemo(() => {
    if (projectToken) {
      return projectToken.value;
    }
    if (manualProject !== undefined) {
      return manualProject;
    }
    return initialValue?.project ?? defaultProject ?? "";
  }, [projectToken, manualProject, initialValue?.project, defaultProject]);

  const activeTags: string[] = useMemo(() => {
    const base = manualTags ?? initialValue?.tags ?? [];
    const fromTitle = tagTokens.map((t) => t.value);
    return Array.from(new Set([...base, ...fromTitle]));
  }, [manualTags, initialValue?.tags, tagTokens]);

  // Autocomplete matching for '#' and '@'
  const triggerMatch = /(?:^|\s)(#|@)([^\s]*)$/.exec(title);
  const triggerKind = triggerMatch ? triggerMatch[1] : null;
  const triggerQuery = triggerMatch ? triggerMatch[2].toLowerCase() : "";

  const projectSuggestions = useMemo(() => {
    if (triggerKind !== "#") return [];
    return projects
      .filter((p) => p.toLowerCase().includes(triggerQuery))
      .slice(0, 6);
  }, [triggerKind, projects, triggerQuery]);

  const labelSuggestions = useMemo(() => {
    if (triggerKind !== "@") return [];
    return availableLabels
      .filter((l) => l.name.toLowerCase().includes(triggerQuery))
      .slice(0, 6);
  }, [triggerKind, availableLabels, triggerQuery]);

  function applySuggestion(tokenValue: string, kind: "#" | "@") {
    if (!triggerMatch) return;
    const matchIndex =
      triggerMatch.index + (triggerMatch[0].startsWith(" ") ? 1 : 0);
    const replacement = `${kind}${tokenValue.includes(" ") ? `"${tokenValue}"` : tokenValue} `;
    const next = title.slice(0, matchIndex) + replacement;
    setTitle(next);
    if (kind === "#") {
      setManualProject(tokenValue);
    }
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function removeToken(token: QuickToken) {
    const next = (title.slice(0, token.start) + title.slice(token.end))
      .replace(/\s{2,}/g, " ")
      .trim();
    setTitle(next);
    if (token.kind === "due") setManualDue(null);
    if (token.kind === "priority") setManualPriority("");
    if (token.kind === "project") setManualProject("");
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function setField(kind: QuickToken["kind"], expression: string) {
    const matches = parsed.tokens.filter((t) => t.kind === kind && !t.ignored);
    let value = title;
    for (const token of [...matches].reverse()) {
      value = value.slice(0, token.start) + value.slice(token.end);
    }
    const clean = value.replace(/\s{2,}/g, " ").trimEnd();
    setTitle(
      clean ? (expression ? `${clean} ${expression}` : clean) : expression,
    );
  }

  function buildTaskInput(): { task: TaskInput; error?: string } {
    if (parsed.errors.length) {
      return { task: parsed.task, error: parsed.errors[0] };
    }

    const cleanTitle = (
      parsed.tokens.length > 0 ? parsed.task.description : title
    )
      .replace(/[\r\n]+/g, " ")
      .trim();

    if (!cleanTitle) {
      return {
        task: {
          description: "",
          project: activeProject,
          priority: activePriority,
          tags: activeTags,
          due: "",
          note: note.trim(),
        },
        error: "Enter a task name.",
      };
    }

    let resolvedDue = "";
    if (dueToken) {
      resolvedDue = dueToken.value;
    } else if (activeDueDay) {
      const existingIso = initialValue?.due ? isoDate(initialValue.due) : "";
      const existingDay = existingIso ? toDayString(existingIso) : "";
      if (existingDay === activeDueDay && existingIso) {
        resolvedDue = taskDate(new Date(existingIso));
      } else {
        resolvedDue = taskDate(new Date(`${activeDueDay}T00:00:00`));
      }
    }

    return {
      task: {
        description: cleanTitle,
        project: activeProject,
        priority: activePriority,
        tags: activeTags,
        due: resolvedDue,
        recur: initialValue?.recur,
        until: initialValue?.until,
        note: note.trim() || undefined,
      },
    };
  }

  function resetOrClose() {
    setTitle("");
    setNote("");
    setManualDue(undefined);
    setManualPriority(undefined);
    setManualProject(undefined);
    setManualTags(undefined);
    setError("");
    setEditing(false);
    onCancel?.();
  }

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
        setError("Enter a task name.");
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
          setTitle("");
          setNote("");
          setManualDue(undefined);
          setManualPriority(undefined);
          setManualProject(undefined);
          setManualTags(undefined);
          setError("");
          requestAnimationFrame(() => titleRef.current?.focus());
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const activePriorityItem =
    PRIORITIES.find((item) => item.value === activePriority) || PRIORITIES[3];

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
          setError("");
          setManualDue(undefined);
          setManualPriority(undefined);
          setManualProject(undefined);
          setManualTags(undefined);
          setEditing(true);
          requestAnimationFrame(() => titleRef.current?.focus());
        }}
        className={
          compact
            ? "task-add-button group/add"
            : "mt-1 flex h-9 w-full items-center justify-start gap-2 rounded-lg px-2.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-(--row-hover) hover:text-foreground has-[>svg]:px-2.5"
        }
      >
        <Plus
          className={cn(
            compact ? "size-[18px]" : "size-4",
            "text-primary/85 transition-transform duration-150 group-hover/add:scale-110",
          )}
          strokeWidth={1.75}
        />
        Add task
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
      <div className="task-composer-shell rounded-lg border border-input bg-card p-3 transition-colors focus-within:border-ring">
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

          {/* Autocomplete suggestion popup for # and @ */}
          {(projectSuggestions.length > 0 || labelSuggestions.length > 0) && (
            <div className="absolute top-7 left-0 z-30 min-w-44 rounded-lg border border-border/70 bg-popover p-1 shadow-md">
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
                el.style.height = `${Math.max(26, el.scrollHeight)}px`;
              }
            }}
            value={note}
            disabled={disabled || submitting}
            aria-label={
              mode === "edit"
                ? "Add a note to task"
                : "Task description or note"
            }
            placeholder={
              mode === "edit"
                ? initialNotePreview
                  ? `Note: ${initialNotePreview}`
                  : "Add a note or description…"
                : "Description"
            }
            onInput={(event) => {
              const el = event.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.max(26, el.scrollHeight)}px`;
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

        {/* Real-time recognized tokens badges */}
        {parsed.tokens.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2 text-[11px]">
            {parsed.tokens.map((token) => (
              <span
                key={token.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors",
                  token.kind === "due" &&
                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  token.kind === "priority" &&
                    "bg-red-500/10 text-red-600 dark:text-red-400",
                  token.kind === "project" &&
                    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                  token.kind === "tag" &&
                    "bg-violet-500/10 text-violet-600 dark:text-violet-400",
                )}
              >
                {token.kind === "due" && <CalendarDays className="size-3" />}
                {token.kind === "priority" && <Flag className="size-3" />}
                {token.kind === "project" && <Hash className="size-3" />}
                {token.kind === "tag" && <Tag className="size-3" />}
                <span>{token.label}</span>
                <button
                  type="button"
                  onClick={() => removeToken(token)}
                  title={`Remove ${token.label}`}
                  className="hover:text-destructive"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Action Toolbar */}
        <div className="task-composer-toolbar mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <DatePicker
              id={`composer-due-${mode}`}
              compact
              value={activeDueDay}
              disabled={disabled || submitting}
              returnFocus={() => titleRef.current?.focus()}
              onChange={(nextDay) => {
                setManualDue(nextDay || null);
                if (!nextDay && dueToken) {
                  removeToken(dueToken);
                } else if (nextDay) {
                  setField("due", nextDay);
                }
              }}
            />

            <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || submitting}
                  aria-label="Priority"
                  className={cn(
                    "h-8 gap-1.5 rounded-[5px] px-2 py-0 text-[13px] font-normal shadow-none has-[>svg]:px-2 md:h-7",
                    activePriorityItem.chipClass,
                  )}
                >
                  <Flag
                    className={cn(
                      "size-3.5 shrink-0",
                      activePriorityItem.iconClass,
                    )}
                  />
                  <span>{activePriorityItem.short}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-40 p-1"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  titleRef.current?.focus();
                }}
              >
                {PRIORITIES.map((item) => (
                  <Button
                    key={item.label}
                    type="button"
                    variant="navigation"
                    className="h-8 justify-between px-2 text-xs font-normal"
                    onClick={() => {
                      setManualPriority(item.value);
                      setPriorityOpen(false);
                      const pWord = item.value
                        ? { H: "p1", M: "p2", L: "p3" }[item.value] || ""
                        : "";
                      setField("priority", pWord);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Flag className={cn("size-3.5", item.iconClass)} />
                      <span>{item.label}</span>
                    </span>
                    {activePriority === item.value && (
                      <Check className="size-3.5 text-foreground" />
                    )}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>

            {availableLabels.length > 0 && (
              <LabelsPicker
                id={`composer-tags-${mode}`}
                compact
                value={activeTags}
                choices={availableLabels}
                disabled={disabled || submitting}
                returnFocus={() => titleRef.current?.focus()}
                onChange={(nextTags) => {
                  setManualTags(nextTags);
                }}
              />
            )}

            {projects.length > 0 && (
              <ProjectPicker
                id={`composer-project-${mode}`}
                compact
                value={activeProject}
                projects={projects}
                disabled={disabled || submitting}
                returnFocus={() => titleRef.current?.focus()}
                onChange={(nextProject) => {
                  setManualProject(nextProject);
                  setField("project", nextProject ? `#${nextProject}` : "");
                }}
              />
            )}

            {onOpenFullEditor && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled || submitting}
                title="Open full task editor (⌘E)"
                aria-label="Open full task editor"
                onClick={() => {
                  const built = buildTaskInput();
                  resetOrClose();
                  onOpenFullEditor(built.task);
                }}
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <ListPlus className="size-3.5" />
              </Button>
            )}
          </div>

          <div className="task-composer-actions ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={submitting}
              aria-label={
                mode === "edit" ? "Cancel editing task" : "Cancel adding task"
              }
              onClick={resetOrClose}
              className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <X className={cn("size-3.5", mode !== "edit" && "sm:hidden")} />
              {mode !== "edit" && (
                <span className="hidden sm:inline">Cancel</span>
              )}
            </Button>
            <Button
              type="submit"
              size="xs"
              disabled={disabled || submitting || !title.trim()}
              aria-label={mode === "edit" ? "Save task" : "Add task"}
              className="h-7 gap-1 rounded-md px-2.5 text-xs font-medium shadow-none"
            >
              {submitting ? (
                <Spinner className="size-3" />
              ) : mode === "edit" ? (
                <Check className="size-4" />
              ) : (
                <>
                  Add task
                  <CornerDownLeft className="size-3 opacity-75" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
