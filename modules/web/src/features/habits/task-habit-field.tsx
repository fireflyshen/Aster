import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { Archive, CalendarCheck2, Clock3, Flame } from "lucide-react";

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
  trackTime: boolean;
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
      trackTime: false,
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
    trackTime: habit.kind === "positive" && Boolean(habit.trackTime),
    scheduleType: habit.schedule.type,
    weekdays:
      habit.schedule.type === "weekly"
        ? [...habit.schedule.weekdays]
        : [1, 3, 5],
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
  const nextTrackTime = draft.kind === "positive" && draft.trackTime;
  const existingTrackTime =
    existing.kind === "positive" && Boolean(existing.trackTime);
  if (nextTrackTime !== existingTrackTime) return true;
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
    trackTime: draft.kind === "positive" ? draft.trackTime : false,
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
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
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

  const activeMode =
    value.kind === "negative"
      ? "negative"
      : value.trackTime
        ? "timed"
        : "checkin";

  const changed = existingHabit && isHabitDraftDirty(value, existingHabit);
  return (
    <section className="task-habit-settings" aria-label="习惯设置">
      <div className="habit-settings-heading">
        <h3>习惯</h3>
        <button
          type="button"
          disabled={disabled}
          className="habit-settings-link"
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
        >
          {value.enabled ? "取消习惯" : "设为习惯"}
        </button>
      </div>
      {!value.enabled ? (
        <p className="habit-settings-hint">
          设为习惯后，可按周期打卡或记录发生次数。
        </p>
      ) : (
        <div className="habit-settings-body">
          {existingHabit && (
            <div className="habit-settings-summary">
              <span className="habit-settings-streak">
                <Flame aria-hidden="true" />
                {existingHabit.streak.currentStreak > 0
                  ? `连续 ${existingHabit.streak.currentStreak} ${existingHabit.streak.unit}`
                  : "尚无连续记录"}
              </span>
              {onOpenDetail && (
                <button
                  type="button"
                  disabled={disabled}
                  className="habit-settings-link"
                  onClick={() => onOpenDetail(existingHabit.id)}
                  aria-label="查看习惯热力图与历史"
                >
                  查看记录
                </button>
              )}
            </div>
          )}
          <div className="habit-settings-field">
            <span className="habit-settings-label">记录方式</span>
            <div
              className="habit-settings-segments"
              data-columns="3"
              role="group"
              aria-label="习惯记录方式"
            >
              <button
                type="button"
                disabled={disabled}
                aria-pressed={activeMode === "checkin"}
                onClick={() =>
                  onChange({ ...value, kind: "positive", trackTime: false })
                }
              >
                纯打卡
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={activeMode === "timed"}
                onClick={() =>
                  onChange({ ...value, kind: "positive", trackTime: true })
                }
              >
                计时打卡
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={activeMode === "negative"}
                onClick={() =>
                  onChange({
                    ...value,
                    kind: "negative",
                    trackTime: false,
                    abEnabled: false,
                  })
                }
              >
                反向记次
              </button>
            </div>
            <p className="habit-settings-hint">
              {activeMode === "negative"
                ? "发生时记次，未发生无需操作。"
                : activeMode === "timed"
                  ? "开始计时，完成后记录时长。"
                  : "做到后打卡。"}
            </p>
          </div>
          <div className="habit-settings-field">
            <Label
              className="habit-settings-label"
              htmlFor="task-habit-frequency"
            >
              执行频率
            </Label>
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
              <SelectTrigger
                id="task-habit-frequency"
                className="habit-settings-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">每天</SelectItem>
                <SelectItem value="weekly">每周指定日期</SelectItem>
                <SelectItem value="interval">间隔执行</SelectItem>
              </SelectContent>
            </Select>
            {value.scheduleType === "weekly" && (
              <div
                className="habit-settings-weekdays"
                role="group"
                aria-label="每周执行日期"
              >
                {WEEKDAY_BUTTONS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    disabled={disabled}
                    aria-label={`星期${day.label}`}
                    aria-pressed={value.weekdays.includes(day.value)}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            )}
            {value.scheduleType === "interval" && (
              <div className="habit-settings-interval">
                <span>每</span>
                <Input
                  type="number"
                  aria-label="执行间隔天数"
                  min={2}
                  max={365}
                  disabled={disabled}
                  value={value.intervalDays}
                  onChange={(e) =>
                    onChange({ ...value, intervalDays: e.target.value })
                  }
                />
                <span>天执行一次</span>
              </div>
            )}
          </div>
          {value.kind === "positive" && (
            <div className="habit-settings-rotation">
              <div className="habit-settings-switch-row">
                <Label htmlFor="task-habit-rotation">A/B 轮换</Label>
                <Switch
                  id="task-habit-rotation"
                  disabled={disabled}
                  checked={value.abEnabled}
                  onCheckedChange={(checked) =>
                    onChange({ ...value, abEnabled: checked })
                  }
                />
              </div>
              {value.abEnabled && (
                <p className="habit-settings-hint">
                  {hasSubtasks
                    ? "完整完成后，下一次切换方案。"
                    : "添加子任务后，可分配 A、B 方案。"}
                </p>
              )}
            </div>
          )}
          {changed && (
            <div className="habit-settings-effective">
              <span className="habit-settings-label">规则生效</span>
              <div
                className="habit-settings-segments"
                role="group"
                aria-label="习惯规则生效日期"
              >
                {(["tomorrow", "today"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={disabled}
                    aria-pressed={value.effectiveMode === mode}
                    onClick={() => onChange({ ...value, effectiveMode: mode })}
                  >
                    {mode === "tomorrow" ? "明天起" : "今天起"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {existingHabit && onStatusChange && (
            <div className="habit-settings-status">
              <span>
                {existingHabit.status === "active"
                  ? "进行中"
                  : existingHabit.status === "paused"
                    ? "已暂停"
                    : "已归档"}
              </span>
              <button
                type="button"
                disabled={disabled}
                className="habit-settings-link"
                onClick={() =>
                  onStatusChange(
                    existingHabit.status === "active" ? "paused" : "active",
                  )
                }
              >
                {existingHabit.status === "active" ? "暂停" : "恢复"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
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
              ? `${value.kind === "negative" ? "反向" : value.trackTime ? "计时习惯" : "打卡"} · ${scheduleLabel}`
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
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() =>
                  onChange({ ...value, kind: "positive", trackTime: false })
                }
                className={cn(
                  "cursor-pointer rounded border px-1.5 py-1 text-[11px]",
                  value.kind === "positive" && !value.trackTime
                    ? "border-(--habit-accent) bg-(--habit-level-1)/40 font-medium text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                纯打卡
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...value, kind: "positive", trackTime: true })
                }
                className={cn(
                  "cursor-pointer rounded border px-1.5 py-1 text-[11px]",
                  value.kind === "positive" && value.trackTime
                    ? "border-(--habit-accent) bg-(--habit-level-1)/40 font-medium text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                计时
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...value, kind: "negative", trackTime: false })
                }
                className={cn(
                  "cursor-pointer rounded border px-1.5 py-1 text-[11px]",
                  value.kind === "negative"
                    ? "border-(--habit-accent) bg-(--habit-level-1)/40 font-medium text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                反打卡
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
