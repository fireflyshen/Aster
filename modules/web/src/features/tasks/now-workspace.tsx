import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { TaskRenderFn } from "@/app/hooks/use-task-renderer";
import type { StateSummaryData } from "@/app/hooks/use-task-state-actions";
import { sortUrgencyTasks } from "@/app/lib/task-view";
import {
  TodayHabitsSection,
  type TodayHabitsActions,
} from "@/features/habits/today-habits-section";
import { dueLabel, toDueDay } from "@/features/tasks/task-date";
import type { TodayHabitsResponse } from "@core/habits/model";
import { DOING_LIMIT, isHabitTask, type TaskState } from "@core/tasks/state";
import type { Organization } from "@core/workspace/organization";
import type { NowSectionState } from "@core/workspace/preferences";
import type { Task } from "@shared/tasks";
import { addDays, format } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  Hourglass,
  PauseCircle,
  PlayCircle,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";

function scheduledGroupLabel(scheduled: string | undefined, now: Date): string {
  if (!scheduled) return "未排期";
  const day = toDueDay(scheduled);
  if (!day) return "未排期";
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  if (day < todayStr) return `已到期 · ${day}`;
  if (day === todayStr) return "今天";
  if (day === tomorrowStr) return "明天";
  return dueLabel(scheduled);
}

