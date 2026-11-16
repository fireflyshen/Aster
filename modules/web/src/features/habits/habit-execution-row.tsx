import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectIcon } from "@/features/projects/project-icon";
import type {
  Habit,
  HabitChecklistEntryProgress,
  HabitChecklistItem,
  HabitDayEvaluation,
  HabitPlan,
  HabitStreakSummary,
} from "@core/habits/model";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Dumbbell,
  MessageSquareText,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";

type HabitExecutionRowProps = {
  habit: Habit;
  evaluation: HabitDayEvaluation;
  availablePlans?: HabitPlan[];
  streak?: HabitStreakSummary;
  availableLabels?: readonly SavedTag[];
  date: string;
  isToday: boolean;
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
  onOpenDetail?: (habitId: string) => void;
};

function formatTimeHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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

function ChecklistItemRow({
  item,
  entry,
  disabled,
  onToggleDone,
  onSaveMetrics,
}: {
  item: HabitChecklistItem;
  entry?: HabitChecklistEntryProgress;
  disabled?: boolean;
  onToggleDone: (done: boolean) => void;
  onSaveMetrics: (patch: {
    sets: string | null;
    reps: string | null;
    weight: string | null;
  }) => void;
}) {
  const done = Boolean(entry?.done);
  const [editingMetrics, setEditingMetrics] = useState(false);
  const [sets, setSets] = useState(entry?.sets ?? "");
  const [reps, setReps] = useState(entry?.reps ?? "");
  const [weight, setWeight] = useState(entry?.weight ?? "");
  const metricSummary = formatMetricSummary(entry);

  function openMetrics() {
    setSets(entry?.sets ?? "");
    setReps(entry?.reps ?? "");
    setWeight(entry?.weight ?? "");
    setEditingMetrics((prev) => !prev);
  }

  function submitMetrics() {
    onSaveMetrics({
      sets: sets.trim() || null,
      reps: reps.trim() || null,
      weight: weight.trim() || null,
    });
    setEditingMetrics(false);
  }

  return (
    <div className="rounded-md py-1 pl-1 pr-1 transition-colors hover:bg-(--row-hover)/60">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={disabled}
          aria-label={`${done ? "取消完成" : "完成"}动作：${item.title}`}
          onClick={() => onToggleDone(!done)}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border transition-all",
            done
              ? "border-(--habit-accent) bg-(--habit-accent) text-white"
              : "border-muted-foreground/45 bg-transparent hover:border-(--habit-accent)",
          )}
        >
          {done && <Check className="size-2.5" strokeWidth={2.6} />}
        </button>
        <span
          onClick={() => !disabled && onToggleDone(!done)}
          className={cn(
            "min-w-0 flex-1 cursor-pointer truncate text-[13px]",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {item.title}
          {!item.required && (
            <span className="ml-1.5 text-[11px] text-muted-foreground/75 no-underline">
              选做
            </span>
          )}
        </span>
        {metricSummary && !editingMetrics && (
          <button
            type="button"
            disabled={disabled}
            onClick={openMetrics}
            className="shrink-0 rounded bg-secondary/80 px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums hover:text-foreground"
          >
            {metricSummary}
          </button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={openMetrics}
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <SlidersHorizontal className="mr-1 size-3" />
          {metricSummary ? "改成绩" : "记成绩"}
        </Button>
      </div>

      {editingMetrics && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMetrics();
          }}
          className="mt-1.5 ml-6 flex flex-wrap items-center gap-1.5"
        >
          <Input
            value={sets}
            onChange={(e) => setSets(e.target.value)}
            placeholder="组数 (如 4)"
            aria-label="组数"
            className="h-7 w-24 text-xs"
          />
          <Input
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="次数 (如 12)"
            aria-label="次数"
            className="h-7 w-24 text-xs"
          />
          <Input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="重量 (如 20kg)"
            aria-label="重量"
            className="h-7 w-28 text-xs"
          />
          <Button
            type="submit"
            size="xs"
            disabled={disabled}
            className="h-7 px-2.5 text-xs"
          >
            保存
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setEditingMetrics(false)}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            取消
          </Button>
        </form>
      )}
    </div>
  );
}

