import { createContext, useContext } from "react";
import { DescriptionPopover } from "./description-popover";
import type { TaskCostSummary } from "@core/time/model";
import {
  formatCurrencyCny,
  formatDurationChinese,
} from "@/features/time/time-format";
import {
  HabitMetaChip,
  type HabitTaskActions,
} from "@/features/habits/habit-task-controls";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { dueLabel, toDueDay, taskDateTone } from "@/features/tasks/task-date";
import type { HabitListItem } from "@core/habits/model";
import { STATE_LABELS, type EffectiveTaskState } from "@core/tasks/state";
import { formatDuration } from "@core/workspace/energy";
import { projectLeaf } from "@core/workspace/projects";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { Clock3, Inbox, MessageSquare, Repeat2 } from "lucide-react";

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

const STATE_CHIP_STYLE: Record<string, string> = {
  doing:
    "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  planned: "bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-300",
  waiting: "bg-teal-500/12 text-teal-700 border-teal-500/30 dark:text-teal-300",
  parked: "bg-muted text-muted-foreground border-border/70",
};

/** A section already communicates its state; retain exceptional blocked badges. */
export const TaskStateGroupContext = createContext<
  EffectiveTaskState | undefined
>(undefined);

/** Compact colored badge displaying the task state machine state (`waiting` shows waitReason on hover). */
export function StateChip({
  state,
  waitReason,
  waitDate,
  blocked,
}: {
  state?: EffectiveTaskState | null;
  waitReason?: string;
  waitDate?: string;
  blocked?: boolean;
}) {
  const groupedState = useContext(TaskStateGroupContext);
  if (!state || state === "completed") return null;
  const label = STATE_LABELS[state] ?? state;
  const titleParts: string[] = [label];
  if (state === "waiting" && waitReason) titleParts.push(`原因: ${waitReason}`);
  if ((state === "waiting" || state === "parked") && waitDate) {
    titleParts.push(
      `${state === "waiting" ? "核对日" : "复查日"}: ${toDueDay(waitDate) || dueLabel(waitDate)}`,
    );
  }
  return (
    <>
      {state !== groupedState && (
        <span
          data-task-state-chip={state}
          title={titleParts.join(" · ")}
          className={cn(
            "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
            STATE_CHIP_STYLE[state] || STATE_CHIP_STYLE.planned,
          )}
        >
          {label}
        </span>
      )}
      {blocked && (
        <span
          data-task-blocked-chip
          title="存在未完成的前置依赖任务"
          className="inline-flex shrink-0 items-center rounded border border-rose-500/30 bg-rose-500/12 px-1.5 py-0.5 text-[11px] leading-none font-medium text-rose-700 dark:text-rose-300 whitespace-nowrap"
        >
          被阻塞
        </span>
      )}
    </>
  );
}

export const TaskGroupLabelContext = createContext<string | undefined>(
  undefined,
);

