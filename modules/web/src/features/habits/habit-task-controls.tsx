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
  HabitStatus,
} from "@core/habits/model";
import { cn } from "cn";
import {
  Check,
  Clock3,
  Dumbbell,
  Flame,
  LineChart,
  MessageSquarePlus,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
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
  setDailyNote?: (
    habitId: string,
    note: string,
    date: string,
  ) => void | Promise<unknown>;
  setStatus?: (habitId: string, status: HabitStatus) => void | Promise<unknown>;
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
export function HabitNegativeStatusRing({ habit }: { habit: HabitListItem }) {
  const count = habit.todayEvaluation?.events.length ?? 0;
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
  const count = habit.todayEvaluation?.events.length ?? 0;
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
      className="relative z-1 flex shrink-0 items-center gap-1 self-start md:mt-0.5"
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
  const currentStreak = habit.streak.currentStreak;
  const unit = habit.streak.unit;
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
          {habit.kind === "negative"
            ? "反向"
            : habit.trackTime
              ? "计时打卡"
              : "打卡"}{" "}
          · {scheduleLabel}
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

function formatEventTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Interactive today execution and log card rendered inside TaskForm for Habit-backed Todos. */
export function TaskHabitExecutionCard({
  habit,
  date,
  disabled,
  actions,
}: {
  habit: HabitListItem;
  date: string;
  disabled?: boolean;
  actions: HabitTaskActions;
}) {
  const [lapseNote, setLapseNote] = useState("");
  const [dailyNoteDraft, setDailyNoteDraft] = useState(
    habit.todayEvaluation?.note || "",
  );
  const [editingNote, setEditingNote] = useState(false);

  useEffect(() => {
    setDailyNoteDraft(habit.todayEvaluation?.note || "");
    setEditingNote(false);
  }, [habit.id, habit.todayEvaluation?.note]);

  const evalData = habit.todayEvaluation;
  const events = evalData?.events ?? [];
  const count = events.length;
  const achieved = Boolean(evalData?.achieved);
  const isNegative = habit.kind === "negative";
  const isPausedOrArchived = habit.status !== "active";
  const scheduleLabel = formatScheduleLabel(habit.schedule);

  const typeBadge = isNegative
    ? {
        label: "反向记次",
        icon: <ShieldCheck className="size-3 text-(--habit-accent)" />,
      }
    : habit.trackTime
      ? {
          label: "计时打卡",
          icon: <Clock3 className="size-3 text-(--habit-accent)" />,
        }
      : {
          label: "普通打卡",
          icon: <Sparkles className="size-3 text-(--habit-accent)" />,
        };

  return (
    <section
      aria-label="今日习惯状态与记录"
      className="mt-4 ml-[30px] space-y-3 rounded-xl border border-border/75 bg-muted/20 p-3.5 max-md:ml-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-0.5 font-medium text-foreground">
            {typeBadge.icon}
            {typeBadge.label}
          </span>
          <span className="text-muted-foreground">{scheduleLabel}</span>
          {habit.streak.currentStreak > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-(--habit-accent) tabular-nums">
              <Flame className="size-3" />
              连续 {habit.streak.currentStreak} {habit.streak.unit}
            </span>
          )}
        </div>

        {actions.openDetail && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => actions.openDetail?.(habit.id)}
            className="h-7 gap-1 px-2 text-xs text-(--habit-accent) hover:bg-(--habit-accent)/12 hover:text-(--habit-accent)"
          >
            <LineChart className="size-3.5" />
            热力图与历史
          </Button>
        )}
      </div>

      {isPausedOrArchived ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            当前状态：
            {habit.status === "paused" ? "已暂停（不计入今日）" : "已归档"}
          </span>
          {actions.setStatus && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => void actions.setStatus?.(habit.id, "active")}
              className="h-7 gap-1 px-2.5 text-xs"
            >
              <Play className="size-3" />
              恢复追踪
            </Button>
          )}
        </div>
      ) : isNegative ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                count === 0
                  ? "bg-(--habit-accent)/14 text-(--habit-accent)"
                  : "bg-(--due-tomorrow)/15 text-(--due-tomorrow)",
              )}
            >
              {count === 0 ? (
                <>
                  <ShieldCheck className="size-3.5" />
                  今日未发生（当前默认达成）
                </>
              ) : (
                <>
                  <ShieldAlert className="size-3.5" />
                  今日破例 {count} 次（今日未达成）
                </>
              )}
            </span>

            {count > 0 && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                onClick={() => void actions.undoNegative(habit.id, date)}
                className="h-7 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                撤销最近一次
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={lapseNote}
              onChange={(e) => setLapseNote(e.target.value)}
              disabled={disabled}
              placeholder="如没做到，可附一句原因后点击「记一次」（可选）"
              className="h-8 min-w-[200px] flex-1 bg-background/80 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.stopPropagation();
                  void actions.recordNegative(
                    habit.id,
                    date,
                    lapseNote.trim() || undefined,
                  );
                  setLapseNote("");
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                void actions.recordNegative(
                  habit.id,
                  date,
                  lapseNote.trim() || undefined,
                );
                setLapseNote("");
              }}
              className="h-8 gap-1 border-(--due-tomorrow)/40 px-3 text-xs font-medium text-(--due-tomorrow) hover:bg-(--due-tomorrow)/12 hover:text-(--due-tomorrow)"
            >
              <Plus className="size-3.5" />
              记一次
            </Button>
          </div>

          {events.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border/60 bg-background/50 p-2">
              <div className="px-1 text-[11px] font-medium text-muted-foreground">
                今日破例记录
              </div>
              {events.map((ev, index) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      #{index + 1} · {formatEventTime(ev.occurredAtMs)}
                    </span>
                    {ev.note ? (
                      <span className="ml-2 text-foreground">{ev.note}</span>
                    ) : (
                      <span className="ml-2 text-muted-foreground/70">
                        无备注
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      void actions.undoNegative(habit.id, date, ev.id)
                    }
                    title="撤销此条记录"
                    className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                    撤销
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium",
                achieved
                  ? "bg-(--habit-accent)/15 text-(--habit-accent)"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Check className="size-3.5" />
              {achieved
                ? "今日已达成"
                : evalData && evalData.requiredTotalCount > 0
                  ? `今日进度 ${evalData.requiredDoneCount} / ${evalData.requiredTotalCount} 项`
                  : "今日待打卡"}
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            variant={achieved ? "outline" : "default"}
            disabled={disabled}
            onClick={() =>
              void actions.togglePositive(habit.id, date, !achieved)
            }
            className={cn(
              "h-8 gap-1.5 px-3 text-xs",
              !achieved &&
                "bg-(--habit-accent) text-background hover:bg-(--habit-accent)/90",
            )}
          >
            <Check className="size-3.5" />
            {achieved ? "已打卡（点击撤销）" : "完成今日打卡"}
          </Button>
        </div>
      )}

      {actions.setDailyNote && (
        <div className="border-t border-border/55 pt-2">
          {editingNote ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={dailyNoteDraft}
                onChange={(e) => setDailyNoteDraft(e.target.value)}
                placeholder="写一句今日回顾或执行心得…"
                className="h-7 flex-1 bg-background/80 text-xs"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.stopPropagation();
                    void actions.setDailyNote?.(
                      habit.id,
                      dailyNoteDraft.trim(),
                      date,
                    );
                    setEditingNote(false);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setDailyNoteDraft(habit.todayEvaluation?.note || "");
                    setEditingNote(false);
                  }
                }}
              />
              <Button
                type="button"
                size="xs"
                disabled={disabled}
                onClick={() => {
                  void actions.setDailyNote?.(
                    habit.id,
                    dailyNoteDraft.trim(),
                    date,
                  );
                  setEditingNote(false);
                }}
                className="h-7 px-2.5 text-xs"
              >
                保存
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setDailyNoteDraft(habit.todayEvaluation?.note || "");
                  setEditingNote(false);
                }}
                className="h-7 px-2 text-xs"
              >
                取消
              </Button>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditingNote(true)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            >
              <span className="truncate">
                {habit.todayEvaluation?.note
                  ? `今日回顾：${habit.todayEvaluation.note}`
                  : "+ 写一句今日习惯回顾（可选）"}
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
