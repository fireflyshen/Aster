import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatScheduleLabel } from "@core/habits/logic";
import type {
  BindTaskHabitInput,
  HabitKind,
  HabitListItem,
  HabitSchedule,
  HabitStatus,
} from "@core/habits/model";
import { addLocalDays, localDateOf } from "@core/time/zone";
import { cn } from "cn";
import {
  CalendarCheck2,
  Flame,
  LineChart,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

const WEEKDAY_BUTTONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 7, label: "日" },
];

export type TaskHabitDraft = {
  enabled: boolean;
  kind: HabitKind;
  scheduleType: "daily" | "weekly" | "interval";
  weekdays: number[];
  intervalDays: string;
  abEnabled: boolean;
  subtaskPlans: Record<string, "A" | "B">;
  effectiveMode: "tomorrow" | "today";
};

export function createHabitDraftFromItem(
  habit?: HabitListItem,
  presetEnabled = false,
): TaskHabitDraft {
  if (!habit) {
    return {
      enabled: presetEnabled,
      kind: "positive",
      scheduleType: "daily",
      weekdays: [1, 3, 5],
      intervalDays: "2",
      abEnabled: false,
      subtaskPlans: {},
      effectiveMode: "tomorrow",
    };
  }
  return {
    enabled: true,
    kind: habit.kind,
    scheduleType: habit.schedule.type,
    weekdays:
      habit.schedule.type === "weekly" ? [...habit.schedule.weekdays] : [1, 3, 5],
    intervalDays:
      habit.schedule.type === "interval"
        ? String(habit.schedule.intervalDays)
        : "2",
    abEnabled: habit.abEnabled,
    subtaskPlans: { ...(habit.subtaskPlans ?? {}) },
    effectiveMode: "tomorrow",
  };
}

