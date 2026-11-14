import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarClock, CheckCircle2, ChevronRight } from "lucide-react";
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
  onRescheduleOverdue?: (overdueTasks: Task[]) => Promise<void>;
  onCreateTask?: (task: TaskInput, columnId?: string) => Promise<boolean>;
  onAdd: (draft?: TaskInput) => void;
};

/** Today view split into collapsible Overdue section and Today section. */
export function TodaySplitView({
  columns,
  tasks,
  displayBoard,
  moving,
  disabled,
  canAddTask,
  defaultProject,
  defaultDue,
  projects,
  availableLabels,
  renderTask,
  onRescheduleOverdue,
  onCreateTask,
  onAdd,
}: TodaySplitViewProps) {
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const [reschedulingOverdue, setReschedulingOverdue] = useState(false);

  const visibleColumnIds = new Set(columns.map((col) => col.id));
  const ordered = columns.flatMap((col) =>
    columnTasks(tasks, displayBoard, col.id, visibleColumnIds).map((task) => ({
      task,
      column: col,
    })),
  );
  const overdueEntries = ordered.filter(({ task }) =>
    isTaskOverdue({ due: task.due, status: "pending" }),
  );
  const todayEntries = ordered.filter(
    ({ task }) => !isTaskOverdue({ due: task.due, status: "pending" }),
  );

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
    <div className="space-y-6">
      {overdueEntries.length > 0 && (
        <section
          data-board-column={UNSECTIONED}
          aria-label="逾期任务"
          className="min-w-0"
        >
          <div className="mb-1 flex h-10 items-center justify-between gap-2 border-b border-border/80">
            <button
              type="button"
              aria-expanded={!overdueCollapsed}
              onClick={() => setOverdueCollapsed((prev) => !prev)}
              className="-ml-2 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors select-none hover:bg-(--row-hover)"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  !overdueCollapsed && "rotate-90",
                )}
              />
              <h2 className="text-sm font-semibold text-foreground">逾期</h2>
              <span className="text-xs font-normal tabular-nums text-muted-foreground/75">
                {overdueEntries.length}
              </span>
            </button>
            {onRescheduleOverdue && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="重新安排逾期任务到今天"
                disabled={disabled || reschedulingOverdue}
                onClick={async () => {
                  setReschedulingOverdue(true);
                  try {
                    await onRescheduleOverdue(
                      overdueEntries.map((item) => item.task),
                    );
                  } finally {
                    setReschedulingOverdue(false);
                  }
                }}
                className="h-7 gap-1.5 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
              >
                {reschedulingOverdue ? (
                  <Spinner className="size-3" />
                ) : (
                  <CalendarClock className="size-3.5" />
                )}
                重新安排
              </Button>
            )}
          </div>
          <div hidden={overdueCollapsed}>{overdueEntries.map(renderEntry)}</div>
        </section>
      )}

      <section
        data-board-column={UNSECTIONED}
        aria-label="今日任务"
        className="min-w-0"
      >
        {overdueEntries.length > 0 && (
          <div className="mb-1 flex h-10 items-center gap-2 border-b border-border/80">
            <h2 className="text-sm font-semibold">
              {format(new Date(), "M月d日")} · 今天 ·{" "}
              {format(new Date(), "EEEE", { locale: zhCN })}
            </h2>
            <span className="text-xs font-normal tabular-nums text-muted-foreground/75">
              {todayEntries.length}
            </span>
          </div>
        )}
        <div>
          {todayEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="relative mb-3 flex size-14 items-center justify-center rounded-2xl bg-(--due-today)/12 text-(--due-today)">
                <CheckCircle2 className="size-7" strokeWidth={1.75} />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                今天的所有任务已完成
              </h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                尽情享受井井有条的一天。
              </p>
            </div>
          ) : (
            todayEntries.map(renderEntry)
          )}
          {canAddTask && (
            <TodoistTaskComposer
              mode="add"
              compact
              disabled={disabled}
              ariaLabel="添加任务至今天"
              placeholder="添加任务（支持 #项目, @标签, 明天, p1）"
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
