import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { formatDuration } from "@core/workspace/energy";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import {
  CalendarDays,
  Check,
  Clock3,
  Flag,
  Play,
  Square,
  Repeat2,
  MessageSquare,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

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
export function TaskRow({
  task,
  completed,
  overdue,
  disabled,
  onEdit,
  onComplete,
  onToggleStart,
  onDueChange,
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
  extraActions?: ReactNode;
  trackedSeconds?: number;
  timingUnavailable?: boolean;
  showProject?: boolean;
  variant?: "list" | "card";
  transition?: { checked: boolean; phase: "checking" | "leaving" };
}) {
  const checked = transition?.checked ?? completed;
  const started = !!task.start && !checked;
  const dueDay = task.due ? format(new Date(isoDue(task.due)), "yyyy-MM-dd") : "";
  const hasRightActions = Boolean(
    (!completed && (onToggleStart || onDueChange)) || extraActions,
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
  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      disabled ||
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
    if (key === "j" || event.key === "ArrowDown" || key === "k" || event.key === "ArrowUp") {
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
    if (key === "x") {
      event.preventDefault();
      onComplete();
      return;
    }
    if (key === "s" && !completed && onToggleStart) {
      event.preventDefault();
      onToggleStart();
    }
  }
  return (
    <article
      data-task-row
      data-completion={transition?.phase}
      aria-busy={!!transition}
      onKeyDown={handleRowKeyDown}
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
          )}
        >
          <div
            className={cn(
              "grid",
              hasRightActions
                ? "grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
                : "grid-cols-[2rem_minmax(0,1fr)] md:grid-cols-[1.75rem_minmax(0,1fr)]",
            )}
          >
            <Label
              htmlFor={`complete-${task.uuid}`}
              className={cn(
                "task-check-target relative flex h-11 w-8 items-center justify-start self-start md:h-8 md:w-7",
                disabled ? "cursor-default" : "cursor-pointer",
              )}
            >
              <Checkbox
                id={`complete-${task.uuid}`}
                checked={checked}
                disabled={disabled}
                aria-label={`${completed ? "Reopen" : "Complete"}: ${task.description}`}
                onCheckedChange={onComplete}
                className={cn(
                  "task-complete size-[18px] disabled:opacity-100 rounded-full border-muted-foreground/60 bg-background shadow-none transition-colors focus-visible:ring-1 enabled:hover:border-foreground data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground",
                  !checked &&
                    task.priority === "H" &&
                    "border-foreground bg-muted",
                )}
              />
              {!checked && !disabled && (
                <Check
                  aria-hidden="true"
                  className="task-check-preview pointer-events-none absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
              )}
            </Label>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              data-task-drag-surface=""
              onClick={onEdit}
              className="disabled:opacity-100 flex h-auto min-h-11 min-w-0 w-full flex-col items-start justify-start gap-0 self-start rounded-sm px-0 py-3 text-left font-normal whitespace-normal hover:bg-transparent focus-visible:ring-1 md:min-h-8 md:py-1.5 dark:hover:bg-transparent"
            >
              <span
                data-task-title
                className={cn(
                  "block min-w-0 w-full transition-colors duration-150 text-sm leading-5 [overflow-wrap:anywhere]",
                  checked &&
                    "text-muted-foreground line-through decoration-muted-foreground/40",
                )}
              >
                {task.description}
              </span>
              {hasDetails && (
                <span
                  data-task-details
                  className="mt-0.5 flex min-w-0 w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 [overflow-wrap:anywhere] text-muted-foreground"
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
                        overdue && !checked && "text-destructive",
                      )}
                    >
                      <CalendarDays className="size-3" strokeWidth={1.5} />
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
                    <span className="flex items-center gap-1">
                      <Flag className="size-3" strokeWidth={1.5} />
                      {
                        (
                          {
                            H: "High priority",
                            M: "Medium priority",
                            L: "Low priority",
                          } as Record<string, string>
                        )[task.priority]
                      }
                    </span>
                  )}
                  {task.tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex min-w-0 max-w-full items-start gap-1"
                    >
                      <LabelIcon
                        className="mt-0.5 size-3 shrink-0"
                        strokeWidth={1.5}
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {tag}
                      </span>
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
                            : "Set due date"
                        }
                        className={cn(
                          "size-7 text-muted-foreground transition-opacity hover:text-foreground",
                          "opacity-70 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100 data-[state=open]:opacity-100",
                        )}
                      >
                        <CalendarDays className="size-3.5" strokeWidth={1.6} />
                      </Button>
                    }
                  />
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
                      started
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
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