export function buildScheduleFromHabitDraft(
  draft: TaskHabitDraft,
  todayDate: string,
  existing?: HabitListItem,
): HabitSchedule {
  if (draft.scheduleType === "daily") {
    return { type: "daily" };
  }
  if (draft.scheduleType === "weekly") {
    const days = [...new Set(draft.weekdays)]
      .filter((d) => d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    return { type: "weekly", weekdays: days.length ? days : [1] };
  }
  const parsed = Number.parseInt(draft.intervalDays, 10);
  const intervalDays = Number.isFinite(parsed) && parsed >= 2 ? parsed : 2;
  const anchorDate =
    existing?.schedule.type === "interval"
      ? existing.schedule.anchorDate
      : todayDate;
  return { type: "interval", intervalDays, anchorDate };
}

export function isHabitDraftDirty(
  draft: TaskHabitDraft,
  existing?: HabitListItem,
): boolean {
  if (!existing) return draft.enabled;
  if (!draft.enabled) return true;
  if (draft.kind !== existing.kind) return true;
  if (draft.abEnabled !== existing.abEnabled) return true;
  if (
    JSON.stringify(draft.subtaskPlans) !==
    JSON.stringify(existing.subtaskPlans ?? {})
  ) {
    return true;
  }
  if (draft.scheduleType !== existing.schedule.type) return true;
  if (
    draft.scheduleType === "weekly" &&
    existing.schedule.type === "weekly" &&
    JSON.stringify([...draft.weekdays].sort((a, b) => a - b)) !==
      JSON.stringify([...existing.schedule.weekdays].sort((a, b) => a - b))
  ) {
    return true;
  }
  if (
    draft.scheduleType === "interval" &&
    existing.schedule.type === "interval" &&
    (Number.parseInt(draft.intervalDays, 10) || 2) !==
      existing.schedule.intervalDays
  ) {
    return true;
  }
  return false;
}

export function buildBindInputFromDraft(
  taskUuid: string,
  draft: TaskHabitDraft,
  todayDate: string,
  existing?: HabitListItem,
): BindTaskHabitInput {
  const schedule = buildScheduleFromHabitDraft(draft, todayDate, existing);
  const tomorrow = addLocalDays(todayDate, 1);
  return {
    taskUuid,
    kind: draft.kind,
    schedule,
    abEnabled: draft.kind === "positive" ? draft.abEnabled : false,
    subtaskPlans: draft.subtaskPlans,
    ...(existing
      ? {
          effectiveFromDate:
            draft.effectiveMode === "today" ? todayDate : tomorrow,
        }
      : {}),
  };
}

export function currentLocalTodayDate(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  return localDateOf(Date.now(), tz);
}

/** Right-rail Habit field inside Aster's native TaskForm sidebar. */
export function TaskHabitSidebarField({
  value,
  existingHabit,
  disabled,
  hasSubtasks,
  onChange,
  onStatusChange,
  onOpenDetail,
}: {
  value: TaskHabitDraft;
  existingHabit?: HabitListItem;
  disabled: boolean;
  hasSubtasks: boolean;
  onChange: (next: TaskHabitDraft) => void;
  onStatusChange?: (status: HabitStatus) => void;
  onOpenDetail?: (habitId: string) => void;
}) {
  function toggleWeekday(day: number) {
    const has = value.weekdays.includes(day);
    if (has && value.weekdays.length === 1) return;
    const next = has
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day].sort((a, b) => a - b);
    onChange({ ...value, weekdays: next });
  }

  return (
    <div className="task-detail-properties">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs leading-4 font-medium text-muted-foreground">
            习惯
          </Label>
          {value.enabled ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, enabled: false })}
              className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-(--navigation-hover) hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3" />
              取消习惯
            </button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ ...value, enabled: true })}
              className="h-6 gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-(--navigation-hover) hover:text-foreground"
            >
              <CalendarCheck2 className="size-3.5" />
              设为习惯
            </Button>
          )}
        </div>

        {!value.enabled ? (
          <p className="text-xs text-muted-foreground/70">
            普通待办（勾选即完成）。开启后可按周期每日打卡或反向记次。
          </p>
        ) : (
          <div className="space-y-2.5 rounded-lg border border-border/80 bg-(--habit-surface)/50 p-2.5">
            {existingHabit && (
              <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/60 pb-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
                  <Flame className="size-3 text-(--habit-accent)" />
                  {existingHabit.streak.currentStreak > 0
                    ? `连续 ${existingHabit.streak.currentStreak} ${existingHabit.streak.unit}`
                    : "暂无连续记录"}
                </span>
                {onOpenDetail && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onOpenDetail(existingHabit.id)}
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--habit-accent) hover:underline"
                  >
                    <LineChart className="size-3" />
                    热力图/历史
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, kind: "positive" })}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                  value.kind === "positive"
                    ? "border-(--habit-accent)/55 bg-background font-medium text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-background/60",
                )}
              >
                <Sparkles className="size-3 text-(--habit-accent)" />
                正向打卡
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({ ...value, kind: "negative", abEnabled: false })
                }
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                  value.kind === "negative"
                    ? "border-(--habit-accent)/55 bg-background font-medium text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-background/60",
                )}
              >
                <ShieldCheck className="size-3 text-muted-foreground" />
                反向记次
              </button>
            </div>

            <div className="space-y-1.5">
              <Select
                disabled={disabled}
                value={value.scheduleType}
                onValueChange={(next) =>
                  onChange({
                    ...value,
                    scheduleType: next as TaskHabitDraft["scheduleType"],
                  })
                }
              >
                <SelectTrigger className="h-8 bg-background text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">每天执行</SelectItem>
                  <SelectItem value="weekly">每周指定几天</SelectItem>
                  <SelectItem value="interval">每隔 N 天</SelectItem>
                </SelectContent>
              </Select>

              {value.scheduleType === "weekly" && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {WEEKDAY_BUTTONS.map((day) => {
                    const selected = value.weekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleWeekday(day.value)}
                        className={cn(
                          "size-6 cursor-pointer rounded border text-[11px] transition-colors",
                          selected
                            ? "border-(--habit-accent) bg-(--habit-level-2) font-semibold text-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-foreground/30",
                        )}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {value.scheduleType === "interval" && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>每</span>
                  <Input
                    type="number"
                    min={2}
                    max={365}
                    disabled={disabled}
                    value={value.intervalDays}
                    onChange={(e) =>
                      onChange({ ...value, intervalDays: e.target.value })
                    }
                    className="h-7 w-16 bg-background text-xs tabular-nums"
                  />
                  <span>天一次</span>
                </div>
              )}
            </div>

            {value.kind === "positive" && (
              <label className="flex cursor-pointer items-center justify-between gap-2 pt-0.5 text-[11px] text-muted-foreground">
                <span>
                  A/B 双方案轮换
                  {!hasSubtasks && "（添加子任务后可分组）"}
                </span>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value.abEnabled}
                  onChange={(e) =>
                    onChange({ ...value, abEnabled: e.target.checked })
                  }
                  className="size-3.5 accent-(--habit-accent)"
                />
              </label>
            )}

            {existingHabit && isHabitDraftDirty(value, existingHabit) && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-[11px]">
                <span className="text-muted-foreground">规则生效：</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...value, effectiveMode: "tomorrow" })
                    }
                    className={cn(
                      "cursor-pointer rounded px-1.5 py-0.5",
                      value.effectiveMode === "tomorrow"
                        ? "bg-background font-medium text-foreground shadow-xs"
                        : "text-muted-foreground",
                    )}
                  >
                    明天起
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...value, effectiveMode: "today" })
                    }
                    className={cn(
                      "cursor-pointer rounded px-1.5 py-0.5",
                      value.effectiveMode === "today"
                        ? "bg-background font-medium text-foreground shadow-xs"
                        : "text-muted-foreground",
                    )}
                  >
                    今天起
                  </button>
                </div>
              </div>
            )}

            {existingHabit && onStatusChange && (
              <div className="flex items-center justify-between gap-1.5 border-t border-border/60 pt-2">
                <span className="text-[11px] text-muted-foreground">
                  状态：
                  {existingHabit.status === "active"
                    ? "运行中"
                    : existingHabit.status === "paused"
                      ? "已暂停"
                      : "已归档"}
                </span>
                {existingHabit.status === "active" ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onStatusChange("paused")}
                    className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <Pause className="size-3" />
                    暂停
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onStatusChange("active")}
                    className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--habit-accent) hover:bg-background"
                  >
                    <Play className="size-3" />
                    恢复
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact habit toggle pill inside QuickAdd dialog. */
export function QuickAddHabitButton({
  value,
  disabled,
  onChange,
}: {
  value: TaskHabitDraft;
  disabled: boolean;
  onChange: (next: TaskHabitDraft) => void;
}) {
  const todayDate = currentLocalTodayDate();
  const scheduleLabel = formatScheduleLabel(
    buildScheduleFromHabitDraft(value, todayDate),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-7 gap-1.5 rounded-md px-2 text-xs font-normal shadow-none",
            value.enabled
              ? "border-(--habit-accent)/55 bg-(--habit-level-1)/45 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarCheck2 className="size-3.5 text-(--habit-accent)" />
          <span>
            {value.enabled
              ? `${value.kind === "negative" ? "反向" : "习惯"} · ${scheduleLabel}`
              : "设为习惯"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">
            作为习惯追踪
          </span>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            className="size-3.5 accent-(--habit-accent)"
          />
        </div>
        {value.enabled && (
          <>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => onChange({ ...value, kind: "positive" })}
                className={cn(
                  "cursor-pointer rounded border px-2 py-1 text-xs",
                  value.kind === "positive"
                    ? "border-(--habit-accent) bg-(--habit-level-1)/40 font-medium text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                正向打卡
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...value, kind: "negative" })}
                className={cn(
                  "cursor-pointer rounded border px-2 py-1 text-xs",
                  value.kind === "negative"
                    ? "border-(--habit-accent) bg-(--habit-level-1)/40 font-medium text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                反向记次
              </button>
            </div>
            <div className="flex gap-1">
              {(["daily", "weekly", "interval"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange({ ...value, scheduleType: t })}
                  className={cn(
                    "flex-1 cursor-pointer rounded border px-1.5 py-1 text-[11px]",
                    value.scheduleType === t
                      ? "border-(--habit-accent) bg-(--habit-level-1)/40 font-medium text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {t === "daily" ? "每天" : t === "weekly" ? "按周" : "间隔"}
                </button>
              ))}
            </div>
            {value.scheduleType === "weekly" && (
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_BUTTONS.map((d) => {
                  const selected = value.weekdays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        if (selected && value.weekdays.length === 1) return;
                        onChange({
                          ...value,
                          weekdays: selected
                            ? value.weekdays.filter((x) => x !== d.value)
                            : [...value.weekdays, d.value].sort(
                                (a, b) => a - b,
                              ),
                        });
                      }}
                      className={cn(
                        "size-6 cursor-pointer rounded border text-[11px]",
                        selected
                          ? "border-(--habit-accent) bg-(--habit-level-2) font-semibold"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            )}
            {value.scheduleType === "interval" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>每隔</span>
                <Input
                  type="number"
                  min={2}
                  max={365}
                  value={value.intervalDays}
                  onChange={(e) =>
                    onChange({ ...value, intervalDays: e.target.value })
                  }
                  className="h-7 w-16 text-xs"
                />
                <span>天</span>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
