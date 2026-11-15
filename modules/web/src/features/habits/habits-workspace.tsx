import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DescriptionSummary } from "@/features/tasks/description-summary";
import { formatScheduleLabel } from "@core/habits/logic";
import type { HabitListItem, HabitStatus } from "@core/habits/model";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import {
  Archive,
  Dumbbell,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { HabitDayDetailPanel } from "./habit-day-detail-panel";
import { HabitDetailDialog } from "./habit-detail-sheet";
import { HabitFormDialog } from "./habit-form-dialog";
import { HabitHeatmap } from "./habit-heatmap";
import type { useHabitsWorkspace } from "./use-habits";

const ALL_VALUE = "__all__";

export type HabitsWorkspaceController = ReturnType<typeof useHabitsWorkspace>;

/** Main "习惯" workspace page for review, heatmap filtering, backfill, and habit management. */
export function HabitsWorkspace({
  controller,
  tasks = [],
  projects,
  availableLabels,
  formOpen,
  onFormOpenChange,
  onOpenNewHabit,
  onOpenEditTask,
}: {
  controller: HabitsWorkspaceController;
  tasks?: Task[];
  projects: string[];
  availableLabels: SavedTag[];
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
  onOpenNewHabit?: () => void;
  onOpenEditTask?: (task: Task) => void;
}) {
  const [editingHabit, setEditingHabit] = useState<HabitListItem | null>(null);
  const taskByUuid = useMemo(
    () => new Map(tasks.map((item) => [item.uuid, item])),
    [tasks],
  );

  const labelColorMap = useMemo(
    () =>
      new Map(availableLabels.map((tag) => [tag.name, itemColor(tag.color)])),
    [availableLabels],
  );

  const projectChoices = useMemo(() => {
    const set = new Set<string>(projects);
    for (const h of controller.habits) {
      if (h.project) set.add(h.project);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [projects, controller.habits]);

  const tagChoices = useMemo(() => {
    const set = new Set<string>(availableLabels.map((t) => t.name));
    for (const h of controller.habits) {
      for (const t of h.tags) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [availableLabels, controller.habits]);

  const todayDate =
    controller.heatmap?.todayDate ||
    controller.todayData?.todayDate ||
    new Date().toISOString().slice(0, 10);

  function openCreate() {
    if (onOpenNewHabit) {
      onOpenNewHabit();
      return;
    }
    setEditingHabit(null);
    onFormOpenChange(true);
  }

  function openEdit(habit: HabitListItem) {
    if (habit.taskUuid && onOpenEditTask) {
      const linkedTask = taskByUuid.get(habit.taskUuid);
      if (linkedTask) {
        onOpenEditTask(linkedTask);
        return;
      }
    }
    setEditingHabit(habit);
    onFormOpenChange(true);
  }

  return (
    <div className="space-y-6">
      {controller.error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>{controller.error}</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void controller.refreshWorkspace()}
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Top filter & action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "active", label: "进行中" },
              { id: "paused", label: "已暂停" },
              { id: "archived", label: "已归档" },
              { id: "all", label: "全部" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                controller.setStatusFilter(tab.id as HabitStatus | "all")
              }
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                controller.statusFilter === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={controller.projectFilter || ALL_VALUE}
            onValueChange={(val) =>
              controller.setProjectFilter(val === ALL_VALUE ? "" : val)
            }
          >
            <SelectTrigger
              aria-label="按项目筛选习惯"
              className="h-8 w-auto min-w-[110px] border-border/70 bg-transparent px-2.5 text-xs shadow-none"
            >
              <SelectValue placeholder="全部项目" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL_VALUE}>全部项目</SelectItem>
              {projectChoices.map((proj) => (
                <SelectItem key={proj} value={proj}>
                  <span className="inline-flex items-center gap-1.5">
                    <ProjectIcon name={proj} className="size-3.5" />
                    {proj}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={controller.tagFilter || ALL_VALUE}
            onValueChange={(val) =>
              controller.setTagFilter(val === ALL_VALUE ? "" : val)
            }
          >
            <SelectTrigger
              aria-label="按标签筛选习惯"
              className="h-8 w-auto min-w-[104px] border-border/70 bg-transparent px-2.5 text-xs shadow-none"
            >
              <SelectValue placeholder="全部标签" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL_VALUE}>全部标签</SelectItem>
              {tagChoices.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  @{tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            onClick={openCreate}
            className="h-8 gap-1 px-3 text-xs"
          >
            <Plus className="size-3.5" />
            新建习惯
          </Button>
        </div>
      </div>

      {/* Aggregate Heatmap Card */}
      <section
        aria-label="习惯综合热力图"
        className="min-w-0 border-y border-border/60 py-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {controller.projectFilter || controller.tagFilter
                ? "筛选范围热力图"
                : "综合热力图"}
            </h2>
            {controller.heatmap && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                近 {controller.rangeDays} 天已安排{" "}
                {controller.heatmap.summary.totalScheduledDays} 天 · 全达成{" "}
                {controller.heatmap.summary.perfectDays} 天 · 累计完成{" "}
                {controller.heatmap.summary.achievedTotal}/
                {controller.heatmap.summary.scheduledTotal} 项
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {[90, 180, 365].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => controller.setRangeDays(days)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] transition-colors",
                  controller.rangeDays === days
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {days}天
              </button>
            ))}
          </div>
        </div>

        {controller.heatmap ? (
          <HabitHeatmap
            heatmap={controller.heatmap}
            selectedDate={controller.selectedDate}
            onSelectDate={controller.setSelectedDate}
          />
        ) : (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            加载热力图…
          </div>
        )}
      </section>

      {/* Clicked Day Detail / Backfill Panel */}
      {controller.dayDetail && (
        <HabitDayDetailPanel
          detail={controller.dayDetail}
          availableLabels={availableLabels}
          disabled={controller.busy}
          onSelectDate={(d) => controller.setSelectedDate(d)}
          onClose={() => controller.setSelectedDate(null)}
          onTogglePositive={(habitId, date, completed) =>
            void controller.togglePositive(habitId, date, completed)
          }
          onSetChecklistItem={(input) =>
            void controller.setChecklistItem(input)
          }
          onSwitchPlan={(habitId, planId, date) =>
            void controller.switchPlan(habitId, planId, date)
          }
          onRecordNegative={(habitId, date, note) =>
            void controller.recordNegative(habitId, date, note)
          }
          onUndoNegative={(habitId, date, eventId) =>
            void controller.undoNegative(habitId, date, eventId)
          }
          onUpdateNegativeNote={(habitId, eventId, note, date) =>
            void controller.updateNegativeNote(habitId, eventId, note, date)
          }
          onSetDailyNote={(habitId, note, date) =>
            void controller.setDailyNote(habitId, note, date)
          }
          onOpenHabitDetail={(habitId) => controller.setDetailId(habitId)}
        />
      )}

      {/* Habits List */}
      <section aria-label="习惯列表" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            习惯清单
            <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
              {controller.habits.length}
            </span>
          </h2>
          {(controller.projectFilter || controller.tagFilter) && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                controller.setProjectFilter("");
                controller.setTagFilter("");
              }}
              className="h-6 px-2 text-xs text-muted-foreground"
            >
              清除筛选
            </Button>
          )}
        </div>

        {controller.loading && controller.habits.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            加载习惯列表…
          </div>
        ) : controller.habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 py-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {controller.projectFilter || controller.tagFilter
                ? "当前筛选条件下没有习惯"
                : controller.statusFilter === "active"
                  ? "还没有进行中的习惯"
                  : "该状态下暂无习惯"}
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              可以记录想坚持的好习惯（含可展开动作清单的训练），或想减少的坏习惯（只记录破例）。
            </p>
            {controller.statusFilter === "active" &&
              !controller.projectFilter &&
              !controller.tagFilter && (
                <Button
                  type="button"
                  size="sm"
                  onClick={openCreate}
                  className="mt-4 gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  新建第一个习惯
                </Button>
              )}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {controller.habits.map((habit) => (
              <div
                key={habit.id}
                className="habit-review-row group relative min-w-0 py-2.5 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => controller.setDetailId(habit.id)}
                  className="habit-review-main block w-full min-w-0 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {habit.title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                      {habit.kind === "negative" ? (
                        <>
                          <ShieldCheck className="size-3 text-(--habit-accent)" />
                          反向
                        </>
                      ) : habit.completionMode === "checklist" ? (
                        <>
                          <Dumbbell className="size-3 text-(--habit-accent)" />
                          {habit.abEnabled ? "A/B 训练" : "动作清单"}
                        </>
                      ) : habit.trackTime ? (
                        "计时打卡"
                      ) : (
                        "普通打卡"
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatScheduleLabel(habit.schedule)}
                    </span>
                    {habit.status === "paused" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        已暂停
                      </span>
                    )}
                    {habit.status === "archived" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        已归档
                      </span>
                    )}
                  </div>

                  {habit.description && (
                    <DescriptionSummary
                      text={habit.description}
                      className="mt-0.5 text-[12px] leading-[18px] text-muted-foreground/75"
                    />
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {habit.project && (
                      <span className="inline-flex items-center gap-1">
                        <ProjectIcon name={habit.project} className="size-3" />
                        {habit.project}
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
                            backgroundColor:
                              labelColorMap.get(tag) || "#7d7b76",
                          }}
                        />
                        @{tag}
                      </span>
                    ))}
                    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                      <Sparkles className="size-3 text-(--habit-accent)" />
                      连续 {habit.streak.currentStreak} {habit.streak.unit}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      近30天 {habit.streak.recent30Achieved}/
                      {habit.streak.recent30Scheduled}
                      {habit.kind === "negative" &&
                        ` · 发生 ${habit.streak.recent30Events}次`}
                    </span>
                  </div>
                </button>

                <div className="habit-review-actions flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`编辑 ${habit.title}`}
                    onClick={() => openEdit(habit)}
                    className="size-7 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {habit.status === "active" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`暂停 ${habit.title}`}
                      disabled={controller.busy}
                      onClick={() =>
                        void controller.setHabitStatus(habit.id, "paused")
                      }
                      className="size-7 text-muted-foreground hover:text-foreground"
                    >
                      <Pause className="size-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`恢复 ${habit.title}`}
                      disabled={controller.busy}
                      onClick={() =>
                        void controller.setHabitStatus(habit.id, "active")
                      }
                      className="size-7 text-muted-foreground hover:text-foreground"
                    >
                      {habit.status === "archived" ? (
                        <RotateCcw className="size-3.5" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                    </Button>
                  )}
                  {habit.status !== "archived" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`归档 ${habit.title}`}
                      disabled={controller.busy}
                      onClick={() =>
                        void controller.setHabitStatus(habit.id, "archived")
                      }
                      className="size-7 text-muted-foreground hover:text-foreground"
                    >
                      <Archive className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <HabitFormDialog
        open={formOpen}
        onOpenChange={onFormOpenChange}
        editing={editingHabit}
        todayDate={todayDate}
        projects={projectChoices}
        availableLabels={availableLabels}
        busy={controller.busy}
        onCreate={controller.createHabit}
        onUpdate={controller.updateHabit}
      />

      <HabitDetailDialog
        open={Boolean(controller.detailId && controller.detailData)}
        onOpenChange={(open) => {
          if (!open) controller.setDetailId(null);
        }}
        detail={controller.detailData}
        availableLabels={availableLabels}
        disabled={controller.busy}
        onEdit={(habit) => {
          controller.setDetailId(null);
          openEdit(habit);
        }}
        onSetStatus={(id, status) => void controller.setHabitStatus(id, status)}
        onDelete={controller.deleteHabit}
        onTogglePositive={(habitId, date, completed) =>
          void controller.togglePositive(habitId, date, completed)
        }
        onSetChecklistItem={(input) => void controller.setChecklistItem(input)}
        onSwitchPlan={(habitId, planId, date) =>
          void controller.switchPlan(habitId, planId, date)
        }
        onRecordNegative={(habitId, date, note) =>
          void controller.recordNegative(habitId, date, note)
        }
        onUndoNegative={(habitId, date, eventId) =>
          void controller.undoNegative(habitId, date, eventId)
        }
        onUpdateNegativeNote={(habitId, eventId, note, date) =>
          void controller.updateNegativeNote(habitId, eventId, note, date)
        }
        onSetDailyNote={(habitId, note, date) =>
          void controller.setDailyNote(habitId, note, date)
        }
      />
    </div>
  );
}
