import { Button } from "@/components/ui/button";
import { isoWeekday } from "@core/habits/logic";
import type { DayDetailResponse } from "@core/habits/model";
import { addLocalDays } from "@core/time/zone";
import type { SavedTag } from "@core/workspace/organization";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { HabitExecutionRow } from "./habit-execution-row";

const WEEKDAY_FULL = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
] as const;

/** Interactive day inspection & backfill card triggered when selecting a heatmap date. */
export function HabitDayDetailPanel({
  detail,
  availableLabels,
  disabled,
  onSelectDate,
  onClose,
  onTogglePositive,
  onSetChecklistItem,
  onSwitchPlan,
  onRecordNegative,
  onUndoNegative,
  onUpdateNegativeNote,
  onSetDailyNote,
  onOpenHabitDetail,
}: {
  detail: DayDetailResponse;
  availableLabels: readonly SavedTag[];
  disabled?: boolean;
  onSelectDate: (date: string) => void;
  onClose: () => void;
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
  onOpenHabitDetail: (habitId: string) => void;
}) {
  const wd = WEEKDAY_FULL[isoWeekday(detail.date) - 1];
  const prevDay = addLocalDays(detail.date, -1);
  const nextDay = addLocalDays(detail.date, 1);
  const canGoNext = nextDay <= detail.todayDate;

  return (
    <section
      aria-label="当日习惯明细"
      className="rounded-xl border border-border/80 bg-card/85 p-4 shadow-xs"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="前一天"
            onClick={() => onSelectDate(prevDay)}
            className="size-6 text-muted-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <h3 className="text-sm font-semibold text-foreground tabular-nums">
            {detail.date} · {wd}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="后一天"
            disabled={!canGoNext}
            onClick={() => onSelectDate(nextDay)}
            className="size-6 text-muted-foreground"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <span className="ml-1 text-xs text-muted-foreground tabular-nums">
            {detail.isToday
              ? `今日进行中（共安排 ${detail.scheduledCount} 项）`
              : detail.scheduledCount > 0
                ? `完成 ${detail.achievedCount} / ${detail.scheduledCount} 项`
                : "当日无安排习惯"}
          </span>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="关闭当日明细"
          onClick={onClose}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {detail.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          这一天没有安排或记录任何习惯。
        </p>
      ) : (
        <div>
          {detail.items.map((item) => (
            <HabitExecutionRow
              key={item.habit.id}
              habit={item.habit}
              evaluation={item.evaluation}
              availablePlans={item.availablePlans}
              availableLabels={availableLabels}
              date={detail.date}
              isToday={detail.isToday}
              disabled={disabled}
              onTogglePositive={onTogglePositive}
              onSetChecklistItem={onSetChecklistItem}
              onSwitchPlan={onSwitchPlan}
              onRecordNegative={onRecordNegative}
              onUndoNegative={onUndoNegative}
              onUpdateNegativeNote={onUpdateNegativeNote}
              onSetDailyNote={onSetDailyNote}
              onOpenDetail={onOpenHabitDetail}
            />
          ))}
        </div>
      )}
    </section>
  );
}
