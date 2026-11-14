import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { PRIORITIES, priorityOption } from "@/features/tasks/task-constants";
import { dueLabel, toDueDay } from "@/features/tasks/task-date";
import { formatDuration } from "@core/workspace/energy";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { addDays, format } from "date-fns";
import {
  Check,
  Clock3,
  Flag,
  Flame,
  MessageSquare,
  Repeat2,
} from "lucide-react";

function TodoistCalendarGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      fill="none"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="size-3 shrink-0"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.5 1h-7A1.5 1.5 0 0 0 1 2.5v7A1.5 1.5 0 0 0 2.5 11h7A1.5 1.5 0 0 0 11 9.5v-7A1.5 1.5 0 0 0 9.5 1M2 2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5zM8.75 8a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M3.5 4a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Renders the Todoist-aligned bottom metadata line for task rows and board cards. */
export function TaskMetaChips({
  task,
  variant,
  checked,
  overdue,
  disabled,
  showProject,
  started,
  timingUnavailable,
  trackedSeconds,
  availableLabels,
  totalSubtasks,
  completedSubtasks,
  subtasksExpanded,
  priorityChipOpen,
  onPriorityChipOpenChange,
  onToggleSubtasks,
  onEdit,
  onDueChange,
  onPriorityChange,
}: {
  task: Task;
  variant: "list" | "card";
  checked: boolean;
  overdue: boolean;
  disabled: boolean;
  showProject: boolean;
  started: boolean;
  timingUnavailable: boolean;
  trackedSeconds?: number;
  availableLabels: SavedTag[];
  totalSubtasks: number;
  completedSubtasks: number;
  subtasksExpanded: boolean;
  priorityChipOpen: boolean;
  onPriorityChipOpenChange: (open: boolean) => void;
  onToggleSubtasks: () => void;
  onEdit: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
}) {
  const dueDay = toDueDay(task.due);
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const isDueToday = dueDay === todayStr;
  const isDueTomorrow = dueDay === tomorrowStr;
  const tagColorMap = new Map(
    availableLabels.map((tag) => [tag.name, itemColor(tag.color)]),
  );
  const pMeta = priorityOption(task.priority);

  const dueColorClass = overdue
    ? "font-medium text-(--priority-1)"
    : isDueToday
      ? "font-medium text-(--due-today)"
      : isDueTomorrow
        ? "font-medium text-(--due-tomorrow)"
        : "text-(--due-upcoming)";

  return (
    <div
      data-task-details
      className="mt-1 flex min-w-0 w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-4 text-muted-foreground"
    >
      {task.due &&
        (!checked && onDueChange ? (
          <div
            data-task-meta="due"
            data-no-drag
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center"
          >
            <DatePicker
              id={`due-chip-${task.uuid}`}
              value={dueDay}
              disabled={disabled}
              align="start"
              ariaLabel={`截止日期: ${task.description}`}
              onChange={onDueChange}
              trigger={
                <button
                  type="button"
                  className={cn(
                    "group/due inline-flex shrink-0 items-center gap-1 text-[12px] leading-none transition-opacity hover:opacity-75 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs whitespace-nowrap",
                    dueColorClass,
                  )}
                >
                  <TodoistCalendarGlyph />
                  {overdue && "逾期 · "}
                  {dueLabel(task.due)}
                </button>
              }
            />
          </div>
        ) : (
          <span
            data-task-meta="due"
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-[12px] leading-none transition-colors whitespace-nowrap",
              checked ? "text-muted-foreground" : dueColorClass,
            )}
          >
            <TodoistCalendarGlyph />
            {overdue && !checked && "逾期 · "}
            {dueLabel(task.due)}
          </span>
        ))}

      {totalSubtasks > 0 && (
        <button
          type="button"
          data-no-drag
          aria-expanded={subtasksExpanded}
          aria-label={`${subtasksExpanded ? "收起" : "展开"}子任务: ${task.description}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSubtasks();
          }}
          title={`${completedSubtasks}/${totalSubtasks} 个子任务`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 h-4.5 rounded-[4px] px-1 -mx-1 text-[12px] leading-none text-muted-foreground/85 hover:text-foreground hover:bg-muted transition-colors cursor-pointer select-none whitespace-nowrap",
            subtasksExpanded &&
              variant === "card" &&
              "bg-muted/80 text-foreground",
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="size-3.5 shrink-0 opacity-80"
            aria-hidden="true"
          >
            <path d="M4.5 2A2.5 2.5 0 0 1 5 6.95V8.5a2.5 2.5 0 0 0 2.336 2.495L7.5 11h1.55a2.5 2.5 0 1 1 0 1H7.5a3.5 3.5 0 0 1-3.495-3.308L4 8.5V6.95A2.5 2.5 0 0 1 4.5 2m7 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m-7-7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3" />
          </svg>
          <span className="tabular-nums">
            {completedSubtasks}/{totalSubtasks}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              "size-3 shrink-0 opacity-65 transition-transform duration-150",
              subtasksExpanded && "rotate-90",
            )}
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M5.646 4.354a.5.5 0 1 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L9.293 8z"
            />
          </svg>
        </button>
      )}

      {!!task.annotations.length && (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-[12px] leading-none text-muted-foreground hover:text-foreground transition-colors cursor-pointer whitespace-nowrap"
          title={`${task.annotations.length} 条评论`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <MessageSquare className="size-3 shrink-0" strokeWidth={1.6} />
          <span className="tabular-nums">{task.annotations.length}</span>
        </span>
      )}

      {(started || (trackedSeconds ?? 0) > 0) && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 tabular-nums whitespace-nowrap",
            started && "font-medium text-foreground",
          )}
        >
          <Clock3 className="size-3" strokeWidth={1.5} />
          {started
            ? timingUnavailable
              ? "进行中 · 计时不可用"
              : `进行中 · ${formatDuration(trackedSeconds || 0)}`
            : formatDuration(trackedSeconds || 0)}
        </span>
      )}

      {!!task.wait && new Date(task.wait) > new Date() && !checked && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] leading-none text-muted-foreground whitespace-nowrap">
          <Clock3 className="size-3 shrink-0" strokeWidth={1.5} />
          等待 · {dueLabel(task.wait)}
        </span>
      )}

      {!!task.recur && (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-[12px] leading-none text-muted-foreground whitespace-nowrap"
          aria-label={`重复 ${task.recur}`}
        >
          <Repeat2 className="size-3.5 shrink-0" strokeWidth={1.5} />
          {task.recur}
        </span>
      )}

      {task.priority &&
        (!checked && onPriorityChange ? (
          <div
            data-no-drag
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center"
          >
            <Popover
              open={priorityChipOpen}
              onOpenChange={onPriorityChipOpenChange}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-none transition-opacity hover:opacity-75 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs whitespace-nowrap",
                    pMeta.textClass,
                  )}
                >
                  <Flag
                    className="size-3 shrink-0 fill-current"
                    strokeWidth={1.6}
                  />
                  {pMeta.short}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-36 p-1">
                {PRIORITIES.map((item) => (
                  <Button
                    key={item.label}
                    type="button"
                    variant="navigation"
                    className="h-8 w-full justify-between px-2 text-xs font-normal"
                    onClick={() => {
                      onPriorityChipOpenChange(false);
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
          </div>
        ) : (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-none transition-colors whitespace-nowrap",
              checked ? "text-muted-foreground" : pMeta.textClass,
            )}
          >
            <Flag className="size-3 shrink-0 fill-current" strokeWidth={1.6} />
            {pMeta.short}
          </span>
        ))}

      {Number.isFinite(task.urgency) && task.urgency > 0 && (
        <span
          data-task-meta="urgency"
          title={`Taskwarrior 紧迫度分: ${task.urgency.toFixed(2)}`}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 text-[12px] leading-none tabular-nums whitespace-nowrap transition-colors",
            checked
              ? "text-muted-foreground/70"
              : task.urgency >= 10
                ? "font-medium text-[#b55e24] dark:text-[#e39660]"
                : "text-muted-foreground/80",
          )}
        >
          <Flame className="size-3 shrink-0 opacity-80" strokeWidth={1.6} />
          {task.urgency.toFixed(1)}
        </span>
      )}

      {task.tags.map((tag) => {
        const color = tagColorMap.get(tag);
        return (
          <span
            key={tag}
            style={color ? { color } : undefined}
            className="inline-flex shrink-0 max-w-[120px] items-center gap-1 text-[12px] leading-none text-muted-foreground/85 transition-opacity hover:opacity-85 whitespace-nowrap"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              fill="none"
              viewBox="0 0 12 12"
              className="size-3 shrink-0 opacity-85"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M5.93 1h3.427C10.264 1 11 1.736 11 2.643V6.07c0 .436-.173.854-.481 1.162L7.232 10.52a1.643 1.643 0 0 1-2.323 0L1.48 7.09a1.643 1.643 0 0 1 0-2.323L4.768 1.48A1.64 1.64 0 0 1 5.93 1m.001.91a.8.8 0 0 0-.569.235L2.145 5.362a.804.804 0 0 0 0 1.138L5.5 9.855a.804.804 0 0 0 1.138 0l3.217-3.217a.804.804 0 0 0 .236-.569V2.713a.804.804 0 0 0-.804-.804zm1.433 3.635a.91.91 0 1 0 0-1.818.91.91 0 0 0 0 1.818"
                clipRule="evenodd"
              />
            </svg>
            <span className="truncate">{tag}</span>
          </span>
        );
      })}

      {showProject && task.project && (
        <span
          className={cn(
            "inline-flex min-w-0 shrink-0 items-center gap-1 text-[12px] text-muted-foreground/85 whitespace-nowrap",
            variant === "list" && "ml-auto",
          )}
        >
          <span className="truncate max-w-[140px]">{task.project}</span>
          <ProjectIcon name={task.project} className="size-3 shrink-0" />
        </span>
      )}
    </div>
  );
}
