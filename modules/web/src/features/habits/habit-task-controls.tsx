import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatScheduleLabel } from "@core/habits/logic";
import type {
  HabitChecklistEntryProgress,
  HabitListItem,
} from "@core/habits/model";
import { cn } from "cn";
import {
  Dumbbell,
  Flame,
  MessageSquarePlus,
  Plus,
  Repeat2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";

export type HabitTaskActions = {
  togglePositive: (
    habitId: string,
    date: string,
    completed?: boolean,
  ) => void | Promise<unknown>;
  setChecklistItem: (input: {
    habitId: string;
    itemId: string;
    date: string;
    done?: boolean;
    sets?: string | null;
    reps?: string | null;
    weight?: string | null;
    planId?: string;
  }) => void | Promise<unknown>;
  switchPlan: (
    habitId: string,
    planId: string,
    date: string,
  ) => void | Promise<unknown>;
  recordNegative: (
    habitId: string,
    date: string,
    note?: string,
  ) => void | Promise<unknown>;
  undoNegative: (
    habitId: string,
    date: string,
    eventId?: string,
  ) => void | Promise<unknown>;
  assignSubtaskPlan?: (
    parentHabit: HabitListItem,
    subtaskUuid: string,
    planKey: "A" | "B",
  ) => void | Promise<unknown>;
  openDetail?: (habitId: string) => void;
};

function formatMetricSummary(entry?: HabitChecklistEntryProgress): string {
  if (!entry) return "";
  const parts: string[] = [];
  if (entry.sets && entry.reps) {
    parts.push(`${entry.sets}组×${entry.reps}`);
  } else if (entry.sets) {
    parts.push(`${entry.sets}组`);
  } else if (entry.reps) {
    parts.push(`${entry.reps}次`);
  }
  if (entry.weight) parts.push(entry.weight);
  return parts.join(" · ");
}

/** Left status indicator replacing the checkbox for negative ("avoid") habit Todos. */
export function HabitNegativeStatusRing({
  habit,
}: {
  habit: HabitListItem;
}) {
  const count = habit.todayEvaluation?.occurrenceCount ?? 0;
  const broken = count > 0;
  const paused = habit.status === "paused";

  return (
    <span
      title={
        paused
          ? "已暂停"
          : broken
            ? `今日发生 ${count} 次`
            : "今日未发生（反向习惯默认达成）"
      }
      aria-label={broken ? `今日发生 ${count} 次` : "今日未发生"}
      className={cn(
        "flex size-5 items-center justify-center rounded-full border transition-colors",
        paused
          ? "border-border bg-muted/50 text-muted-foreground"
          : broken
            ? "border-(--due-tomorrow)/50 bg-(--due-tomorrow)/12 text-(--due-tomorrow)"
            : "border-(--habit-accent)/55 bg-(--habit-accent)/14 text-(--habit-accent)",
      )}
    >
      {broken ? (
        <ShieldAlert className="size-3.5" strokeWidth={2} />
      ) : (
        <ShieldCheck className="size-3.5" strokeWidth={2} />
      )}
    </span>
  );
}

/** Inline action strip for negative habit rows ("今日未发生" / "记一次" / "带备注记一次" / "撤销"). */
export function HabitNegativeRowControls({
  habit,
  date,
  disabled,
  onRecordNegative,
  onUndoNegative,
}: {
  habit: HabitListItem;
  date: string;
  disabled?: boolean;
  onRecordNegative: HabitTaskActions["recordNegative"];
  onUndoNegative: HabitTaskActions["undoNegative"];
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const count = habit.todayEvaluation?.occurrenceCount ?? 0;
  const paused = habit.status === "paused";
  const latestNote = habit.todayEvaluation?.events.at(-1)?.note;

  if (paused || habit.status === "archived") {
    return (
      <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-border/70 px-2 text-[11px] text-muted-foreground">
        {habit.status === "archived" ? "已归档" : "已暂停"}
      </span>
    );
  }

  return (
    <div
      data-no-drag
      onClick={(event) => event.stopPropagation()}
      className="flex shrink-0 items-center gap-1 self-start md:mt-0.5"
    >
      <span
        className={cn(
          "inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-medium tabular-nums whitespace-nowrap",
          count === 0
            ? "bg-(--habit-accent)/14 text-(--habit-accent)"
            : "bg-(--due-tomorrow)/14 text-(--due-tomorrow)",
        )}
        title={latestNote ? `最近备注：${latestNote}` : undefined}
      >
        {count === 0 ? "今日未发生" : `发生 ${count} 次`}
      </span>

      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={disabled}
        onClick={() => void onRecordNegative(habit.id, date)}
        className="h-7 gap-1 px-2 text-[11.5px] font-normal text-muted-foreground hover:text-foreground"
        title="记录破例一次"
      >
        <Plus className="size-3" />
        记一次
      </Button>

      <Popover open={noteOpen} onOpenChange={setNoteOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label="带备注记录一次"
            title="带备注记一次"
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <MessageSquarePlus className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-60 space-y-2 p-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-medium text-foreground">带备注记录一次</p>
          <Input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="例如：聚餐、加班后没忍住…"
            className="h-8 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void onRecordNegative(
                  habit.id,
                  date,
                  noteDraft.trim() || undefined,
                );
                setNoteDraft("");
                setNoteOpen(false);
              }
            }}
          />
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setNoteOpen(false)}
              className="h-7 px-2 text-xs"
            >
              取消
            </Button>
            <Button
              type="button"
              size="xs"
              disabled={disabled}
              onClick={() => {
                void onRecordNegative(
                  habit.id,
                  date,
                  noteDraft.trim() || undefined,
                );
                setNoteDraft("");
                setNoteOpen(false);
              }}
              className="h-7 px-2.5 text-xs"
            >
              记一次
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {count > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label="撤销最近一次"
          title="撤销最近一次"
          onClick={() => void onUndoNegative(habit.id, date)}
          className="size-7 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/** Compact habit metadata badge (schedule, streak, A/B switcher) shown inside TaskMetaChips. */
export function HabitMetaChip({
  habit,
  date,
  disabled,
  onSwitchPlan,
  onOpenDetail,
}: {
  habit: HabitListItem;
  date: string;
  disabled?: boolean;
  onSwitchPlan?: HabitTaskActions["switchPlan"];
  onOpenDetail?: (habitId: string) => void;
}) {
  const scheduleLabel = formatScheduleLabel(habit.schedule);
  const currentStreak = habit.streak.current;
  const unit = habit.streak.unit === "days" ? "天" : "次";
  const activePlan = habit.todayEvaluation?.planId
    ? habit.plans.find((p) => p.id === habit.todayEvaluation?.planId)
    : undefined;
  const canSwitchPlan =
    habit.abEnabled && habit.plans.length > 1 && Boolean(onSwitchPlan);

  const nextPlan =
    canSwitchPlan && activePlan
      ? habit.plans.find((p) => p.id !== activePlan.id)
      : undefined;

  return (
    <>
      <button
        type="button"
        data-no-drag
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetail?.(habit.id);
        }}
        title="查看习惯热力图与历史记录"
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11.5px] leading-none transition-colors whitespace-nowrap",
          onOpenDetail
            ? "cursor-pointer hover:bg-(--habit-accent)/18"
            : "cursor-default",
          habit.status === "paused"
            ? "bg-muted text-muted-foreground"
            : "bg-(--habit-accent)/12 text-(--habit-accent)",
        )}
      >
        <Repeat2 className="size-3 shrink-0" strokeWidth={1.6} />
        <span>
          {habit.kind === "negative" ? "反向" : "习惯"} · {scheduleLabel}
        </span>
        {currentStreak > 0 && (
          <span className="inline-flex items-center gap-0.5 font-medium tabular-nums">
            <Flame className="size-2.5" strokeWidth={1.8} />
            {currentStreak}
            {unit}
          </span>
        )}
        {habit.status === "paused" && <span>(已暂停)</span>}
      </button>

      {canSwitchPlan && activePlan && nextPlan && (
        <button
          type="button"
          data-no-drag
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            void onSwitchPlan?.(habit.id, nextPlan.id, date);
          }}
          title={`当前执行 ${activePlan.name}，点击切换为 ${nextPlan.name}`}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-border/80 bg-secondary/70 px-1.5 py-0.5 text-[11px] leading-none text-foreground/85 transition-colors hover:bg-secondary whitespace-nowrap"
        >
          <Dumbbell className="size-2.5 shrink-0 opacity-75" />
          <span>{activePlan.name}</span>
        </button>
      )}
    </>
  );
}

