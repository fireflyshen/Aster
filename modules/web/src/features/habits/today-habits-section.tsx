import { Button } from "@/components/ui/button";
import type { TodayHabitsResponse } from "@core/habits/model";
import type { SavedTag } from "@core/workspace/organization";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { HabitExecutionRow } from "./habit-execution-row";

export type TodayHabitsActions = {
  disabled?: boolean;
  onTogglePositive: (habitId: string, date: string, completed?: boolean) => void;
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
  onOpenHabitsPage: () => void;
  onOpenHabitDetail?: (habitId: string) => void;
};

/** Collapsible "习惯" section displayed inside Today view for scheduled daily habits. */
export function TodayHabitsSection({
  todayData,
  availableLabels,
  actions,
}: {
  todayData: TodayHabitsResponse | null;
  availableLabels: readonly SavedTag[];
  actions: TodayHabitsActions;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!todayData || todayData.items.length === 0) {
    return null;
  }

  const { summary, todayDate, items } = todayData;
  const summaryParts: string[] = [];
  if (summary.positiveTotal > 0) {
    summaryParts.push(`打卡 ${summary.positiveDone}/${summary.positiveTotal}`);
  }
  if (summary.negativeTotal > 0) {
    summaryParts.push(`未破例 ${summary.negativeClean}/${summary.negativeTotal}`);
  }

  return (
    <section aria-label="今日习惯" className="min-w-0">
      <div className="mb-1 flex h-10 items-center justify-between gap-2 border-b border-border/80">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((prev) => !prev)}
          className="-ml-2 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors select-none hover:bg-(--row-hover)"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
          <h2 className="text-sm font-semibold text-foreground">习惯</h2>
          <span className="text-xs font-normal tabular-nums text-muted-foreground/80">
            {summary.total}
          </span>
          {summaryParts.length > 0 && (
            <span className="hidden text-xs font-normal tabular-nums text-muted-foreground/75 sm:inline">
              · {summaryParts.join(" · ")}
            </span>
          )}
        </button>

        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={actions.onOpenHabitsPage}
          className="h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          管理与热力图
        </Button>
      </div>

      <div hidden={collapsed} className="pl-1">
        {items.map((entry) => (
          <HabitExecutionRow
            key={entry.habit.id}
            habit={entry.habit}
            evaluation={entry.evaluation}
            availablePlans={entry.availablePlans}
            streak={entry.streak}
            availableLabels={availableLabels}
            date={todayDate}
            isToday
            disabled={actions.disabled}
            onTogglePositive={actions.onTogglePositive}
            onSetChecklistItem={actions.onSetChecklistItem}
            onSwitchPlan={actions.onSwitchPlan}
            onRecordNegative={actions.onRecordNegative}
            onUndoNegative={actions.onUndoNegative}
            onUpdateNegativeNote={actions.onUpdateNegativeNote}
            onSetDailyNote={actions.onSetDailyNote}
            onOpenDetail={actions.onOpenHabitDetail}
          />
        ))}
      </div>
    </section>
  );
}
