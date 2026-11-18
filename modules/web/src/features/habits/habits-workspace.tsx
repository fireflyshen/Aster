import { useI18n } from "@/app/language";
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
import { DescriptionPopover } from "@/features/tasks/description-popover";
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
import { useMemo } from "react";
import { HabitDayDetailPanel } from "./habit-day-detail-panel";
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
  onOpenNewHabit,
  onEditHabit,
  onOpenEditTask,
}: {
  controller: HabitsWorkspaceController;
  tasks?: Task[];
  projects: string[];
  availableLabels: SavedTag[];
  onOpenNewHabit?: () => void;
  onEditHabit?: (habit: HabitListItem) => void;
  onOpenEditTask?: (task: Task) => void;
}) {
  const { t } = useI18n();
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

  function openCreate() {
    onOpenNewHabit?.();
  }

  function openEdit(habit: HabitListItem) {
    if (habit.taskUuid && onOpenEditTask) {
      const linkedTask = taskByUuid.get(habit.taskUuid);
      if (linkedTask) {
        onOpenEditTask(linkedTask);
        return;
      }
    }
    onEditHabit?.(habit);
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
              {t("重试")}
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
              { id: "archived", label: t("已归档") },
              { id: "all", label: t("全部") },
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
              aria-label={t("按项目筛选习惯")}
              className="h-8 w-auto min-w-[110px] border-border/70 bg-transparent px-2.5 text-xs shadow-none"
            >
              <SelectValue placeholder={t("全部项目")} />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL_VALUE}>{t("全部项目")}</SelectItem>
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
              aria-label={t("按标签筛选习惯")}
              className="h-8 w-auto min-w-[104px] border-border/70 bg-transparent px-2.5 text-xs shadow-none"
            >
              <SelectValue placeholder={t("全部标签")} />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL_VALUE}>{t("全部标签")}</SelectItem>
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
            {t("新建习惯")}
          </Button>
        </div>
      </div>

      {/* Aggregate Heatmap Card */}
      <section
        aria-label={t("习惯综合热力图")}
        className="min-w-0 border-y border-border/60 py-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("热力图")}
            </h2>
            {controller.heatmap && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {t("全达成")} {controller.heatmap.summary.perfectDays}/
                {controller.heatmap.summary.totalScheduledDays} {t("天 · 完成")}{" "}
                {controller.heatmap.summary.achievedTotal}/
                {controller.heatmap.summary.scheduledTotal} {t("项")}
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
                {days}
                {t("天")}
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
            {t("加载中…")}
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
      <section aria-label={t("习惯列表")} className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("清单")}
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
              {t("清除筛选")}
            </Button>
          )}
        </div>

        {controller.loading && controller.habits.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            {t("加载中…")}
          </div>
        ) : controller.habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 py-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {controller.projectFilter || controller.tagFilter
                ? t("无匹配")
                : t("无习惯")}
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
                  {t("新建习惯")}
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
                <div className="habit-review-main min-w-0">
                  <button
                    type="button"
                    onClick={() => controller.setDetailId(habit.id)}
                    className="flex w-full min-w-0 flex-wrap items-center gap-2 text-left cursor-pointer"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {habit.title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                      {habit.kind === "negative" ? (
                        <>
                          <ShieldCheck className="size-3 text-(--habit-accent)" />
                          {t("反向")}
                        </>
                      ) : habit.completionMode === "checklist" ? (
                        <>
                          <Dumbbell className="size-3 text-(--habit-accent)" />
                          {habit.abEnabled ? t("A/B 训练") : t("动作清单")}
                        </>
                      ) : habit.trackTime ? (
                        t("计时打卡")
                      ) : (
                        t("普通打卡")
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
                        {t("已归档")}
                      </span>
                    )}
                  </button>

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
                    <DescriptionPopover
                      text={habit.description}
                      title={habit.title}
                      onOpenDetails={() => controller.setDetailId(habit.id)}
                    />
                    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                      <Sparkles className="size-3 text-(--habit-accent)" />
                      {t("连续")} {habit.streak.currentStreak}{" "}
                      {habit.streak.unit}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {t("近30天")} {habit.streak.recent30Achieved}/
                      {habit.streak.recent30Scheduled}
                      {habit.kind === "negative" &&
                        t(" · 发生 {0}次", habit.streak.recent30Events)}
                    </span>
                  </div>
                </div>

                <div className="habit-review-actions flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("编辑 {0}", habit.title)}
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
                      aria-label={t("暂停 {0}", habit.title)}
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
                      aria-label={t("恢复 {0}", habit.title)}
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
                      aria-label={t("归档 {0}", habit.title)}
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
    </div>
  );
}
