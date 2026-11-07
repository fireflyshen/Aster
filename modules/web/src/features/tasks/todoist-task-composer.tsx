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
import { parseQuickTask, taskDate } from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import {
  Check,
  CornerDownLeft,
  Flag,
  ListPlus,
  Plus,
  X,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

const isoDate = (value: string) =>
  value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  );

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
  const [dueDay, setDueDay] = useState(() => {
    const raw = initialValue?.due || defaultDue;
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    try {
      return format(new Date(isoDate(raw)), "yyyy-MM-dd");
    } catch {
      return "";
    }
  });
  const [priority, setPriority] = useState<"H" | "M" | "L" | "">(
    initialValue?.priority === "H" ||
      initialValue?.priority === "M" ||
      initialValue?.priority === "L"
      ? initialValue.priority
      : "",
  );
  const [project, setProject] = useState(
    initialValue?.project ?? defaultProject,
  );
  const [tags, setTags] = useState<string[]>(initialValue?.tags || []);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

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
          setProject(defaultProject);
          setDueDay(
            defaultDue && /^\d{4}-\d{2}-\d{2}$/.test(defaultDue)
              ? defaultDue
              : defaultDue
                ? format(new Date(isoDate(defaultDue)), "yyyy-MM-dd")
                : "",
          );
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

  function buildTaskInput(): { task: TaskInput; error?: string } {
    if (mode === "edit") {
      const cleanTitle = title.replace(/[\r\n]+/g, " ").trim();
      if (!cleanTitle) {
        return {
          task: {
            description: "",
            project,
            priority,
            tags,
            due: "",
            note: note.trim(),
          },
          error: "Enter a task name.",
        };
      }
      const existingIso = initialValue?.due ? isoDate(initialValue.due) : "";
      const existingDay = existingIso
        ? format(new Date(existingIso), "yyyy-MM-dd")
        : "";
      const resolvedDue = dueDay
        ? existingDay === dueDay && existingIso
          ? taskDate(new Date(existingIso))
          : taskDate(new Date(`${dueDay}T00:00:00`))
        : "";
      return {
        task: {
          description: cleanTitle,
          project,
          priority,
          tags,
          due: resolvedDue,
          recur: initialValue?.recur,
          until: initialValue?.until,
          note: note.trim(),
        },
      };
    }

    const parsed = parseQuickTask(title);
    if (parsed.errors.length) {
      return { task: parsed.task, error: parsed.errors[0] };
    }
    const resolvedDue = dueDay
      ? taskDate(new Date(`${dueDay}T00:00:00`))
      : parsed.task.due || "";
    const mergedTags = [
      ...new Set([...tags, ...(parsed.task.tags || [])]),
    ];
    return {
      task: {
        ...parsed.task,
        description: parsed.task.description.trim(),
        project: parsed.task.project || project || defaultProject,
        priority: parsed.task.priority || priority,
        due: resolvedDue,
        tags: mergedTags,
        note: note.trim() || undefined,
      },
    };
  }

  function resetOrClose() {
    setTitle("");
    setNote("");
    setPriority("");
    setTags([]);
    setDueDay(
      defaultDue && /^\d{4}-\d{2}-\d{2}$/.test(defaultDue)
        ? defaultDue
        : defaultDue
          ? format(new Date(isoDate(defaultDue)), "yyyy-MM-dd")
          : "",
    );
    setProject(defaultProject);
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
          setError("");
          requestAnimationFrame(() => titleRef.current?.focus());
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const activePriority =
    PRIORITIES.find((item) => item.value === priority) || PRIORITIES[3];

  return (
    <form
      onSubmit={submit}
      data-todoist-composer={mode}
      className={cn(compact ? "my-1.5" : "mt-1.5")}
    >
      <div className="rounded-xl border border-ring/40 bg-card p-3 shadow-[0_2px_10px_rgb(0_0_0/0.04)] transition-colors">
        <div className="space-y-1">
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
            className="w-full bg-transparent text-sm leading-5 font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
          />
          <input
            type="text"
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
                  ? `Note: ${initialNotePreview} (type to add new note…)`
                  : "Add a note or description…"
                : "Description"
            }
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                resetOrClose();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="w-full bg-transparent text-xs leading-5 text-muted-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <DatePicker
              id={`composer-due-${mode}`}
              compact
              value={dueDay}
              disabled={disabled || submitting}
              returnFocus={() => titleRef.current?.focus()}
              onChange={setDueDay}
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
                    activePriority.chipClass,
                  )}
                >
                  <Flag
                    className={cn("size-3.5 shrink-0", activePriority.iconClass)}
                  />
                  <span>{activePriority.short}</span>
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
                      setPriority(item.value);
                      setPriorityOpen(false);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Flag className={cn("size-3.5", item.iconClass)} />
                      <span>{item.label}</span>
                    </span>
                    {priority === item.value && (
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
                value={tags}
                choices={availableLabels}
                disabled={disabled || submitting}
                returnFocus={() => titleRef.current?.focus()}
                onChange={setTags}
              />
            )}

            {projects.length > 0 && (
              <ProjectPicker
                id={`composer-project-${mode}`}
                compact
                value={project}
                projects={projects}
                disabled={disabled || submitting}
                returnFocus={() => titleRef.current?.focus()}
                onChange={setProject}
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

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
              <X className="size-3.5 sm:hidden" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
            <Button
              type="submit"
              size="xs"
              disabled={disabled || submitting || !title.trim()}
              className="h-7 gap-1 rounded-md px-2.5 text-xs font-medium shadow-none"
            >
              {submitting ? (
                <Spinner className="size-3" />
              ) : mode === "edit" ? (
                "Save"
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