/** Inline sets/reps/weight editor and optional A/B plan badge for a subtask of a Habit Todo. */
export function HabitSubtaskMetricsButton({
  parentHabit,
  subtaskUuid,
  date,
  disabled,
  onSetChecklistItem,
  onAssignSubtaskPlan,
}: {
  parentHabit: HabitListItem;
  subtaskUuid: string;
  date: string;
  disabled?: boolean;
  onSetChecklistItem: HabitTaskActions["setChecklistItem"];
  onAssignSubtaskPlan?: HabitTaskActions["assignSubtaskPlan"];
}) {
  const entry = parentHabit.todayEvaluation?.checklistProgress[subtaskUuid];
  const metricText = formatMetricSummary(entry);
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState(entry?.sets || "");
  const [reps, setReps] = useState(entry?.reps || "");
  const [weight, setWeight] = useState(entry?.weight || "");

  useEffect(() => {
    if (!open) {
      setSets(entry?.sets || "");
      setReps(entry?.reps || "");
      setWeight(entry?.weight || "");
    }
  }, [entry?.reps, entry?.sets, entry?.weight, open]);

  const currentPlanKey: "A" | "B" =
    parentHabit.subtaskPlans?.[subtaskUuid] === "B" ? "B" : "A";
  const nextPlanKey: "A" | "B" = currentPlanKey === "A" ? "B" : "A";

  return (
    <div
      data-no-drag
      onClick={(e) => e.stopPropagation()}
      className="flex shrink-0 items-center gap-1"
    >
      {parentHabit.abEnabled && onAssignSubtaskPlan && (
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void onAssignSubtaskPlan(parentHabit, subtaskUuid, nextPlanKey)
          }
          title={`属于方案 ${currentPlanKey}，点击切换至方案 ${nextPlanKey}`}
          className="inline-flex h-5 items-center rounded border border-border/80 px-1.5 text-[10.5px] font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground cursor-pointer"
        >
          {currentPlanKey}
        </button>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title="填写组数、次数、重量（可选）"
            className={cn(
              "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 text-[11px] transition-colors",
              metricText
                ? "bg-secondary/80 text-foreground/85 hover:bg-secondary"
                : "text-muted-foreground/75 opacity-75 hover:bg-muted hover:text-foreground hover:opacity-100",
            )}
          >
            <SlidersHorizontal className="size-3 shrink-0" />
            <span>{metricText || "成绩"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 space-y-2.5 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-medium text-foreground">
            今日训练成绩（可选）
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>组数</span>
              <Input
                value={sets}
                onChange={(e) => setSets(e.target.value)}
                placeholder="3"
                className="h-7 px-2 text-xs"
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>次数</span>
              <Input
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                placeholder="12"
                className="h-7 px-2 text-xs"
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>重量</span>
              <Input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="40kg"
                className="h-7 px-2 text-xs"
              />
            </label>
          </div>
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setOpen(false)}
              className="h-7 px-2 text-xs"
            >
              取消
            </Button>
            <Button
              type="button"
              size="xs"
              disabled={disabled}
              onClick={() => {
                void onSetChecklistItem({
                  habitId: parentHabit.id,
                  itemId: subtaskUuid,
                  date,
                  planId: parentHabit.todayEvaluation?.planId,
                  sets: sets.trim() || null,
                  reps: reps.trim() || null,
                  weight: weight.trim() || null,
                });
                setOpen(false);
              }}
              className="h-7 px-2.5 text-xs"
            >
              保存
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
