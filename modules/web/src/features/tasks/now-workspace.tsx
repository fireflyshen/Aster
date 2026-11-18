import { translate, useI18n, type Language } from "@/app/language";
import { Button } from "@/components/ui/button";
import type { TaskRenderFn } from "@/app/hooks/use-task-renderer";
import type { StateSummaryData } from "@/app/hooks/use-task-state-actions";
import { sortUrgencyTasks } from "@/app/lib/task-view";
import { BoardCard } from "@/features/tasks/board-card";
import type { DropPosition } from "@/features/tasks/drag-model";
import { TaskDragLayer } from "@/features/tasks/task-drag-layer";
import { dueLabel, toDueDay } from "@/features/tasks/task-date";
import { TaskStateGroupContext } from "./task-meta-chips";
import { useBoardDnd } from "@/features/tasks/use-board-dnd";
import type { BoardColumn as Column } from "@core/workspace/board";
import {
  isHabitTask,
  normalizeDoingLimit,
  type TaskState,
} from "@core/tasks/state";
import type { Organization } from "@core/workspace/organization";
import type { NowSectionState } from "@core/workspace/preferences";
import { closestCenter, DndContext, useDroppable } from "@dnd-kit/core";
import type { Task } from "@shared/tasks";
import { addDays, format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

const NOW_COLUMNS: Record<TaskState, Column> = {
  doing: { id: "doing", name: "处理中" },
  planned: { id: "planned", name: "计划中" },
  waiting: { id: "waiting", name: "等待中" },
  parked: { id: "parked", name: "长期搁置" },
};
const NOW_COLUMN_LIST: Column[] = [
  NOW_COLUMNS.doing,
  NOW_COLUMNS.planned,
  NOW_COLUMNS.waiting,
  NOW_COLUMNS.parked,
];

function NowDropSection({
  state,
  label,
  disabled,
  children,
}: {
  state: TaskState;
  label: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: state,
    data: { kind: "column", columnId: state },
    disabled,
  });
  return (
    <section ref={setNodeRef} data-board-column={state} aria-label={label}>
      <TaskStateGroupContext value={state}>{children}</TaskStateGroupContext>
    </section>
  );
}

