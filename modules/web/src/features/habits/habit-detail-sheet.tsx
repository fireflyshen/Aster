import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectIcon } from "@/features/projects/project-icon";
import { formatScheduleLabel } from "@core/habits/logic";
import type {
  HabitDetailResponse,
  HabitListItem,
  HabitStatus,
} from "@core/habits/model";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import { Archive, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { HabitExecutionRow } from "./habit-execution-row";
import { HabitHeatmap } from "./habit-heatmap";

function statusLabel(status: HabitStatus): string {
  if (status === "paused") return "已暂停";
  if (status === "archived") return "已归档";
  return "进行中";
}

function dayStatusBadge(status: string, kind: "positive" | "negative") {
  switch (status) {
    case "achieved":
      return {
        label: kind === "negative" ? "未破例 · 达成" : "已完成",
        className: "bg-(--habit-accent)/14 text-(--habit-accent)",
      };
    case "partial":
      return {
        label: "部分完成",
        className: "bg-secondary text-muted-foreground",
      };
    case "broken":
      return {
        label: "已发生",
        className: "bg-(--due-tomorrow)/14 text-(--due-tomorrow)",
      };
    case "in_progress":
      return {
        label: "今日进行中",
        className: "bg-secondary text-foreground",
      };
    case "paused":
      return {
        label: "暂停期间",
        className: "bg-secondary/60 text-muted-foreground",
      };
    default:
      return {
        label: "未完成",
        className: "bg-secondary/70 text-muted-foreground",
      };
  }
}

/** Single-habit detail modal showing streak stats, principles, individual heatmap, and recent 30-day log. */
export function HabitDetailDialog({
  open,
  onOpenChange,
  detail,
  availableLabels,
  disabled,
  onEdit,
  onSetStatus,
  onDelete,
  onTogglePositive,
  onSetChecklistItem,
  onSwitchPlan,
  onRecordNegative,
  onUndoNegative,
  onUpdateNegativeNote,
  onSetDailyNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: HabitDetailResponse | null;
  availableLabels: readonly SavedTag[];
  disabled?: boolean;
  onEdit: (habit: HabitListItem) => void;
  onSetStatus: (habitId: string, status: HabitStatus) => void;
  onDelete: (habitId: string) => Promise<unknown>;
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
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!detail) return null;

  const { habit, streak, heatmap, recentDays } = detail;
  const labelColorMap = new Map(
    availableLabels.map((tag) => [tag.name, itemColor(tag.color)]),
  );

  const selectedItem = selectedDay
    ? recentDays.find((d) => d.evaluation.date === selectedDay)
    : undefined;

  const listItem: HabitListItem = {
    ...habit,
    streak,
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setSelectedDay(null);
          onOpenChange(next);
        }}
      >
        <DialogContent className="habit-detail-dialog min-w-0 max-h-[90dvh] overflow-y-auto sm:max-w-[680px]">
          <DialogHeader>
            <div className="habit-detail-heading flex flex-wrap items-start justify-between gap-3 pr-6">
              <div className="min-w-0 flex-1">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {habit.title}
                  </span>
                  <span className="rounded-full whitespace-nowrap bg-secondary px-2 py-0.5 text-[11px] font-normal text-secondary-foreground">
                    {habit.kind === "positive"
                      ? habit.completionMode === "checklist"
                        ? habit.abEnabled
                          ? "A/B 训练清单"
                          : "动作清单"
                        : "正向打卡"
                      : "反向 · 记破例"}
                  </span>
                  <span className="rounded-full whitespace-nowrap border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                    {statusLabel(habit.status)}
                  </span>
                </DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span>{formatScheduleLabel(habit.schedule)}</span>
                  {habit.project && (
                    <span className="inline-flex items-center gap-1 text-foreground/85">
                      <ProjectIcon name={habit.project} className="size-3" />
                      {habit.project}
                    </span>
                  )}
                  {habit.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1">
                      <span
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor: labelColorMap.get(tag) || "#7d7b76",
                        }}
                      />
                      @{tag}
                    </span>
                  ))}
                </DialogDescription>
              </div>

              <div className="habit-detail-actions flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={disabled}
                  onClick={() => onEdit(listItem)}
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <Pencil className="size-3" />
                  编辑
                </Button>
                {habit.status === "active" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onSetStatus(habit.id, "paused")}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <Pause className="size-3" />
                    暂停
                  </Button>
                )}
                {habit.status === "paused" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onSetStatus(habit.id, "active")}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <Play className="size-3" />
                    恢复
                  </Button>
                )}
                {habit.status !== "archived" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onSetStatus(habit.id, "archived")}
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  >
                    <Archive className="size-3" />
                    归档
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onSetStatus(habit.id, "active")}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <Play className="size-3" />
                    取消归档
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="删除习惯"
                  disabled={disabled}
                  onClick={() => setConfirmDelete(true)}
                  className="size-7 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          {habit.description && (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {habit.description}
            </div>
          )}

          {/* Streak & 30-day metrics */}
          <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-border/70 bg-card/70 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">当前连续</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {streak.currentStreak}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                  {streak.unit}
                </span>
              </div>
            </div>
            <div className="min-w-0 rounded-lg border border-border/70 bg-card/70 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">最长连续</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {streak.longestStreak}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                  {streak.unit}
                </span>
              </div>
            </div>
            <div className="min-w-0 rounded-lg border border-border/70 bg-card/70 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">
                近 30 天达成
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {streak.recent30Achieved}
                <span className="text-xs font-normal text-muted-foreground">
                  /{streak.recent30Scheduled}
                </span>
              </div>
            </div>
            {habit.kind === "negative" && (
              <div className="min-w-0 rounded-lg border border-border/70 bg-card/70 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">
                  近 30 天发生
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {streak.recent30Events}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                    次
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Individual Heatmap */}
          <div className="min-w-0 rounded-xl border border-border/70 bg-card/60 p-3.5">
            <div className="mb-2 text-xs font-medium text-foreground">
              执行热力图
            </div>
            <HabitHeatmap
              heatmap={heatmap}
              selectedDate={selectedDay}
              onSelectDate={setSelectedDay}
              compact
            />
          </div>

          {/* Selected date quick edit */}
          {selectedItem && (
            <div className="rounded-xl border border-border/80 bg-card p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {selectedItem.evaluation.date} 补记与修正
              </div>
              <HabitExecutionRow
                habit={selectedItem.habit}
                evaluation={selectedItem.evaluation}
                availablePlans={selectedItem.availablePlans}
                availableLabels={availableLabels}
                date={selectedItem.evaluation.date}
                isToday={selectedItem.evaluation.date === heatmap.todayDate}
                disabled={disabled}
                onTogglePositive={onTogglePositive}
                onSetChecklistItem={onSetChecklistItem}
                onSwitchPlan={onSwitchPlan}
                onRecordNegative={onRecordNegative}
                onUndoNegative={onUndoNegative}
                onUpdateNegativeNote={onUpdateNegativeNote}
                onSetDailyNote={onSetDailyNote}
              />
            </div>
          )}

          {/* Recent 30 days history */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground">
              近期记录（最近 30 天）
            </div>
            {recentDays.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                暂无近期安排记录。
              </p>
            ) : (
              <div className="divide-y divide-border/50 rounded-lg border border-border/70 bg-card/50">
                {recentDays.map((entry) => {
                  const badge = dayStatusBadge(
                    entry.evaluation.status,
                    habit.kind,
                  );
                  return (
                    <button
                      key={entry.evaluation.date}
                      type="button"
                      onClick={() =>
                        setSelectedDay((prev) =>
                          prev === entry.evaluation.date
                            ? null
                            : entry.evaluation.date,
                        )
                      }
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-(--row-hover)"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium tabular-nums text-foreground">
                            {entry.evaluation.date}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          {entry.evaluation.completionMode === "checklist" && (
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {entry.evaluation.requiredDoneCount}/
                              {entry.evaluation.requiredTotalCount} 项
                              {entry.evaluation.planName
                                ? ` · ${entry.evaluation.planName}`
                                : ""}
                            </span>
                          )}
                          {habit.kind === "negative" &&
                            entry.evaluation.events.length > 0 && (
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                发生 {entry.evaluation.events.length} 次
                              </span>
                            )}
                        </div>
                        {entry.evaluation.note && (
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            “{entry.evaluation.note}”
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        编辑
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除习惯“{habit.title}”？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该习惯的所有历史记录与连续统计都会移除且无法恢复。如果只是暂时不想追踪，建议使用“暂停”或“归档”。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onDelete(habit.id).then(() => {
                  setConfirmDelete(false);
                  onOpenChange(false);
                });
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
