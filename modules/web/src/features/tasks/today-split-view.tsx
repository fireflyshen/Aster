import { useI18n } from "@/app/language";
import { RescheduleOverdue } from "./reschedule-overdue";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { taskDate } from "@core/tasks/quick-task";
import {
  columnTasks,
  UNSECTIONED,
  unsectionedColumn,
  type BoardColumn as Column,
  type BoardState,
} from "@core/workspace/board";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BoardCard } from "./board-card";
import { isTaskOverdue } from "./task-date";

type TodaySplitViewProps = {
  columns: Column[];
  tasks: Task[];
  displayBoard: BoardState;
  moving?: { uuid: string; columnId: string; beforeUuid: string | null };
  disabled: boolean;
  canAddTask: boolean;
  hasSearch?: boolean;
  defaultProject: string;
  defaultDue: string;
  projects: string[];
  availableLabels: SavedTag[];
  renderTask: (
    task: Task,
    extraActions?: ReactNode,
    variant?: "list" | "card",
    depth?: number,
    renderSubtaskWrapper?: (
      child: Task,
      defaultRender: (child: Task) => ReactNode,
    ) => ReactNode,
  ) => ReactNode;
  onRescheduleOverdue?: (overdueTasks: Task[], day: string) => Promise<void>;
  onCreateTask?: (task: TaskInput, columnId?: string) => Promise<boolean>;
  onAdd: (draft?: TaskInput) => void;
  excludedTaskUuids?: ReadonlySet<string>;
};

/** Today view split into collapsible Overdue section and Today section. */
export function TodaySplitView({
  columns,
  tasks,
  displayBoard,
  moving,
  disabled,
  canAddTask,
  hasSearch = false,
  defaultProject,
  defaultDue,
  projects,
  availableLabels,
  renderTask,
  onRescheduleOverdue,
  onCreateTask,
  onAdd,
  excludedTaskUuids,
}: TodaySplitViewProps) {
  const { t } = useI18n();
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);

  const visibleColumnIds = new Set(columns.map((col) => col.id));
  const ordered = columns
    .flatMap((col) =>
      columnTasks(tasks, displayBoard, col.id, visibleColumnIds).map(
        (task) => ({
          task,
          column: col,
        }),
      ),
    )
    .filter(({ task }) => !excludedTaskUuids?.has(task.uuid));
  const overdueEntries = ordered.filter(({ task }) => isTaskOverdue(task));
  const todayEntries = ordered.filter(({ task }) => !isTaskOverdue(task));

  const renderEntry = ({ task, column }: { task: Task; column: Column }) => (
    <BoardCard
      key={task.uuid}
      compact
      interactive={canAddTask}
      task={task}
      column={column}
      disabled={disabled}
      saving={moving?.uuid === task.uuid}
    >
      {renderTask(task, undefined, "list", 0, (child, defaultRender) => (
        <BoardCard
          key={child.uuid}
          task={child}
          column={column}
          compact
          isSubtask
          disabled={disabled}
          interactive={canAddTask}
          saving={moving?.uuid === child.uuid}
        >
          {defaultRender(child)}
        </BoardCard>
      ))}
    </BoardCard>
  );

  return (
    <div className="today-sections">
      {overdueEntries.length > 0 && (
        <section
          data-board-column={UNSECTIONED}
          aria-label={t("逾期任务")}
          className="min-w-0"
        >
          <div
            data-list-section="true"
            className="flex items-center justify-between gap-2 border-b border-border/80"
          >
            <button
              type="button"
              aria-expanded={!overdueCollapsed}
              onClick={() => setOverdueCollapsed((prev) => !prev)}
              className="task-section-toggle flex min-w-0 cursor-pointer items-center gap-1.5 py-1 text-left transition-colors select-none"
            >
              <span className="task-section-chevron" aria-hidden="true">
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-150",
                    !overdueCollapsed && "rotate-90",
                  )}
                />
              </span>
              <h2 className="text-sm font-semibold text-foreground">
                {t("逾期")}
              </h2>
              <span className="text-xs font-normal tabular-nums text-muted-foreground/75">
                {overdueEntries.length}
              </span>
            </button>
            {onRescheduleOverdue && (
              <RescheduleOverdue
                tasks={overdueEntries.map((item) => item.task)}
                disabled={disabled}
                onReschedule={onRescheduleOverdue}
              />
            )}
          </div>
          <div hidden={overdueCollapsed}>{overdueEntries.map(renderEntry)}</div>
        </section>
      )}

      <section
        data-board-column={UNSECTIONED}
        aria-label={t("今日任务")}
        className="min-w-0"
      >
        {overdueEntries.length > 0 && (
          <div
            data-list-section="true"
            className="flex items-center gap-2 border-b border-border/80"
          >
            <h2 className="text-sm font-semibold">{t("今日任务")}</h2>
            <span className="text-xs font-normal tabular-nums text-muted-foreground/75">
              {todayEntries.length}
            </span>
          </div>
        )}
        <div>
          {todayEntries.length === 0
            ? !hasSearch && (
                <div className="today-empty">
                  <span className="flex size-8 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
                    <CheckCircle2 className="size-4" strokeWidth={1.6} />
                  </span>
                  <h3 className="text-sm font-medium text-foreground">
                    {overdueEntries.length
                      ? t("今天暂无安排")
                      : t("今天没有待办任务")}
                  </h3>
                </div>
              )
            : todayEntries.map(renderEntry)}
          {canAddTask && (
            <TodoistTaskComposer
              mode="add"
              compact
              disabled={disabled}
              ariaLabel={t("添加任务至今天")}
              placeholder={t("添加任务")}
              defaultProject={defaultProject}
              defaultDue={defaultDue || taskDate(new Date())}
              projects={projects}
              availableLabels={availableLabels}
              onSubmitTask={
                onCreateTask
                  ? (task) => onCreateTask(task, unsectionedColumn.id)
                  : undefined
              }
              onOpenFullEditor={onAdd}
            />
          )}
        </div>
      </section>
    </div>
  );
}
