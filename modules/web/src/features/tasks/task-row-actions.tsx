import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePicker } from "@/features/tasks/date-picker";
import { PRIORITIES, priorityOption } from "@/features/tasks/task-constants";
import { dueLabel } from "@/features/tasks/task-date";
import { TaskRowMenu } from "@/features/tasks/task-row-menu";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import {
  CalendarDays,
  Check,
  Flag,
  MessageSquare,
  Pencil,
  Play,
  Square,
} from "lucide-react";
import type { ReactNode } from "react";

type TaskRowActionsProps = {
  task: Task;
  variant: "list" | "card";
  completed: boolean;
  disabled: boolean;
  started: boolean;
  timingUnavailable: boolean;
  dueDay: string;
  isSubtask: boolean;
  actionsVisible: boolean;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
  priorityPopoverOpen: boolean;
  onPriorityPopoverOpenChange: (open: boolean) => void;
  hasMoreMenu: boolean;
  extraActions?: ReactNode;
  onEdit: () => void;
  onInlineEdit?: () => void;
  onToggleStart?: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
  onStartAddSubtask?: () => void;
  onUnlinkSubtask?: () => void;
  onDelete?: () => void;
};

/** Hover/focus action rail for a task row: inline edit, due date, priority, comments, timing, and menu. */
export function TaskRowActions({
  task,
  variant,
  completed,
  disabled,
  started,
  timingUnavailable,
  dueDay,
  isSubtask,
  actionsVisible,
  moreOpen,
  onMoreOpenChange,
  priorityPopoverOpen,
  onPriorityPopoverOpenChange,
  hasMoreMenu,
  extraActions,
  onEdit,
  onInlineEdit,
  onToggleStart,
  onDueChange,
  onPriorityChange,
  onStartAddSubtask,
  onUnlinkSubtask,
  onDelete,
}: TaskRowActionsProps) {
  return (
    <div
      data-no-drag
      data-row-actions
      data-actions-open={actionsVisible}
      className={cn(
        "flex h-8 shrink-0 items-center gap-0.5 self-start transition-opacity duration-150 md:mt-0.5",
        actionsVisible
          ? "opacity-100"
          : "opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100",
      )}
    >
      {variant === "list" && !completed && onInlineEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`行内编辑: ${task.description}`}
          title="编辑 (E)"
          onClick={onInlineEdit}
          className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Pencil className="size-3.5" strokeWidth={1.6} />
        </Button>
      )}
      {variant === "list" && !completed && onDueChange && (
        <DatePicker
          id={`due-${task.uuid}`}
          value={dueDay}
          disabled={disabled}
          align="end"
          ariaLabel={`截止日期: ${task.description}`}
          onChange={onDueChange}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`设定截止日期: ${task.description}`}
              title={
                task.due
                  ? `截止 ${dueLabel(task.due)} — 更改日期`
                  : "设定日期 (T)"
              }
              className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              <CalendarDays className="size-3.5" strokeWidth={1.6} />
            </Button>
          }
        />
      )}
      {variant === "list" && !completed && onPriorityChange && (
        <Popover
          open={priorityPopoverOpen}
          onOpenChange={onPriorityPopoverOpenChange}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`设置优先级: ${task.description}`}
              title="设置优先级 (1-3 / 0)"
              className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              <Flag
                className={cn(
                  "size-3.5",
                  task.priority
                    ? priorityOption(task.priority).iconClass
                    : "text-muted-foreground",
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
                  onPriorityPopoverOpenChange(false);
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
      {variant === "list" && !completed && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`评论与详情: ${task.description}`}
          title="评论与详情"
          onClick={onEdit}
          className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MessageSquare className="size-3.5" strokeWidth={1.6} />
        </Button>
      )}
      {variant === "list" && !completed && onToggleStart && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || (!started && timingUnavailable)}
          aria-label={`${started ? "停止计时" : "开始计时"}: ${task.description}`}
          title={
            !started && timingUnavailable
              ? "计时不可用"
              : started
                ? "停止计时 (S)"
                : "开始计时 (S)"
          }
          onClick={onToggleStart}
          className={cn(
            "size-6 rounded-[4px] transition-colors hover:bg-accent",
            started
              ? "text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground",
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
        <TaskRowMenu
          task={task}
          completed={completed}
          disabled={disabled}
          isSubtask={isSubtask}
          open={moreOpen}
          onOpenChange={onMoreOpenChange}
          onInlineEdit={onInlineEdit}
          onDueChange={onDueChange}
          onPriorityChange={onPriorityChange}
          onStartAddSubtask={onStartAddSubtask}
          onUnlinkSubtask={onUnlinkSubtask}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleStart={onToggleStart}
          timingUnavailable={timingUnavailable}
          extraActions={extraActions}
        />
      )}
    </div>
  );
}
