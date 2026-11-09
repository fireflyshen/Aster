import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { taskDate } from "@core/tasks/quick-task";
import { formatDuration } from "@core/workspace/energy";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { addDays, format, nextMonday, nextSaturday } from "date-fns";
import {
  Armchair,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Ellipsis,
  Flag,
  ListPlus,
  MessageSquare,
  Pencil,
  Play,
  Repeat2,
  Square,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

const isoDue = (value: string) =>
  value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  );

function dueLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day =
    +local === +today
      ? "Today"
      : +local === +tomorrow
        ? "Tomorrow"
        : format(date, "MMM d");
  return (
    day +
    (date.getHours() || date.getMinutes()
      ? ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : "")
  );
}

const PRIORITIES = [
  {
    value: "H" as const,
    label: "Priority 1",
    short: "P1",
    iconClass: "fill-red-500/20 text-red-600 dark:text-red-400",
  },
  {
    value: "M" as const,
    label: "Priority 2",
    short: "P2",
    iconClass: "fill-amber-500/20 text-amber-600 dark:text-amber-400",
  },
  {
    value: "L" as const,
    label: "Priority 3",
    short: "P3",
    iconClass: "fill-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  {
    value: "" as const,
    label: "Priority 4",
    short: "None",
    iconClass: "text-muted-foreground",
  },
];

const SWIPE_EVENT = "aster:swipe-row";

