import type { TaskRenderFn } from "@/app/hooks/use-task-renderer";
import { HabitExecutionRow } from "@/features/habits/habit-execution-row";
import type { TodayHabitsResponse } from "@core/habits/model";
import type { SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

export type TodayHabitsActions = {
  disabled?: boolean;
  onTogglePositive: (
    habitId: string,
    date: string,
    completed?: boolean,
  ) => void;
  onSetChecklistItem: (input: {
    habitId: string;
    itemId: string;
    date: string;
    done?: boolean;
    sets?: string | null;
    reps?: string | null;
    weight?: string | null;
    planId?: string;
  }) => void;
  onSwitchPlan: (habitId: string, planId: string, date: string) => void;
  onRecordNegative: (habitId: string, date: string, note?: string) => void;
  onUndoNegative: (habitId: string, date: string, eventId?: string) => void;
  onUpdateNegativeNote: (
    habitId: string,
    eventId: string,
    note: string,
    date: string,
  ) => void;
  onSetDailyNote: (habitId: string, note: string, date: string) => void;
  onOpenHabitsPage?: () => void;
  onOpenHabitDetail?: (habitId: string) => void;
};

/**
 * Renders today's scheduled habits at the top of the Today view using Aster's standard `TaskRow`.
 * Habits remain unified Todos backed by `Task` + `taskUuid`, while daily completion state lives in `todayData`.
 */
export function TodayHabitsSection({
  todayData,
  todayHabitTasks = [],
  renderTask,
  availableLabels = [],
  actions,
  disabled,
}: {
  todayData: TodayHabitsResponse | null;
  todayHabitTasks?: Task[];
  renderTask?: TaskRenderFn;
  availableLabels?: readonly SavedTag[];
  actions: TodayHabitsActions;
  disabled?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!todayData || todayData.items.length === 0) return null;

  const taskByUuid = new Map(todayHabitTasks.map((t) => [t.uuid, t]));
  const totalCount = todayData.items.length;
  const doneCount = todayData.items.filter(
    (item) => item.evaluation.achieved,
  ).length;
  const rowDisabled = Boolean(disabled || actions.disabled);

  return (
    <section
      data-today-habits-section
      aria-label="今日习惯"
      className="min-w-0"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-foreground hover:text-foreground/85"
        >
          <ChevronRight
            className={`size-3.5 text-muted-foreground transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
          <span>习惯</span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {doneCount}/{totalCount}
          </span>
        </button>

        {actions.onOpenHabitsPage && (
          <button
            type="button"
            onClick={actions.onOpenHabitsPage}
            className="cursor-pointer text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            管理习惯
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="divide-y divide-border/50">
          {todayData.items.map((item) => {
            const linkedTask = item.habit.taskUuid
              ? taskByUuid.get(item.habit.taskUuid)
              : undefined;
            if (linkedTask && renderTask) {
              return (
                <div key={linkedTask.uuid}>{renderTask(linkedTask)}</div>
              );
            }
            return (
              <HabitExecutionRow
                key={item.habit.id}
                habit={item.habit}
                evaluation={item.evaluation}
                availablePlans={item.availablePlans}
                streak={item.streak}
                availableLabels={availableLabels}
                date={todayData.todayDate}
                isToday
                disabled={rowDisabled}
                onTogglePositive={actions.onTogglePositive}
                onSetChecklistItem={actions.onSetChecklistItem}
                onSwitchPlan={actions.onSwitchPlan}
                onRecordNegative={actions.onRecordNegative}
                onUndoNegative={actions.onUndoNegative}
                onUpdateNegativeNote={actions.onUpdateNegativeNote}
                onSetDailyNote={actions.onSetDailyNote}
                onOpenDetail={actions.onOpenHabitDetail}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