/** Single habit row usable in Today view and Heatmap Day Detail backfill panel. */
export function HabitExecutionRow({
  habit,
  evaluation,
  availablePlans = [],
  streak,
  availableLabels = [],
  date,
  isToday,
  disabled = false,
  onTogglePositive,
  onSetChecklistItem,
  onSwitchPlan,
  onRecordNegative,
  onUndoNegative,
  onUpdateNegativeNote,
  onSetDailyNote,
  onOpenDetail,
}: HabitExecutionRowProps) {
  const isChecklist =
    habit.kind === "positive" && evaluation.completionMode === "checklist";
  const [expanded, setExpanded] = useState(
    () =>
      isChecklist &&
      evaluation.status === "partial" &&
      evaluation.requiredDoneCount > 0,
  );
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(evaluation.note);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventNoteDraft, setEventNoteDraft] = useState("");
  const [slipNoteOpen, setSlipNoteOpen] = useState(false);
  const [slipNoteDraft, setSlipNoteDraft] = useState("");

  const labelColorMap = new Map(
    availableLabels.map((tag) => [tag.name, itemColor(tag.color)]),
  );

  const isAchieved = evaluation.achieved;
  const negativeCount = evaluation.events.length;

  function openDailyNote() {
    setNoteDraft(evaluation.note);
    setNoteOpen((prev) => !prev);
  }

  function submitDailyNote() {
    onSetDailyNote(habit.id, noteDraft, date);
    setNoteOpen(false);
  }

  return (
    <div className="group border-b border-border/55 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2.5">
        {/* Left status indicator */}
        {habit.kind === "positive" ? (
          isChecklist ? (
            <button
              type="button"
              disabled={disabled}
              aria-label={
                expanded
                  ? `收起动作清单：${habit.title}`
                  : `展开动作清单：${habit.title}`
              }
              onClick={() => setExpanded((prev) => !prev)}
              className={cn(
                "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.75px] transition-all",
                isAchieved
                  ? "border-(--habit-accent) bg-(--habit-accent) text-white"
                  : evaluation.status === "partial"
                    ? "border-(--habit-accent) bg-(--habit-accent)/15 text-(--habit-accent)"
                    : "border-muted-foreground/45 text-muted-foreground hover:border-(--habit-accent)",
              )}
            >
              {isAchieved ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : (
                <Dumbbell className="size-2.5" strokeWidth={2} />
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              aria-label={`${isAchieved ? "取消完成" : "完成"}习惯：${habit.title}`}
              onClick={() => onTogglePositive(habit.id, date, !isAchieved)}
              className={cn(
                "group/check relative mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.75px] transition-all",
                isAchieved
                  ? "border-(--habit-accent) bg-(--habit-accent) text-white"
                  : "border-muted-foreground/55 bg-transparent hover:border-(--habit-accent)",
              )}
            >
              {isAchieved ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : (
                <Check
                  className="size-3 text-(--habit-accent) opacity-0 transition-opacity group-hover/check:opacity-75"
                  strokeWidth={2.4}
                />
              )}
            </button>
          )
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
              negativeCount === 0
                ? "border-(--habit-accent)/45 bg-(--habit-accent)/10 text-(--habit-accent)"
                : "border-(--due-tomorrow)/45 bg-(--due-tomorrow)/12 text-(--due-tomorrow)",
            )}
          >
            <ShieldCheck className="size-3" strokeWidth={2} />
          </span>
        )}

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {isChecklist && (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-left text-sm font-medium text-foreground hover:text-foreground/80"
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      isAchieved && "text-muted-foreground line-through",
                    )}
                  >
                    {habit.title}
                  </span>
                </button>
              )}
              {!isChecklist && (
                <button
                  type="button"
                  onClick={() => onOpenDetail?.(habit.id)}
                  className={cn(
                    "text-left text-sm font-medium transition-colors",
                    habit.kind === "positive" && isAchieved
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                    onOpenDetail && "hover:underline",
                  )}
                >
                  {habit.title}
                </button>
              )}

              {isChecklist && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  · 已完成 {evaluation.requiredDoneCount} /{" "}
                  {evaluation.requiredTotalCount} 项
                </span>
              )}

              {isChecklist && evaluation.abEnabled && evaluation.planName && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {evaluation.planName}
                </span>
              )}

              {habit.kind === "negative" && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    negativeCount === 0
                      ? "bg-(--habit-accent)/12 text-(--habit-accent)"
                      : "bg-(--due-tomorrow)/14 text-(--due-tomorrow)",
                  )}
                >
                  {negativeCount === 0
                    ? isToday
                      ? "今日未发生"
                      : "未发生 · 已达成"
                    : `${isToday ? "今日" : "当日"}发生 ${negativeCount} 次`}
                </span>
              )}

              {streak && streak.currentStreak > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <Sparkles className="size-2.5 text-(--habit-accent)" />
                  连续 {streak.currentStreak} {streak.unit}
                </span>
              )}
            </div>

            {/* Right controls */}
            <div className="flex shrink-0 items-center gap-1">
              {habit.kind === "negative" && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onRecordNegative(habit.id, date)}
                    className="h-6 gap-1 rounded-full px-2 text-[11px] font-medium"
                  >
                    <Plus className="size-3" />
                    记一次
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={disabled}
                    title="带备注记一次（如：聚餐）"
                    onClick={() => {
                      setSlipNoteDraft("");
                      setSlipNoteOpen((prev) => !prev);
                    }}
                    className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    带备注
                  </Button>
                  {negativeCount > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={disabled}
                      onClick={() => onUndoNegative(habit.id, date)}
                      className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="size-3" />
                      撤销
                    </Button>
                  )}
                </>
              )}

              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="当日备注"
                title="写一句当日回顾"
                onClick={openDailyNote}
                className={cn(
                  "size-6 text-muted-foreground hover:text-foreground",
                  !evaluation.note &&
                    "opacity-75 md:opacity-0 md:group-hover:opacity-100",
                )}
              >
                <MessageSquareText className="size-3.5" />
              </Button>

              {onOpenDetail && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onOpenDetail(habit.id)}
                  className="h-6 px-1.5 text-[11px] text-muted-foreground opacity-75 hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
                >
                  详情
                </Button>
              )}
            </div>
          </div>

          {/* Meta chips: project, tags, daily note preview */}
          {(habit.project || habit.tags.length > 0 || evaluation.note) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              {habit.project && (
                <span className="inline-flex items-center gap-1">
                  <ProjectIcon name={habit.project} className="size-3" />
                  <span>{habit.project}</span>
                </span>
              )}
              {habit.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[11px]"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{
                      backgroundColor: labelColorMap.get(tag) || "#7d7b76",
                    }}
                  />
                  @{tag}
                </span>
              ))}
              {evaluation.note && !noteOpen && (
                <button
                  type="button"
                  onClick={openDailyNote}
                  className="truncate text-[11px] italic text-muted-foreground/90 hover:text-foreground"
                >
                  “{evaluation.note}”
                </button>
              )}
            </div>
          )}

          {/* Slip with note inline composer */}
          {slipNoteOpen && habit.kind === "negative" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onRecordNegative(habit.id, date, slipNoteDraft);
                setSlipNoteDraft("");
                setSlipNoteOpen(false);
              }}
              className="mt-2 flex items-center gap-1.5"
            >
              <Input
                autoFocus
                value={slipNoteDraft}
                onChange={(e) => setSlipNoteDraft(e.target.value)}
                placeholder="发生原因或场景（如：聚餐）"
                className="h-7 max-w-xs text-xs"
              />
              <Button
                type="submit"
                size="xs"
                disabled={disabled}
                className="h-7 px-2.5 text-xs"
              >
                记录
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setSlipNoteOpen(false)}
                className="h-7 px-2 text-xs text-muted-foreground"
              >
                取消
              </Button>
            </form>
          )}

          {/* Negative event chips */}
          {habit.kind === "negative" && evaluation.events.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {evaluation.events.map((ev, index) => (
                <div
                  key={ev.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/45 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <span className="tabular-nums">
                    #{index + 1} {formatTimeHm(ev.occurredAtMs)}
                  </span>
                  {editingEventId === ev.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        onUpdateNegativeNote(
                          habit.id,
                          ev.id,
                          eventNoteDraft,
                          date,
                        );
                        setEditingEventId(null);
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      <Input
                        autoFocus
                        value={eventNoteDraft}
                        onChange={(e) => setEventNoteDraft(e.target.value)}
                        placeholder="备注"
                        className="h-5 w-24 px-1.5 text-[11px]"
                      />
                      <Button
                        type="submit"
                        size="xs"
                        className="h-5 px-1.5 text-[10px]"
                      >
                        存
                      </Button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEventId(ev.id);
                        setEventNoteDraft(ev.note);
                      }}
                      className="hover:text-foreground"
                    >
                      {ev.note ? `· ${ev.note}` : "· 添加备注"}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="撤销此次记录"
                    disabled={disabled}
                    onClick={() => onUndoNegative(habit.id, date, ev.id)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground/75 hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Expanded checklist items */}
          {isChecklist && expanded && (
            <div className="mt-2 rounded-lg border border-border/60 bg-card/60 p-2">
              {evaluation.abEnabled && availablePlans.length > 1 && (
                <div className="mb-1.5 flex items-center justify-between border-b border-border/50 pb-1.5 text-[11px] text-muted-foreground">
                  <span>今日训练方案</span>
                  <div className="flex items-center gap-1">
                    {availablePlans.map((plan) => (
                      <button
                        key={plan.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (plan.id !== evaluation.planId) {
                            onSwitchPlan(habit.id, plan.id, date);
                          }
                        }}
                        className={cn(
                          "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                          plan.id === evaluation.planId
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {plan.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {evaluation.checklistItems.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">
                  当前方案暂无动作。
                </p>
              ) : (
                <div className="space-y-0.5">
                  {evaluation.checklistItems.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      entry={evaluation.checklistProgress[item.id]}
                      disabled={disabled}
                      onToggleDone={(done) =>
                        onSetChecklistItem({
                          habitId: habit.id,
                          itemId: item.id,
                          date,
                          done,
                          planId: evaluation.planId,
                        })
                      }
                      onSaveMetrics={(patch) =>
                        onSetChecklistItem({
                          habitId: habit.id,
                          itemId: item.id,
                          date,
                          ...patch,
                          planId: evaluation.planId,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Daily reflection note editor */}
          {noteOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitDailyNote();
              }}
              className="mt-2 flex items-center gap-1.5"
            >
              <Input
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="写一句当日回顾（不影响完成状态）"
                className="h-7 max-w-md text-xs"
              />
              <Button
                type="submit"
                size="xs"
                disabled={disabled}
                className="h-7 px-2.5 text-xs"
              >
                保存
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setNoteOpen(false)}
                className="h-7 px-2 text-xs text-muted-foreground"
              >
                取消
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