export function scheduledGroupLabel(
  scheduled: string | undefined,
  now: Date,
  locale: Language = "zh-CN",
): string {
  const day = scheduled ? toDueDay(scheduled) : "";
  if (!day) return translate(locale, "未排期");
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  if (day < todayStr) return translate(locale, "已到期 · {0}", day);
  if (day === todayStr) return translate(locale, "今天");
  if (day === tomorrowStr) return translate(locale, "明天");
  if (locale === "en") {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(day.slice(0, 4) !== format(now, "yyyy") ? { year: "numeric" } : {}),
    }).format(new Date(`${day}T12:00:00`));
  }
  return format(
    new Date(`${day}T00:00:00`),
    day.slice(0, 4) === format(now, "yyyy") ? "M月d日" : "yyyy年M月d日",
  );
}

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
}) {
  const { t, locale } = useI18n();
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const scrollArea = useRef<HTMLDivElement>(null);
  const { sensors, accessibility } = useBoardDnd("list", NOW_COLUMN_LIST);
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
      const label = scheduledGroupLabel(task.scheduled, now, locale);
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
  }, [tasks, organization, habitTaskUuids, needle, isTimingTask, now, locale]);

  const taskByUuid = useMemo(
    () => new Map(tasks.map((t) => [t.uuid, t])),
    [tasks],
  );

  const alertCount =
    (summary?.promotionBlocked.length ?? 0) +
    (summary?.waitingDue.length ?? 0) +
    (summary?.parkedReviewDue.length ?? 0) +
    (summary?.anomalies.length ?? 0);
  const doingLimit =
    summary?.limit ?? normalizeDoingLimit(organization.preferences?.doingLimit);

  const plannedOpen = Boolean(nowSections?.planned);
  const waitingOpen = Boolean(nowSections?.waiting);
  const parkedOpen = Boolean(nowSections?.parked);

  const toggleSection = (key: keyof NowSectionState) => {
    onUpdateSections({
      ...(nowSections || {}),
      [key]: !nowSections?.[key],
    });
  };

  const handleDrop = (task: Task, target: DropPosition) => {
    if (disabled) return;
    const nextState = target.columnId as TaskState;
    if (!NOW_COLUMNS[nextState]) return;
    const currentState: TaskState = task.state ?? "planned";
    if (nextState === currentState) return;
    void onChangeState(task, nextState);
  };

  const alerts =
    alertCount > 0 && summary ? (
      <section
        data-state-alerts
        className="now-alerts"
        aria-label={t("待处理提醒")}
      >
        <button
          type="button"
          aria-expanded={alertsExpanded}
          aria-controls={alertsExpanded ? "now-alert-items" : undefined}
          onClick={() => setAlertsExpanded((v) => !v)}
          className="now-alert-toggle"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            {t("提醒")}
            <span className="tabular-nums text-muted-foreground">
              {alertCount}
            </span>
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${
              alertsExpanded ? "rotate-180" : ""
            }`}
          />
        </button>

        {alertsExpanded && (
          <div
            id="now-alert-items"
            className="divide-y divide-border border-t border-border text-xs"
          >
            {summary.promotionBlocked.map((item) => {
              const full = taskByUuid.get(item.uuid);
              return (
                <div key={`blocked-${item.uuid}`} className="now-alert-item">
                  <span className="min-w-0 wrap-anywhere">
                    <span className="mr-1.5 font-medium text-amber-700 dark:text-amber-300">
                      {t("处理中已满")}
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
                      {t("替换进处理中")}
                    </Button>
                  )}
                </div>
              );
            })}
            {summary.waitingDue.map((item) => {
              const full = taskByUuid.get(item.uuid);
              return (
                <div key={`waitdue-${item.uuid}`} className="now-alert-item">
                  <span className="min-w-0 wrap-anywhere">
                    <span className="mr-1.5 font-medium text-teal-700 dark:text-teal-300">
                      {t("待核对")}
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
                      {t("回到处理中")}
                    </Button>
                  )}
                </div>
              );
            })}
            {summary.parkedReviewDue.map((item) => {
              const full = taskByUuid.get(item.uuid);
              return (
                <div key={`parked-${item.uuid}`} className="now-alert-item">
                  <span className="min-w-0 wrap-anywhere">
                    <span className="mr-1.5 font-medium text-muted-foreground">
                      {t("待复查")}
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
                      {t("恢复到计划中")}
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
                  className="now-alert-item"
                >
                  <span className="min-w-0 wrap-anywhere">
                    <span className="mr-1.5 font-medium text-destructive">
                      {t("数据异常")}
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
                      {t("设为计划中")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    ) : null;

  return (
    <div className="now-workspace min-w-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={accessibility}
      >
        <div
          ref={scrollArea}
          data-board-scroll
          role="region"
          aria-label={t("现在能做状态分组")}
          className="now-sections"
        >
          <NowDropSection state="doing" label={t("处理中")} disabled={disabled}>
            <div
              data-list-section="true"
              className="now-section-heading flex items-center justify-between border-b border-border/80"
            >
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("处理中")}
                </h2>
                <span className="ml-0.5 text-xs font-normal tabular-nums text-muted-foreground/75">
                  {doing.length}/{doingLimit}
                </span>
              </div>
            </div>

            <div data-drop-content className="min-h-7">
              {doing.length === 0 && !loading ? (
                <p className="py-3 text-xs text-muted-foreground">
                  {t("无任务")}
                </p>
              ) : (
                doing.map((task) => {
                  const active = Boolean(
                    isTimingTask?.(task.uuid) || task.start,
                  );
                  return (
                    <div
                      key={task.uuid}
                      data-now-active-timer={active ? "true" : undefined}
                    >
                      <BoardCard
                        compact
                        interactive={!disabled}
                        task={task}
                        column={NOW_COLUMNS.doing}
                        disabled={disabled}
                      >
                        {renderTask(task)}
                      </BoardCard>
                    </div>
                  );
                })
              )}
            </div>
          </NowDropSection>

          {alerts}

          <NowDropSection
            state="planned"
            label={t("计划中")}
            disabled={disabled}
          >
            <div
              data-list-section="true"
              className="now-section-heading flex items-center border-b border-border/80"
            >
              <button
                type="button"
                aria-expanded={plannedOpen}
                onClick={() => toggleSection("planned")}
                className="task-section-toggle flex min-w-0 cursor-pointer items-center gap-1.5 py-1 text-left transition-colors select-none"
              >
                <span className="task-section-chevron" aria-hidden="true">
                  <ChevronRight
                    className={`size-3.5 transition-transform duration-150 ${
                      plannedOpen ? "rotate-90" : ""
                    }`}
                  />
                </span>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("计划中")}
                </h2>
                <span className="ml-0.5 text-xs font-normal tabular-nums text-muted-foreground/75">
                  {plannedGroups.reduce(
                    (acc, [, list]) => acc + list.length,
                    0,
                  )}
                </span>
              </button>
            </div>
            <div
              data-drop-content
              hidden={!plannedOpen}
              className="now-scheduled-groups min-h-7"
            >
              {plannedGroups.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  {t("无任务")}
                </p>
              ) : (
                plannedGroups.map(([label, list]) => (
                  <div key={label} className="now-scheduled-group">
                    <h3 className="now-scheduled-heading">{label}</h3>
                    <div>
                      {list.map((task) => (
                        <BoardCard
                          key={task.uuid}
                          compact
                          interactive={!disabled}
                          task={task}
                          column={NOW_COLUMNS.planned}
                          disabled={disabled}
                        >
                          {renderTask(task)}
                        </BoardCard>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </NowDropSection>

          <NowDropSection
            state="waiting"
            label={t("等待中")}
            disabled={disabled}
          >
            <div
              data-list-section="true"
              className="now-section-heading flex items-center border-b border-border/80"
            >
              <button
                type="button"
                aria-expanded={waitingOpen}
                onClick={() => toggleSection("waiting")}
                className="task-section-toggle flex min-w-0 cursor-pointer items-center gap-1.5 py-1 text-left transition-colors select-none"
              >
                <span className="task-section-chevron" aria-hidden="true">
                  <ChevronRight
                    className={`size-3.5 transition-transform duration-150 ${
                      waitingOpen ? "rotate-90" : ""
                    }`}
                  />
                </span>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("等待中")}
                </h2>
                <span className="ml-0.5 text-xs font-normal tabular-nums text-muted-foreground/75">
                  {waiting.length}
                </span>
              </button>
            </div>
            <div data-drop-content hidden={!waitingOpen} className="min-h-7">
              {waiting.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  {t("无任务")}
                </p>
              ) : (
                waiting.map((task) => (
                  <div key={task.uuid}>
                    <BoardCard
                      compact
                      interactive={!disabled}
                      task={task}
                      column={NOW_COLUMNS.waiting}
                      disabled={disabled}
                    >
                      {renderTask(task)}
                    </BoardCard>
                    {(task.waitReason || task.wait) && (
                      <div className="-mt-1 pb-2 pl-[30px] text-xs text-muted-foreground">
                        {task.waitReason && (
                          <span className="mr-2">
                            {t("原因：")}
                            {task.waitReason}
                          </span>
                        )}
                        {task.wait && (
                          <span>
                            {t("核对日：")}
                            {toDueDay(task.wait) || dueLabel(task.wait)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </NowDropSection>

          <NowDropSection
            state="parked"
            label={t("长期搁置")}
            disabled={disabled}
          >
            <div
              data-list-section="true"
              className="now-section-heading flex items-center border-b border-border/80"
            >
              <button
                type="button"
                aria-expanded={parkedOpen}
                onClick={() => toggleSection("parked")}
                className="task-section-toggle flex min-w-0 cursor-pointer items-center gap-1.5 py-1 text-left transition-colors select-none"
              >
                <span className="task-section-chevron" aria-hidden="true">
                  <ChevronRight
                    className={`size-3.5 transition-transform duration-150 ${
                      parkedOpen ? "rotate-90" : ""
                    }`}
                  />
                </span>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("长期搁置")}
                </h2>
                <span className="ml-0.5 text-xs font-normal tabular-nums text-muted-foreground/75">
                  {parked.length}
                </span>
              </button>
            </div>
            <div data-drop-content hidden={!parkedOpen} className="min-h-7">
              {parked.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  {t("无任务")}
                </p>
              ) : (
                parked.map((task) => (
                  <div key={task.uuid}>
                    <BoardCard
                      compact
                      interactive={!disabled}
                      task={task}
                      column={NOW_COLUMNS.parked}
                      disabled={disabled}
                    >
                      {renderTask(task)}
                    </BoardCard>
                    {task.wait && (
                      <div className="-mt-1 pb-2 pl-[30px] text-xs text-muted-foreground">
                        {t("复查日：")}
                        {toDueDay(task.wait) || dueLabel(task.wait)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </NowDropSection>
        </div>
        <TaskDragLayer
          area={scrollArea}
          tasks={taskByUuid}
          layout="list"
          enableNesting={false}
          onDrop={handleDrop}
        />
      </DndContext>
    </div>
  );
}
