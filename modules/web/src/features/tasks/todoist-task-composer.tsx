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
import { PRIORITIES, priorityOption } from "@/features/tasks/task-constants";
import { isoDue, toDueDay } from "@/features/tasks/task-date";
import {
  parseQuickTask,
  taskDate,
  type QuickToken,
} from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { cn } from "cn";
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
  const [editing, setEditing] = useState(mode === "edit");
  const [title, setTitle] = useState(initialValue?.description || "");
  const [note, setNote] = useState(
    initialDescription || initialValue?.taskDescription || "",
  );

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

  const parsed = useMemo(() => parseQuickTask(title), [title]);

  const dueToken = parsed.tokens.find((t) => t.kind === "due" && !t.ignored);
  const priorityToken = parsed.tokens.find(
    (t) => t.kind === "priority" && !t.ignored,
  );
  const projectToken = parsed.tokens.find(
    (t) => t.kind === "project" && !t.ignored,
  );
  const tagTokens = parsed.tokens.filter((t) => t.kind === "tag" && !t.ignored);

  const activeDueDay: string = useMemo(() => {
    if (dueToken) return toDueDay(dueToken.value);
    if (manualDue !== undefined) return manualDue || "";
    if (initialValue?.due) return toDueDay(initialValue.due);
    if (defaultDue) return toDueDay(defaultDue);
    return "";
  }, [dueToken, manualDue, initialValue?.due, defaultDue]);

  const activePriority: "H" | "M" | "L" | "" = useMemo(() => {
    if (priorityToken)
      return (priorityToken.value as "H" | "M" | "L" | "") || "";
    if (manualPriority !== undefined) return manualPriority;
    return (initialValue?.priority as "H" | "M" | "L" | "") || "";
  }, [priorityToken, manualPriority, initialValue?.priority]);

  const activeProject: string = useMemo(() => {
    if (projectToken) return projectToken.value;
    if (manualProject !== undefined) return manualProject;
    return initialValue?.project ?? defaultProject ?? "";
  }, [projectToken, manualProject, initialValue?.project, defaultProject]);

  const activeTags: string[] = useMemo(() => {
    const base = manualTags ?? initialValue?.tags ?? [];
    const fromTitle = tagTokens.map((t) => t.value);
    return Array.from(new Set([...base, ...fromTitle]));
  }, [manualTags, initialValue?.tags, tagTokens]);

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
    setTitle(title.slice(0, matchIndex) + replacement);
    if (kind === "#") setManualProject(tokenValue);
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

  function buildTaskInput(): {
    task: TaskInput & { taskDescription?: string };
    error?: string;
  } {
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
        error: "请输入任务名称。",
      };
    }

    let resolvedDue = "";
    if (dueToken) {
      resolvedDue = dueToken.value;
    } else if (activeDueDay) {
      const existingIso = initialValue?.due ? isoDue(initialValue.due) : "";
      const existingDay = existingIso ? toDueDay(existingIso) : "";
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
        note: undefined,
        taskDescription: note.trim() || undefined,
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

  const activePriorityItem = priorityOption(activePriority);

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
      <div className="task-composer-shell rounded-[10px] border border-border bg-card p-3 transition-colors shadow-xs focus-within:border-ring/60 animate-in fade-in-0 zoom-in-98 duration-150 ease-out">
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

        {parsed.tokens.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[11px]">
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
                  title={`移除 ${token.label}`}
                  className="hover:text-destructive"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

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
                  aria-label="优先级"
                  className={cn(
                    "h-8 gap-1.5 rounded-[6px] px-2 py-0 text-[12px] font-normal shadow-none has-[>svg]:px-2 md:h-7",
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
                      setField("priority", item.value ? item.quickWord : "");
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
                onChange={setManualTags}
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
                title="打开完整任务编辑 (⌘E)"
                aria-label="打开完整任务编辑"
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
              variant="secondary"
              size="xs"
              disabled={submitting}
              aria-label={mode === "edit" ? "取消编辑任务" : "取消添加任务"}
              onClick={resetOrClose}
              className="h-8 rounded-md px-3 text-[13px] font-medium cursor-pointer"
            >
              <X className={cn("size-3.5", mode !== "edit" && "sm:hidden")} />
              {mode !== "edit" && (
                <span className="hidden sm:inline">取消</span>
              )}
            </Button>
            <Button
              type="submit"
              size="xs"
              disabled={disabled || submitting || !title.trim()}
              aria-label={mode === "edit" ? "保存任务" : "添加任务"}
              className="h-8 gap-1 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-45 cursor-pointer"
            >
              {submitting ? (
                <Spinner className="size-3" />
              ) : mode === "edit" ? (
                <Check className="size-4" />
              ) : (
                <>
                  添加任务
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
