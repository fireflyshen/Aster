import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PRIORITIES } from "@/features/tasks/task-constants";
import { dueLabel, toDueDay } from "@/features/tasks/task-date";
import {
  STATE_ACTION_LABELS,
  StateTargetIcon,
} from "@/features/tasks/state-dialogs";
import {
  allowedStateTargets,
  type EffectiveTaskState,
  type TaskState,
} from "@core/tasks/state";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { useMemo, type ReactNode } from "react";
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
  Play,
  Square,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";

const MENU_ITEM_CLASS =
  "h-8 w-full justify-start gap-2.5 rounded-[7px] px-2 text-[13px] font-normal text-foreground/90 hover:bg-navigation-hover hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

function MenuSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-border/65" />;
}

/** Todoist-aligned overflow & right-click context menu for task rows and board cards. */
export function TaskRowMenu({
  task,
  completed,
  disabled,
  isSubtask,
  open,
  onOpenChange,
  anchorPoint,
  onOpenTriggerMenu,
  onInlineEdit,
  onDueChange,
  onPriorityChange,
  onStartAddSubtask,
  onUnlinkSubtask,
  onEdit,
  onDelete,
  onToggleStart,
  onClearStartMark,
  effectiveRowState,
  onChangeState,
  timingActive,
  timingUnavailable,
  extraActions,
}: {
  task: Task;
  completed: boolean;
  disabled: boolean;
  isSubtask: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorPoint?: { x: number; y: number } | null;
  onOpenTriggerMenu?: () => void;
  onInlineEdit?: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
  onStartAddSubtask?: () => void;
  onUnlinkSubtask?: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  onToggleStart?: () => void;
  onClearStartMark?: () => void;
  effectiveRowState?: EffectiveTaskState | null;
  onChangeState?: (state: TaskState) => void;
  timingActive?: boolean;
  timingUnavailable?: boolean;
  extraActions?: ReactNode;
}) {
  const dueDay = toDueDay(task.due);
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const weekendStr = format(nextSaturday(now), "yyyy-MM-dd");
  const nextWeekStr = format(nextMonday(now), "yyyy-MM-dd");
  const stateTargets =
    !completed && !isSubtask && onChangeState && effectiveRowState
      ? allowedStateTargets(effectiveRowState)
      : [];
  const hasQuickControls =
    !completed && Boolean(onDueChange || onPriorityChange);
  const virtualAnchorRef = useMemo(
    () => ({
      current: anchorPoint
        ? ({
            getBoundingClientRect: () =>
              DOMRect.fromRect({
                x: anchorPoint.x,
                y: anchorPoint.y,
                width: 0,
                height: 0,
              }),
          } as Element)
        : null,
    }),
    [anchorPoint],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorPoint && <PopoverAnchor virtualRef={virtualAnchorRef} />}
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`更多操作: ${task.description}`}
          title="更多操作 (右键任务行亦可)"
          onClick={() => onOpenTriggerMenu?.()}
          className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={anchorPoint ? "start" : "end"}
        sideOffset={anchorPoint ? 4 : 6}
        collisionPadding={12}
        data-task-menu
        className="w-64 rounded-xl border-border/70 p-1.5 shadow-floating"
      >
        {!completed && onInlineEdit && (
          <>
            <Button
              type="button"
              variant="navigation"
              className={MENU_ITEM_CLASS}
              onClick={() => {
                onOpenChange(false);
                onInlineEdit();
              }}
            >
              <Pencil />
              <span>编辑任务</span>
              <kbd className="ml-auto font-sans text-[11px] text-muted-foreground/80">
                E
              </kbd>
            </Button>
            {(hasQuickControls || stateTargets.length > 0 || extraActions) && (
              <MenuSeparator />
            )}
          </>
        )}

        {!completed && onDueChange && (
          <div
            className={cn("px-1.5 pt-0.5 pb-1.5", onPriorityChange && "pb-2")}
          >
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>日期</span>
              <span className="font-normal tabular-nums text-muted-foreground/85">
                {task.due ? dueLabel(task.due) : "无日期"}
              </span>
            </div>
            <div data-task-menu-dates className="grid grid-cols-5 gap-1">
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
                className="h-8 w-full rounded-[7px]"
              >
                <Sun className="size-4 text-(--due-today)" />
                <span className="md:hidden">今天</span>
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
                className="h-8 w-full rounded-[7px]"
              >
                <Sunrise className="size-4 text-(--due-tomorrow)" />
                <span className="md:hidden">明天</span>
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
                className="h-8 w-full rounded-[7px]"
              >
                <Armchair className="size-4 text-(--priority-3)" />
                <span className="md:hidden">周末</span>
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
                className="h-8 w-full rounded-[7px]"
              >
                <ArrowRight className="size-4 text-(--due-upcoming)" />
                <span className="md:hidden">下周</span>
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
                className="h-8 w-full rounded-[7px] text-muted-foreground"
              >
                <X className="size-4" />
                <span className="md:hidden">清除</span>
              </Button>
            </div>
          </div>
        )}

        {!completed && onPriorityChange && (
          <div className="px-1.5 pt-0.5 pb-1.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>优先级</span>
              <span className="font-normal tabular-nums text-muted-foreground/85">
                {task.priority === "H"
                  ? "P1"
                  : task.priority === "M"
                    ? "P2"
                    : task.priority === "L"
                      ? "P3"
                      : "P4"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {PRIORITIES.map((item) => {
                const active = (task.priority || "") === item.value;
                return (
                  <Button
                    key={item.label}
                    type="button"
                    variant={active ? "secondary" : "ghost"}
                    size="icon-xs"
                    title={item.label}
                    aria-label={item.label}
                    onClick={() => {
                      onOpenChange(false);
                      onPriorityChange(item.value);
                    }}
                    className={cn(
                      "h-8 w-full gap-1 rounded-[7px] text-[11px] font-medium",
                      active
                        ? "ring-1 ring-border text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Flag className={`size-3.5 ${item.iconClass}`} />
                    <span>{item.value ? item.short : "P4"}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {hasQuickControls && (stateTargets.length > 0 || extraActions) && (
          <MenuSeparator />
        )}

        {stateTargets.length > 0 && onChangeState && (
          <div>
            <div className="mb-0.5 px-2 pt-0.5 text-[11px] font-medium text-muted-foreground">
              状态流转
            </div>
            <div className="space-y-0.5">
              {stateTargets.map((target) => (
                <Button
                  key={target}
                  type="button"
                  variant="navigation"
                  disabled={disabled}
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    onOpenChange(false);
                    onChangeState(target);
                  }}
                >
                  <StateTargetIcon state={target} />
                  <span>{STATE_ACTION_LABELS[target]}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {stateTargets.length > 0 && extraActions && <MenuSeparator />}
        {extraActions}

        {(hasQuickControls || stateTargets.length > 0 || extraActions) && (
          <MenuSeparator />
        )}

        <div className="space-y-0.5">
          {!completed && onToggleStart && (
            <>
              <Button
                type="button"
                variant="navigation"
                disabled={disabled || (!timingActive && timingUnavailable)}
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  onOpenChange(false);
                  onToggleStart();
                }}
              >
                {timingActive ? <Square /> : <Play />}
                <span>
                  {timingActive
                    ? "停止计时"
                    : task.start
                      ? "切换为此任务计时"
                      : "设为正在进行"}
                </span>
                <kbd className="ml-auto font-sans text-[11px] text-muted-foreground/80">
                  S
                </kbd>
              </Button>
              {!timingActive && task.start && onClearStartMark && (
                <Button
                  type="button"
                  variant="navigation"
                  disabled={disabled}
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    onOpenChange(false);
                    onClearStartMark();
                  }}
                >
                  <X />
                  <span>清除进行中标记</span>
                </Button>
              )}
            </>
          )}
          {!completed && onStartAddSubtask && (
            <Button
              type="button"
              variant="navigation"
              className={MENU_ITEM_CLASS}
              onClick={() => {
                onOpenChange(false);
                onStartAddSubtask();
              }}
            >
              <CornerDownRight />
              <span>添加子任务</span>
            </Button>
          )}
          {isSubtask && onUnlinkSubtask && (
            <Button
              type="button"
              variant="navigation"
              className={MENU_ITEM_CLASS}
              onClick={() => {
                onOpenChange(false);
                onUnlinkSubtask();
              }}
            >
              <ArrowUpRight />
              <span>转为主任务</span>
            </Button>
          )}
          <Button
            type="button"
            variant="navigation"
            className={MENU_ITEM_CLASS}
            onClick={() => {
              onOpenChange(false);
              onEdit();
            }}
          >
            <ListPlus />
            <span>备注与完整详情…</span>
          </Button>
        </div>

        {onDelete && (
          <>
            <MenuSeparator />
            <Button
              type="button"
              variant="navigation"
              data-task-menu-destructive
              aria-label={`删除任务: ${task.description}`}
              className={cn(
                MENU_ITEM_CLASS,
                "text-destructive hover:bg-destructive/10 hover:text-destructive [&_svg]:text-current",
              )}
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
            >
              <Trash2 />
              <span>删除任务</span>
              <kbd className="ml-auto font-sans text-[11px] text-destructive/75">
                ⌫
              </kbd>
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