/** Dedicated "现在能做" (`now`) workspace view: up to 5 doing tasks expanded, alerts at top, planned/waiting/parked collapsible. */
export function NowWorkspace({
  tasks,
  organization,
  now,
  query,
  loading,
  disabled,
  summary,
  habitTaskUuids,
  isTimingTask,
  nowSections,
  onUpdateSections,
  onChangeState,
  renderTask,
  onAddTask,
  todayHabits,
}: {
  tasks: Task[];
  organization: Organization;
  now: Date;
  query: string;
  loading: boolean;
  disabled: boolean;
  summary: StateSummaryData | null;
  habitTaskUuids: ReadonlySet<string>;
  isTimingTask?: (uuid: string) => boolean;
  nowSections?: NowSectionState;
  onUpdateSections: (next: NowSectionState) => void;
  onChangeState: (task: Task, state: TaskState) => Promise<boolean> | void;
  renderTask: TaskRenderFn;
  onAddTask: () => void;
  todayHabits?: {
    todayData?: TodayHabitsResponse | null;
    todayHabitTasks?: Task[];
    actions: TodayHabitsActions;
  };
}) {
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const needle = query.trim().toLocaleLowerCase();

  const { doing, plannedGroups, waiting, parked } = useMemo(() => {
    const openTopLevel = tasks.filter(
      (task) =>
        task.status !== "completed" &&
        !organization.subtasks?.[task.uuid] &&
        !isHabitTask(task, organization, habitTaskUuids) &&
        (!needle ||
          [task.description, task.project, ...task.tags]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)),
    );

    const doingList = sortUrgencyTasks(
      openTopLevel.filter((t) => t.state === "doing"),
    ).sort(
      (a, b) =>
        Number(Boolean(isTimingTask?.(b.uuid) || b.start)) -
        Number(Boolean(isTimingTask?.(a.uuid) || a.start)),
    );

    const plannedList = openTopLevel
      .filter((t) => t.state === "planned")
      .sort((a, b) => {
        const aTime = a.scheduled
          ? new Date(a.scheduled).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bTime = b.scheduled
          ? new Date(b.scheduled).getTime()
          : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || (b.urgency ?? 0) - (a.urgency ?? 0);
      });

    const groupMap = new Map<string, Task[]>();
    for (const task of plannedList) {
      const label = scheduledGroupLabel(task.scheduled, now);
      const bucket = groupMap.get(label) ?? [];
      bucket.push(task);
      groupMap.set(label, bucket);
    }

    const waitingList = openTopLevel
      .filter((t) => t.state === "waiting")
      .sort(
        (a, b) =>
          (a.wait ? new Date(a.wait).getTime() : Number.MAX_SAFE_INTEGER) -
          (b.wait ? new Date(b.wait).getTime() : Number.MAX_SAFE_INTEGER),
      );

    const parkedList = openTopLevel
      .filter((t) => t.state === "parked")
      .sort(
        (a, b) =>
          (a.wait ? new Date(a.wait).getTime() : Number.MAX_SAFE_INTEGER) -
          (b.wait ? new Date(b.wait).getTime() : Number.MAX_SAFE_INTEGER),
      );

    return {
      doing: doingList,
      plannedGroups: [...groupMap.entries()],
      waiting: waitingList,
      parked: parkedList,
    };
  }, [tasks, organization, habitTaskUuids, needle, isTimingTask, now]);

  const taskByUuid = useMemo(
    () => new Map(tasks.map((t) => [t.uuid, t])),
    [tasks],
  );

  const alertCount =
    (summary?.promotionBlocked.length ?? 0) +
    (summary?.waitingDue.length ?? 0) +
    (summary?.parkedReviewDue.length ?? 0) +
    (summary?.anomalies.length ?? 0);

  const plannedOpen = Boolean(nowSections?.planned);
  const waitingOpen = Boolean(nowSections?.waiting);
  const parkedOpen = Boolean(nowSections?.parked);

  const toggleSection = (key: keyof NowSectionState) => {
    onUpdateSections({
      ...(nowSections || {}),
      [key]: !nowSections?.[key],
    });
  };

  return (
    <div className="space-y-6">
      {alertCount > 0 && summary && (
        <section
          data-state-alerts
          className="rounded-xl border border-amber-500/35 bg-amber-500/8 px-3.5 py-2.5 text-sm"
        >
          <button
            type="button"
            onClick={() => setAlertsExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left font-medium text-foreground"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                需要关注 {alertCount} 项
                {summary.promotionBlocked.length > 0
                  ? ` · 阻塞转入 ${summary.promotionBlocked.length}`
                  : ""}
                {summary.waitingDue.length > 0
                  ? ` · 等待到期 ${summary.waitingDue.length}`
                  : ""}
                {summary.parkedReviewDue.length > 0
                  ? ` · 待复查 ${summary.parkedReviewDue.length}`
                  : ""}
                {summary.anomalies.length > 0
                  ? ` · 异常 ${summary.anomalies.length}`
                  : ""}
              </span>
            </span>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${
                alertsExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {alertsExpanded && (
            <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-2.5 text-xs">
              {summary.promotionBlocked.map((item) => {
                const full = taskByUuid.get(item.uuid);
                return (
                  <div
                    key={`blocked-${item.uuid}`}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 font-medium text-amber-700 dark:text-amber-300">
                        已到日期但处理中已满
                      </span>
                      {item.description}
                    </span>
                    {full && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => void onChangeState(full, "doing")}
                      >
                        替换进处理中
                      </Button>
                    )}
                  </div>
                );
              })}
              {summary.waitingDue.map((item) => {
                const full = taskByUuid.get(item.uuid);
                return (
                  <div
                    key={`waitdue-${item.uuid}`}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 font-medium text-teal-700 dark:text-teal-300">
                        等待核对日已到
                      </span>
                      {item.description}
                      {item.waitReason ? ` (${item.waitReason})` : ""}
                    </span>
                    {full && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => void onChangeState(full, "doing")}
                      >
                        回到处理中
                      </Button>
                    )}
                  </div>
                );
              })}
              {summary.parkedReviewDue.map((item) => {
                const full = taskByUuid.get(item.uuid);
                return (
                  <div
                    key={`parked-${item.uuid}`}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 font-medium text-muted-foreground">
                        搁置复查日已到
                      </span>
                      {item.description}
                    </span>
                    {full && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => void onChangeState(full, "planned")}
                      >
                        恢复到计划中
                      </Button>
                    )}
                  </div>
                );
              })}
              {summary.anomalies.map((item) => {
                const full = taskByUuid.get(item.uuid);
                return (
                  <div
                    key={`anomaly-${item.type}-${item.uuid}`}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 font-medium text-destructive">
                        数据异常
                      </span>
                      {item.description} · {item.detail}
                    </span>
                    {full && item.type === "missing_state" && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => void onChangeState(full, "planned")}
                      >
                        设为计划中
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section aria-label="处理中" data-now-doing>
        <div className="mb-2 flex h-9 items-center justify-between border-b border-border/80">
          <div className="flex items-center gap-2">
            <PlayCircle className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">
              处理中{" "}
              <span className="ml-1 font-normal tabular-nums text-muted-foreground">
                {doing.length}/{DOING_LIMIT}
              </span>
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onAddTask}
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            添加任务
          </Button>
        </div>

        {doing.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-border/80 px-4 py-6 text-center text-sm text-muted-foreground">
            当前「处理中」为空（0/{DOING_LIMIT}
            ）。可以从下方「计划中」挑一条移入处理中。
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {doing.map((task) => {
              const active = Boolean(isTimingTask?.(task.uuid) || task.start);
              return (
                <div
                  key={task.uuid}
                  data-now-active-timer={active ? "true" : undefined}
                  className={
                    active
                      ? "rounded-lg bg-primary/6 ring-1 ring-primary/25 px-1"
                      : undefined
                  }
                >
                  {renderTask(task)}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {todayHabits?.todayData && todayHabits.todayData.items.length > 0 && (
        <TodayHabitsSection
          todayData={todayHabits.todayData}
          todayHabitTasks={todayHabits.todayHabitTasks}
          renderTask={renderTask}
          availableLabels={organization.tags}
          actions={todayHabits.actions}
          disabled={disabled}
        />
      )}

      <Collapsible
        open={plannedOpen}
        onOpenChange={() => toggleSection("planned")}
        data-now-section="planned"
      >
        <div className="flex h-9 items-center border-b border-border/70">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group -ml-1.5 flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-(--row-hover)"
            >
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition-transform ${
                  plannedOpen ? "" : "-rotate-90"
                }`}
              />
              <Clock3 className="size-3.5 text-blue-600 dark:text-blue-400" />
              <span>计划中</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {plannedGroups.reduce((acc, [, list]) => acc + list.length, 0)}
              </span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-2 space-y-4">
          {plannedGroups.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">暂无计划中任务</p>
          ) : (
            plannedGroups.map(([label, list]) => (
              <div key={label} className="space-y-1">
                <div className="px-1 text-xs font-medium text-muted-foreground">
                  {label}
                </div>
                <div className="divide-y divide-border/45">
                  {list.map((task) => renderTask(task))}
                </div>
              </div>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        open={waitingOpen}
        onOpenChange={() => toggleSection("waiting")}
        data-now-section="waiting"
      >
        <div className="flex h-9 items-center border-b border-border/70">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group -ml-1.5 flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-(--row-hover)"
            >
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition-transform ${
                  waitingOpen ? "" : "-rotate-90"
                }`}
              />
              <Hourglass className="size-3.5 text-teal-600 dark:text-teal-400" />
              <span>等待中</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {waiting.length}
              </span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-2">
          {waiting.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">暂无等待中任务</p>
          ) : (
            <div className="divide-y divide-border/45">
              {waiting.map((task) => (
                <div key={task.uuid} className="space-y-0.5 py-0.5">
                  {renderTask(task)}
                  {(task.waitReason || task.wait) && (
                    <div className="pl-11 pb-1.5 text-xs text-muted-foreground">
                      {task.waitReason && (
                        <span className="mr-2">原因：{task.waitReason}</span>
                      )}
                      {task.wait && (
                        <span>
                          核对日：{toDueDay(task.wait) || dueLabel(task.wait)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        open={parkedOpen}
        onOpenChange={() => toggleSection("parked")}
        data-now-section="parked"
      >
        <div className="flex h-9 items-center border-b border-border/70">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group -ml-1.5 flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-(--row-hover)"
            >
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition-transform ${
                  parkedOpen ? "" : "-rotate-90"
                }`}
              />
              <PauseCircle className="size-3.5 text-muted-foreground" />
              <span>长期搁置</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {parked.length}
              </span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-2">
          {parked.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">
              暂无长期搁置任务
            </p>
          ) : (
            <div className="divide-y divide-border/45">
              {parked.map((task) => (
                <div key={task.uuid} className="space-y-0.5 py-0.5">
                  {renderTask(task)}
                  {task.wait && (
                    <div className="pl-11 pb-1.5 text-xs text-muted-foreground">
                      复查日：{toDueDay(task.wait) || dueLabel(task.wait)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