export function TaskRow({
  task,
  completed,
  overdue,
  disabled,
  onEdit,
  onComplete,
  onToggleStart,
  onDueChange,
  onPriorityChange,
  onSaveInline,
  onDelete,
  projects = [],
  availableLabels = [],
  extraActions,
  trackedSeconds,
  timingUnavailable = false,
  showProject = true,
  transition,
  variant = "list",
}: {
  task: Task;
  completed: boolean;
  overdue: boolean;
  disabled: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onToggleStart?: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
  onSaveInline?: (input: TaskInput) => Promise<boolean>;
  onDelete?: () => void;
  projects?: string[];
  availableLabels?: SavedTag[];
  extraActions?: ReactNode;
  trackedSeconds?: number;
  timingUnavailable?: boolean;
  showProject?: boolean;
  variant?: "list" | "card";
  transition?: { checked: boolean; phase: "checking" | "leaving" };
}) {
  const checked = transition?.checked ?? completed;
  const started = !!task.start && !checked;
  const dueDay = task.due
    ? format(new Date(isoDue(task.due)), "yyyy-MM-dd")
    : "";
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const weekendStr = format(nextSaturday(now), "yyyy-MM-dd");
  const nextWeekStr = format(nextMonday(now), "yyyy-MM-dd");
  const isDueToday = dueDay === todayStr;
  const isDueTomorrow = dueDay === tomorrowStr;
  const firstNote = task.annotations[0]?.description?.trim() || "";

  const [editingInline, setEditingInline] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const rowRef = useRef<HTMLElement>(null);

  const hasMoreMenu = Boolean(
    !completed && (onDueChange || onPriorityChange || onSaveInline)
      ? true
      : onDelete,
  );
  const hasRightActions = Boolean(
    (!completed && (onSaveInline || onToggleStart || onDueChange || onPriorityChange)) ||
    hasMoreMenu ||
    extraActions,
  );
  const hasDetails = !!(
    (showProject && task.project) ||
    task.due ||
    task.recur ||
    task.annotations.length ||
    task.tags.length ||
    task.priority ||
    task.wait ||
    started ||
    (trackedSeconds ?? 0) > 0
  );

  useEffect(() => {
    if (!drawerPinned) return;
    const onOther = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (custom.detail !== task.uuid) setDrawerPinned(false);
    };
    const onPointerDownOutside = (event: globalThis.PointerEvent) => {
      if (
        rowRef.current &&
        event.target instanceof Node &&
        !rowRef.current.contains(event.target)
      ) {
        setDrawerPinned(false);
      }
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setDrawerPinned(false);
    };
    window.addEventListener(SWIPE_EVENT, onOther);
    window.addEventListener("pointerdown", onPointerDownOutside, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(SWIPE_EVENT, onOther);
      window.removeEventListener("pointerdown", onPointerDownOutside, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [drawerPinned, task.uuid]);

  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (disabled || variant !== "list" || editingInline) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return;
    if (event.deltaX > 18 && !drawerPinned) {
      window.dispatchEvent(new CustomEvent(SWIPE_EVENT, { detail: task.uuid }));
      setDrawerPinned(true);
    } else if (event.deltaX < -18 && drawerPinned) {
      setDrawerPinned(false);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      disabled ||
      editingInline ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      document.querySelector(
        '[role="dialog"], [role="alertdialog"], [data-state="open"][data-slot="popover-content"]',
      )
    )
      return;
    const key = event.key.toLowerCase();
    if (
      key === "j" ||
      event.key === "ArrowDown" ||
      key === "k" ||
      event.key === "ArrowUp"
    ) {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-task-row] [data-task-drag-surface]:not(:disabled)",
        ),
      );
      const current = event.currentTarget.querySelector<HTMLElement>(
        "[data-task-drag-surface]",
      );
      const index = current ? rows.indexOf(current) : -1;
      if (index === -1) return;
      const nextIndex =
        key === "j" || event.key === "ArrowDown"
          ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index - 1);
      if (nextIndex !== index) {
        event.preventDefault();
        rows[nextIndex]?.focus();
      }
      return;
    }
    if (key === "e" && !completed && onSaveInline) {
      event.preventDefault();
      setEditingInline(true);
      return;
    }
    if (key === "x") {
      event.preventDefault();
      onComplete();
      return;
    }
    if (key === "s" && !completed && onToggleStart) {
      event.preventDefault();
      onToggleStart();
      return;
    }
    if (key === "t" && !completed && onDueChange) {
      event.preventDefault();
      onDueChange(isDueToday ? tomorrowStr : todayStr);
      return;
    }
    if (
      (key === "1" || key === "2" || key === "3" || key === "0") &&
      !completed &&
      onPriorityChange
    ) {
      event.preventDefault();
      const map: Record<string, "H" | "M" | "L" | ""> = {
        "1": "H",
        "2": "M",
        "3": "L",
        "0": "",
      };
      onPriorityChange(map[key]);
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && onDelete) {
      event.preventDefault();
      onDelete();
    }
  }

  if (editingInline && onSaveInline) {
    return (
      <article
        ref={rowRef}
        data-task-row
        className="task-row min-w-0 flex-1 py-1"
      >
        <TodoistTaskComposer
          mode="edit"
          compact={variant === "list"}
          disabled={disabled}
          ariaLabel={`Edit task: ${task.description}`}
          placeholder="Task name"
          initialNotePreview={firstNote}
          initialValue={{
            description: task.description,
            project: task.project || "",
            priority: task.priority || "",
            tags: task.tags,
            due: task.due ? isoDue(task.due) : "",
            recur: task.recur,
            until: task.until ? taskDate(new Date(task.until)) : undefined,
            note: "",
          }}
          projects={projects}
          availableLabels={availableLabels}
          onSubmitTask={onSaveInline}
          onOpenFullEditor={() => {
            setEditingInline(false);
            onEdit();
          }}
          onCancel={() => setEditingInline(false)}
        />
      </article>
    );
  }

  const actionsVisible = drawerPinned || moreOpen || priorityPopoverOpen;

  return (
    <article
      ref={rowRef}
      data-task-row
      data-completion={transition?.phase}
      aria-busy={!!transition}
      onKeyDown={handleRowKeyDown}
      onWheel={handleWheel}
      className="task-row min-w-0 flex-1"
    >
      <div
        className={cn(
          "min-h-0",
          transition?.phase === "leaving" && "overflow-hidden",
        )}
      >
        <div
          data-task-surface
          data-variant={variant}
          className={cn(
            "group/row [&:has(:focus-visible)]:bg-(--row-hover)",
            variant === "list" &&
              "-mx-2.5 px-2.5 md:-mx-3 md:px-3 [.board-card_&]:mx-0 [.board-card_&]:px-0",
            actionsVisible && "bg-(--row-hover)",
          )}
        >
          <div
            className={cn(
              "grid items-start",
              hasRightActions
                ? "grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
                : "grid-cols-[2rem_minmax(0,1fr)] md:grid-cols-[1.75rem_minmax(0,1fr)]",
            )}
          >
            <Label
              htmlFor={`complete-${task.uuid}`}
              className={cn(
                "task-check-target group/check relative flex size-8 shrink-0 items-center justify-start self-start pt-3 md:size-7 md:pt-2",
                disabled ? "cursor-default" : "cursor-pointer",
              )}
            >
              <div className="relative flex size-[18px] items-center justify-center">
                <Checkbox
                  id={`complete-${task.uuid}`}
                  checked={checked}
                  disabled={disabled}
                  aria-label={`${completed ? "Reopen" : "Complete"}: ${task.description}`}
                  onCheckedChange={onComplete}
                  className={cn(
                    "task-complete size-[18px] rounded-full border-muted-foreground/60 bg-transparent shadow-none transition-all duration-150 focus-visible:ring-1 disabled:opacity-100 enabled:hover:border-foreground data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground",
                    !checked &&
                      task.priority === "H" &&
                      "border-red-500 bg-red-500/10 enabled:hover:border-red-600 enabled:hover:bg-red-500/20 dark:border-red-400",
                    !checked &&
                      task.priority === "M" &&
                      "border-amber-500 bg-amber-500/10 enabled:hover:border-amber-600 enabled:hover:bg-amber-500/20 dark:border-amber-400",
                    !checked &&
                      task.priority === "L" &&
                      "border-blue-500 bg-blue-500/10 enabled:hover:border-blue-600 enabled:hover:bg-blue-500/20 dark:border-blue-400",
                    checked &&
                      task.priority === "H" &&
                      "data-[state=checked]:border-red-500 data-[state=checked]:bg-red-500",
                    checked &&
                      task.priority === "M" &&
                      "data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500",
                    checked &&
                      task.priority === "L" &&
                      "data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500",
                  )}
                />
                {!checked && !disabled && (
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "task-check-preview pointer-events-none absolute inset-0 m-auto size-3 opacity-0 transition-opacity duration-150 group-hover/check:opacity-80",
                      task.priority === "H"
                        ? "text-red-600 dark:text-red-400"
                        : task.priority === "M"
                          ? "text-amber-600 dark:text-amber-400"
                          : task.priority === "L"
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-muted-foreground",
                    )}
                  />
                )}
              </div>
            </Label>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              data-task-drag-surface=""
              onClick={!completed && onSaveInline ? () => setEditingInline(true) : onEdit}
              className="flex h-auto min-h-11 min-w-0 w-full flex-col items-start justify-start gap-0 self-start rounded-sm px-0 py-3 text-left font-normal whitespace-normal hover:bg-transparent focus-visible:ring-1 disabled:opacity-100 md:min-h-8 md:py-1.5 dark:hover:bg-transparent"
            >
              <span
                data-task-title
                className={cn(
                  "block min-w-0 w-full text-sm leading-5 transition-colors duration-150 [overflow-wrap:anywhere]",
                  checked &&
                    "text-muted-foreground line-through decoration-muted-foreground/60",
                )}
              >
                {task.description}
              </span>
              {firstNote && (
                <span
                  data-task-note-preview
                  className="mt-0.5 block min-w-0 w-full truncate text-xs leading-4 text-muted-foreground/80"
                >
                  {firstNote}
                </span>
              )}
              {hasDetails && (
                <span
                  data-task-details
                  className="mt-1 flex min-w-0 w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]"
                >
                  {showProject && task.project && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <ProjectIcon
                        name={task.project}
                        className="size-3 shrink-0"
                      />
                      <span className="truncate">{task.project}</span>
                    </span>
                  )}
                  {(started || (trackedSeconds ?? 0) > 0) && (
                    <span
                      className={cn(
                        "flex items-center gap-1 tabular-nums",
                        started && "font-medium text-foreground",
                      )}
                    >
                      <Clock3 className="size-3" strokeWidth={1.5} />
                      {started
                        ? timingUnavailable
                          ? "Active · time unavailable"
                          : `Active · ${formatDuration(trackedSeconds || 0)}`
                        : formatDuration(trackedSeconds || 0)}
                    </span>
                  )}
                  {task.due && (
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        !checked &&
                          (overdue
                            ? "font-medium text-red-600 dark:text-red-400"
                            : isDueToday
                              ? "font-medium text-emerald-600 dark:text-emerald-400"
                              : isDueTomorrow
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-violet-600 dark:text-violet-400"),
                      )}
                    >
                      <CalendarDays className="size-3" strokeWidth={1.6} />
                      {overdue && !checked && "Overdue · "}
                      {dueLabel(task.due)}
                    </span>
                  )}
                  {!!task.wait &&
                    new Date(task.wait) > new Date() &&
                    !checked && (
                      <span className="flex items-center gap-1">
                        <Clock3 className="size-3" strokeWidth={1.5} />
                        Waiting · {dueLabel(task.wait)}
                      </span>
                    )}
                  {!!task.recur && (
                    <span
                      className="flex items-center gap-1"
                      aria-label={`Repeats ${task.recur}`}
                    >
                      <Repeat2 className="size-3" strokeWidth={1.5} />
                      {task.recur}
                    </span>
                  )}
                  {!!task.annotations.length && (
                    <span
                      className="flex items-center gap-1"
                      aria-label={`${task.annotations.length} notes`}
                    >
                      <MessageSquare className="size-3" strokeWidth={1.5} />
                      {task.annotations.length}
                    </span>
                  )}
                  {task.priority && (
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        !checked &&
                          (task.priority === "H"
                            ? "text-red-600 dark:text-red-400"
                            : task.priority === "M"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-blue-600 dark:text-blue-400"),
                      )}
                    >
                      <Flag className="size-3" strokeWidth={1.6} />
                      {
                        (
                          {
                            H: "P1",
                            M: "P2",
                            L: "P3",
                          } as Record<string, string>
                        )[task.priority]
                      }
                    </span>
                  )}
                  {task.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex min-w-0 items-center gap-1 rounded-[4px] bg-muted/60 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <LabelIcon
                        className="size-2.5 shrink-0 opacity-70"
                        strokeWidth={1.6}
                      />
                      <span className="truncate">{tag}</span>
                    </span>
                  ))}
                </span>
              )}
            </Button>
            {hasRightActions && (
              <div
                data-no-drag
                className="flex h-11 items-center gap-0.5 pl-1 md:h-8"
              >
                {extraActions}
                {!completed && onSaveInline && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`Edit task inline: ${task.description}`}
                    title="Edit inline (E)"
                    onClick={() => setEditingInline(true)}
                    className={cn(
                      "size-7 text-muted-foreground transition-opacity hover:text-foreground",
                      actionsVisible
                        ? "opacity-100"
                        : "opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100",
                    )}
                  >
                    <Pencil className="size-3.5" strokeWidth={1.6} />
                  </Button>
                )}
                {!completed && onDueChange && (
                  <DatePicker
                    id={`due-${task.uuid}`}
                    value={dueDay}
                    disabled={disabled}
                    align="end"
                    ariaLabel={`Due date: ${task.description}`}
                    onChange={onDueChange}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={`Set due date: ${task.description}`}
                        title={
                          task.due
                            ? `Due ${dueLabel(task.due)} — click to change`
                            : "Choose due date"
                        }
                        className={cn(
                          "size-7 text-muted-foreground transition-opacity hover:text-foreground",
                          actionsVisible
                            ? "opacity-100"
                            : "opacity-70 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100 data-[state=open]:opacity-100",
                        )}
                      >
                        <CalendarDays className="size-3.5" strokeWidth={1.6} />
                      </Button>
                    }
                  />
                )}
                {!completed && onPriorityChange && (
                  <Popover open={priorityPopoverOpen} onOpenChange={setPriorityPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={`Set priority: ${task.description}`}
                        title={
                          task.priority
                            ? `Priority ${task.priority === "H" ? "1" : task.priority === "M" ? "2" : "3"}`
                            : "Set priority"
                        }
                        className={cn(
                          "size-7 text-muted-foreground transition-opacity hover:text-foreground",
                          actionsVisible
                            ? "opacity-100"
                            : "opacity-70 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100 data-[state=open]:opacity-100",
                        )}
                      >
                        <Flag
                          className={cn(
                            "size-3.5",
                            task.priority === "H" &&
                              "fill-red-500/20 text-red-600 dark:text-red-400",
                            task.priority === "M" &&
                              "fill-amber-500/20 text-amber-600 dark:text-amber-400",
                            task.priority === "L" &&
                              "fill-blue-500/20 text-blue-600 dark:text-blue-400",
                            !task.priority && "text-muted-foreground",
                          )}
                          strokeWidth={1.6}
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-36 p-1">
                      {PRIORITIES.map((item) => (
                        <Button
                          key={item.label}
                          type="button"
                          variant="navigation"
                          className="h-8 justify-between px-2 text-xs font-normal"
                          onClick={() => {
                            setPriorityPopoverOpen(false);
                            onPriorityChange(item.value);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Flag className={cn("size-3.5", item.iconClass)} />
                            <span>{item.label}</span>
                          </span>
                          {(task.priority || "") === item.value && (
                            <Check className="size-3 text-foreground" />
                          )}
                        </Button>
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
                {!completed && onToggleStart && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || (!started && timingUnavailable)}
                    aria-label={`${started ? "Stop" : "Start"}: ${task.description}`}
                    title={
                      !started && timingUnavailable
                        ? "Timer data unavailable. Refresh to start."
                        : started
                          ? "Stop timer"
                          : "Start timer"
                    }
                    onClick={onToggleStart}
                    className={cn(
                      "size-7 text-muted-foreground transition-opacity hover:text-foreground",
                      started || actionsVisible
                        ? "text-foreground opacity-100"
                        : "opacity-70 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100",
                    )}
                  >
                    {started ? (
                      <Square className="size-3 fill-current" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </Button>
                )}
                {hasMoreMenu && (
                  <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={`More actions: ${task.description}`}
                        title="More actions"
                        className={cn(
                          "size-7 text-muted-foreground transition-opacity hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
                          actionsVisible
                            ? "opacity-100"
                            : "opacity-70 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100 data-[state=open]:opacity-100",
                        )}
                      >
                        <Ellipsis className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      collisionPadding={12}
                      className="w-56 p-1.5"
                    >
                      {!completed && onDueChange && (
                        <div className="border-b border-border/60 px-1.5 pt-1 pb-2">
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                            <span>Date</span>
                            <span className="font-normal">
                              {task.due ? dueLabel(task.due) : "No date"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <Button
                              type="button"
                              variant={isDueToday ? "secondary" : "ghost"}
                              size="icon-xs"
                              title="Today"
                              aria-label="Schedule today"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(todayStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <Sun className="size-4 text-emerald-500" />
                            </Button>
                            <Button
                              type="button"
                              variant={isDueTomorrow ? "secondary" : "ghost"}
                              size="icon-xs"
                              title="Tomorrow"
                              aria-label="Schedule tomorrow"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(tomorrowStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <Sunrise className="size-4 text-amber-500" />
                            </Button>
                            <Button
                              type="button"
                              variant={
                                dueDay === weekendStr ? "secondary" : "ghost"
                              }
                              size="icon-xs"
                              title="This weekend"
                              aria-label="Schedule this weekend"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(weekendStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <Armchair className="size-4 text-blue-500" />
                            </Button>
                            <Button
                              type="button"
                              variant={
                                dueDay === nextWeekStr ? "secondary" : "ghost"
                              }
                              size="icon-xs"
                              title="Next week"
                              aria-label="Schedule next week"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(nextWeekStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <ArrowRight className="size-4 text-violet-500" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              disabled={!task.due}
                              title="No date"
                              aria-label="Clear due date"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange("");
                              }}
                              className="size-8 rounded-md text-muted-foreground"
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                      {!completed && onPriorityChange && (
                        <div className="border-b border-border/60 px-1.5 pt-2 pb-2">
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                            <span>Priority</span>
                            <span className="font-normal">
                              {task.priority === "H"
                                ? "P1"
                                : task.priority === "M"
                                  ? "P2"
                                  : task.priority === "L"
                                    ? "P3"
                                    : "P4"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            {[
                              {
                                val: "H" as const,
                                label: "Priority 1",
                                cls: "fill-red-500/20 text-red-600 dark:text-red-400",
                              },
                              {
                                val: "M" as const,
                                label: "Priority 2",
                                cls: "fill-amber-500/20 text-amber-600 dark:text-amber-400",
                              },
                              {
                                val: "L" as const,
                                label: "Priority 3",
                                cls: "fill-blue-500/20 text-blue-600 dark:text-blue-400",
                              },
                              {
                                val: "" as const,
                                label: "Priority 4",
                                cls: "text-muted-foreground",
                              },
                            ].map((item) => (
                              <Button
                                key={item.label}
                                type="button"
                                variant={
                                  (task.priority || "") === item.val
                                    ? "secondary"
                                    : "ghost"
                                }
                                size="icon-xs"
                                title={item.label}
                                aria-label={item.label}
                                onClick={() => {
                                  setMoreOpen(false);
                                  onPriorityChange(item.val);
                                }}
                                className="size-8 rounded-md"
                              >
                                <Flag className={cn("size-4", item.cls)} />
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="pt-1">
                        {!completed && onSaveInline && (
                          <Button
                            type="button"
                            variant="navigation"
                            className="h-8 text-xs font-normal"
                            onClick={() => {
                              setMoreOpen(false);
                              setEditingInline(true);
                            }}
                          >
                            <Pencil className="size-3.5" />
                            Edit task inline
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="navigation"
                          className="h-8 text-xs font-normal"
                          onClick={() => {
                            setMoreOpen(false);
                            onEdit();
                          }}
                        >
                          <ListPlus className="size-3.5" />
                          Notes & full details…
                        </Button>
                        {onDelete && (
                          <Button
                            type="button"
                            variant="navigation"
                            aria-label={`Delete task: ${task.description}`}
                            className="h-8 text-xs font-normal text-destructive hover:text-destructive"
                            onClick={() => {
                              setMoreOpen(false);
                              onDelete();
                            }}
                          >
                            <Trash2 className="size-3.5" />
                            Delete task
                          </Button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