/** Renders the Todoist-aligned bottom metadata line for task rows and board cards. */
export function TaskMetaChips({
  task,
  description,
  costSummary,
  checked,
  overdue,
  disabled,
  showProject,
  showInbox = false,
  sectionName,
  started,
  timingActive = started,
  isTimeMode = false,
  timingUnavailable,
  trackedSeconds,
  availableLabels,
  totalSubtasks,
  completedSubtasks,
  subtasksExpanded,
  onToggleSubtasks,
  onEdit,
  onDueChange,
  effectiveRowState,
  blocked = false,
  habit,
  habitTodayDate,
  onHabitSwitchPlan,
  onOpenHabitDetail,
}: {
  task: Task;
  description?: string;
  costSummary?: TaskCostSummary;
  checked: boolean;
  overdue: boolean;
  disabled: boolean;
  showProject: boolean;
  showInbox?: boolean;
  sectionName?: string;
  started: boolean;
  timingActive?: boolean;
  isTimeMode?: boolean;
  timingUnavailable: boolean;
  trackedSeconds?: number;
  availableLabels: SavedTag[];
  totalSubtasks: number;
  completedSubtasks: number;
  subtasksExpanded: boolean;
  onToggleSubtasks?: () => void;
  onEdit: () => void;
  onDueChange?: (due: string) => void;
  effectiveRowState?: EffectiveTaskState | null;
  blocked?: boolean;
  habit?: HabitListItem;
  habitTodayDate?: string;
  onHabitSwitchPlan?: HabitTaskActions["switchPlan"];
  onOpenHabitDetail?: (habitId: string) => void;
}) {
  const groupLabel = useContext(TaskGroupLabelContext);
  const visibleTags = task.tags.filter((tag) => tag !== groupLabel);
  const dueDay = toDueDay(task.due);
  const tone = taskDateTone(dueDay);
  const tagColorMap = new Map(
    availableLabels.map((tag) => [tag.name, itemColor(tag.color)]),
  );

  const dueColorClass = overdue
    ? "font-medium text-(--priority-1)"
    : tone === "today"
      ? "font-medium text-(--due-today)"
      : tone === "tomorrow"
        ? "font-medium text-(--due-tomorrow)"
        : tone === "upcoming"
          ? "text-(--due-upcoming)"
          : "text-muted-foreground";

  const costLabel = !costSummary
    ? ""
    : costSummary.confirmedCostCents > 0
      ? formatCurrencyCny(costSummary.confirmedCostCents)
      : costSummary.provisionalCostCents > 0
        ? `暂计 ${formatCurrencyCny(costSummary.provisionalCostCents)}`
        : `预算 ${formatCurrencyCny(costSummary.currentBudgetCents ?? 0)}`;

  return (
    <div
      data-task-details
      className="task-meta mt-1 min-w-0 w-full text-xs leading-4 text-muted-foreground"
    >
      {habit && habitTodayDate ? (
        <HabitMetaChip
          habit={habit}
          date={habitTodayDate}
          disabled={disabled}
          onSwitchPlan={onHabitSwitchPlan}
          onOpenDetail={onOpenHabitDetail}
        />
      ) : (
        <StateChip
          state={effectiveRowState}
          waitReason={task.waitReason}
          waitDate={task.wait}
          blocked={blocked}
        />
      )}

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

      {totalSubtasks > 0 &&
        (onToggleSubtasks ? (
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
            className="inline-flex shrink-0 items-center gap-1 h-4.5 rounded-[4px] px-1 -mx-1 text-[12px] leading-none text-muted-foreground/85 hover:text-foreground hover:bg-muted transition-colors cursor-pointer select-none whitespace-nowrap"
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
          </button>
        ) : (
          <span
            title={`${completedSubtasks}/${totalSubtasks} 个子任务`}
            className="inline-flex shrink-0 items-center gap-1 h-4.5 text-[12px] leading-none text-muted-foreground/85 select-none whitespace-nowrap"
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
          </span>
        ))}

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

      {(started || timingActive || (trackedSeconds ?? 0) > 0) && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 tabular-nums whitespace-nowrap",
            timingActive
              ? "font-medium text-primary"
              : started && "font-medium text-foreground",
          )}
        >
          <Clock3 className="size-3" strokeWidth={1.5} />
          {trackedSeconds === undefined && isTimeMode
            ? timingActive
              ? "计时中 · —"
              : started
                ? "进行中 · —"
                : "—"
            : timingActive
              ? timingUnavailable
                ? "计时中 · 计时不可用"
                : `计时中 · ${formatDuration(trackedSeconds || 0)}`
              : started
                ? timingUnavailable
                  ? "进行中 · 计时不可用"
                  : `进行中 · ${formatDuration(trackedSeconds || 0)}`
                : formatDuration(trackedSeconds || 0)}
        </span>
      )}

      {costSummary &&
        (costSummary.confirmedCostCents > 0 ||
          costSummary.provisionalCostCents > 0 ||
          costSummary.overInitialBudgetCents > 0 ||
          timingActive) && (
          <button
            type="button"
            data-task-cost
            onClick={onEdit}
            disabled={disabled}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-[12px] leading-none whitespace-nowrap tabular-nums hover:text-foreground",
              costSummary.overInitialBudgetCents > 0
                ? "text-(--due-tomorrow)"
                : "text-muted-foreground",
            )}
            aria-label={`查看时间成本：${costLabel}，已投入${formatDurationChinese(costSummary.confirmedSeconds)}`}
            title={`已投入 ${formatDurationChinese(costSummary.confirmedSeconds)} · 已确认 ${formatCurrencyCny(costSummary.confirmedCostCents)}${costSummary.provisionalCostCents > 0 ? ` · 另有暂计 ${formatCurrencyCny(costSummary.provisionalCostCents)}` : ""}${costSummary.overInitialBudgetCents > 0 ? ` · 超出预估 ${formatCurrencyCny(costSummary.overInitialBudgetCents)}` : ""}`}
          >
            {costLabel}
          </button>
        )}

      {!!task.wait && new Date(task.wait) > new Date() && !checked && (
        <span
          data-task-meta="wait"
          title={`等待至 ${dueLabel(task.wait)}`}
          aria-label={`等待至 ${dueLabel(task.wait)}`}
          className="inline-flex shrink-0 items-center text-muted-foreground/70"
        >
          <Clock3
            aria-hidden="true"
            className="size-3 shrink-0"
            strokeWidth={1.5}
          />
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

      {description?.trim() && (
        <DescriptionPopover
          text={description}
          title={task.description}
          compact
          onOpenDetails={onEdit}
        />
      )}

      {visibleTags.length > 0 && (
        <span className="task-meta-tags" aria-label="标签">
          {visibleTags.map((tag) => {
            const color = tagColorMap.get(tag);
            return (
              <span
                key={tag}
                title={tag}
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
        </span>
      )}
      {showProject && (task.project || showInbox) && (
        <span
          data-task-meta="location"
          title={`${task.project || "收件箱"}${sectionName ? ` / ${sectionName}` : ""}`}
          className="task-meta-location text-[12px] text-muted-foreground/85"
        >
          {task.project ? (
            <ProjectIcon name={task.project} className="size-3 shrink-0" />
          ) : (
            <Inbox className="size-3 shrink-0 opacity-80" strokeWidth={1.6} />
          )}
          <span className="min-w-0 truncate">
            {task.project ? projectLeaf(task.project) : "收件箱"}
          </span>
        </span>
      )}
    </div>
  );
}
