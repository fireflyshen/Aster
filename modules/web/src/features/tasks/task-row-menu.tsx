import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRIORITIES } from "@/features/tasks/task-constants";
import { dueLabel, toDueDay } from "@/features/tasks/task-date";
import type { Task } from "@shared/tasks";
import { addDays, format, nextMonday, nextSaturday } from "date-fns";
import {
  Armchair,
  ArrowRight,
  ArrowUpRight,
  CornerDownRight,
  Ellipsis,
  Flag,
  ListPlus,
  Pencil,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";

/** Todoist-aligned overflow context menu (`···`) for task rows and board cards. */
export function TaskRowMenu({
  task,
  completed,
  disabled,
  isSubtask,
  open,
  onOpenChange,
  onInlineEdit,
  onDueChange,
  onPriorityChange,
  onStartAddSubtask,
  onUnlinkSubtask,
  onEdit,
  onDelete,
}: {
  task: Task;
  completed: boolean;
  disabled: boolean;
  isSubtask: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInlineEdit?: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
  onStartAddSubtask?: () => void;
  onUnlinkSubtask?: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const dueDay = toDueDay(task.due);
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const weekendStr = format(nextSaturday(now), "yyyy-MM-dd");
  const nextWeekStr = format(nextMonday(now), "yyyy-MM-dd");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`更多操作: ${task.description}`}
          title="更多操作"
          className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        data-task-menu
        className="w-60 p-1"
      >
        {!completed && onInlineEdit && (
          <Button
            type="button"
            variant="navigation"
            className="h-8 text-xs font-normal"
            onClick={() => {
              onOpenChange(false);
              onInlineEdit();
            }}
          >
            <Pencil className="size-3.5" />
            编辑任务
            <kbd className="ml-auto text-[11px] text-muted-foreground">E</kbd>
          </Button>
        )}

        {!completed && onDueChange && (
          <div className="border-b border-border/60 px-1.5 pt-1 pb-2">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>日期</span>
              <span className="font-normal">
                {task.due ? dueLabel(task.due) : "无日期"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              <Button
                type="button"
                variant={dueDay === todayStr ? "secondary" : "ghost"}
                size="icon-xs"
                title="今天"
                aria-label="安排至今天"
                onClick={() => {
                  onOpenChange(false);
                  onDueChange(todayStr);
                }}
                className="size-8 rounded-md"
              >
                <Sun className="size-4 text-(--due-today)" />
              </Button>
              <Button
                type="button"
                variant={dueDay === tomorrowStr ? "secondary" : "ghost"}
                size="icon-xs"
                title="明天"
                aria-label="安排至明天"
                onClick={() => {
                  onOpenChange(false);
                  onDueChange(tomorrowStr);
                }}
                className="size-8 rounded-md"
              >
                <Sunrise className="size-4 text-(--due-tomorrow)" />
              </Button>
              <Button
                type="button"
                variant={dueDay === weekendStr ? "secondary" : "ghost"}
                size="icon-xs"
                title="本周末"
                aria-label="安排至本周末"
                onClick={() => {
                  onOpenChange(false);
                  onDueChange(weekendStr);
                }}
                className="size-8 rounded-md"
              >
                <Armchair className="size-4 text-(--priority-3)" />
              </Button>
              <Button
                type="button"
                variant={dueDay === nextWeekStr ? "secondary" : "ghost"}
                size="icon-xs"
                title="下周"
                aria-label="安排至下周"
                onClick={() => {
                  onOpenChange(false);
                  onDueChange(nextWeekStr);
                }}
                className="size-8 rounded-md"
              >
                <ArrowRight className="size-4 text-(--due-upcoming)" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={!task.due}
                title="清除截止日期"
                aria-label="清除截止日期"
                onClick={() => {
                  onOpenChange(false);
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
              <span>优先级</span>
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
              {PRIORITIES.map((item) => (
                <Button
                  key={item.label}
                  type="button"
                  variant={
                    (task.priority || "") === item.value ? "secondary" : "ghost"
                  }
                  size="icon-xs"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => {
                    onOpenChange(false);
                    onPriorityChange(item.value);
                  }}
                  className="size-8 rounded-md"
                >
                  <Flag className={`size-4 ${item.iconClass}`} />
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-1">
          {!completed && onStartAddSubtask && (
            <Button
              type="button"
              variant="navigation"
              className="h-8 text-xs font-normal"
              onClick={() => {
                onOpenChange(false);
                onStartAddSubtask();
              }}
            >
              <CornerDownRight className="size-3.5" />
              添加子任务
            </Button>
          )}
          {isSubtask && onUnlinkSubtask && (
            <Button
              type="button"
              variant="navigation"
              className="h-8 text-xs font-normal"
              onClick={() => {
                onOpenChange(false);
                onUnlinkSubtask();
              }}
            >
              <ArrowUpRight className="size-3.5" />
              转为主任务
            </Button>
          )}
          <Button
            type="button"
            variant="navigation"
            className="h-8 text-xs font-normal"
            onClick={() => {
              onOpenChange(false);
              onEdit();
            }}
          >
            <ListPlus className="size-3.5" />
            备注与完整详情…
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="navigation"
              aria-label={`删除任务: ${task.description}`}
              className="mt-1 h-8 border-t border-border/60 pt-1 text-xs font-normal text-destructive hover:text-destructive"
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
            >
              <Trash2 className="size-3.5" />
              删除任务
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
