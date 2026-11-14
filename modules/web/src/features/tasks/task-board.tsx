import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import {
  columnTasks,
  placeCard,
  UNSECTIONED,
  unsectionedColumn,
  type BoardChange,
  type BoardColumn as Column,
  type BoardState,
} from "@core/workspace/board";
import type { Organization, SavedTag } from "@core/workspace/organization";
import { closestCenter, DndContext } from "@dnd-kit/core";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { Inbox } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TaskRenderFn } from "@/app/hooks/use-task-renderer";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardSectionDialogs } from "./board-dialogs";
import { columnDisplayName } from "./board-helpers";
import type { DropPosition } from "./drag-model";
import { InlineColumnCreator } from "./inline-column-creator";
import { TaskDragLayer } from "./task-drag-layer";
import { TodaySplitView } from "./today-split-view";
import { useBoardDnd } from "./use-board-dnd";

export { columnDisplayName } from "./board-helpers";
export { SmartPointerSensor } from "./smart-pointer-sensor";

type TaskBoardProps = {
  layout?: "board" | "list";
  initialScrollLeft: number;
  onScrollPositionChange: (position: number) => void;
  tasks: Task[];
  allTasks?: Task[];
  board: BoardState;
  revision: number;
  loading: boolean;
  loaded: boolean;
  disabled: boolean;
  saving: boolean;
  blocked: boolean;
  error: string;
  moving?: { uuid: string; columnId: string; beforeUuid: string | null };
  renderTask: TaskRenderFn;
  onMove: (
    task: Task,
    columnId: string,
    beforeUuid: string | null,
    parentUuid?: string | null,
  ) => Promise<boolean>;
  onAdd: (draft?: TaskInput) => void;
  onCreateTask?: (task: TaskInput, columnId?: string) => Promise<boolean>;
  projects?: string[];
  availableLabels?: SavedTag[];
  project?: string;
  defaultProject?: string;
  defaultDue?: string;
  todaySplit?: boolean;
  preserveTaskOrder?: boolean;
  onRescheduleOverdue?: (overdueTasks: Task[]) => Promise<void>;
  canAddTask?: boolean;
  canAddSection?: boolean;
  hasSearch?: boolean;
  onClearSearch?: () => void;
  onChange: (change: BoardChange) => Promise<boolean>;
  onReload: () => Promise<Organization | undefined>;
  onClearError: () => void;
};

/** Orchestrates list sections, Today split sections, and draggable board columns. */
export function TaskBoard({
  layout = "board",
  initialScrollLeft,
  onScrollPositionChange,
  tasks,
  allTasks = tasks,
  board,
  revision,
  loading,
  loaded,
  disabled,
  saving,
  blocked,
  error,
  moving,
  renderTask,
  onMove,
  onAdd,
  onCreateTask,
  projects = [],
  availableLabels = [],
  project,
  defaultProject = "",
  defaultDue = "",
  todaySplit = false,
  preserveTaskOrder = false,
  onRescheduleOverdue,
  canAddTask = true,
  canAddSection,
  hasSearch = false,
  onClearSearch,
  onChange,
  onReload,
  onClearError,
}: TaskBoardProps) {
  const [announcement, setAnnouncement] = useState("");
  const allTasksList = allTasks.length ? allTasks : tasks;
  const allTasksMap = useMemo(
    () => new Map(allTasksList.map((task) => [task.uuid, task])),
    [allTasksList],
  );

  const [editor, setEditor] = useState<{
    column: Column;
    revision: number;
  }>();
  const [deleting, setDeleting] = useState<{
    column: Column;
    revision: number;
  }>();
  const scrollArea = useRef<HTMLDivElement>(null);
  const currentProj = project ?? defaultProject ?? "";
  const projectColumns = preserveTaskOrder
    ? []
    : board.columns.filter((item) => (item.project || "") === currentProj);
  const columns = [unsectionedColumn, ...projectColumns];
  const visibleColumnIds = useMemo(
    () => new Set(columns.map((item) => item.id)),
    [columns],
  );
  const hasCustomColumns = projectColumns.length > 0;

  useLayoutEffect(() => {
    if (scrollArea.current) {
      scrollArea.current.scrollLeft = initialScrollLeft;
    }
  }, [initialScrollLeft, projectColumns.length]);

  const { sensors, accessibility } = useBoardDnd(layout, columns);

  const displayBoard = moving
    ? placeCard(
        board,
        allTasksList,
        moving.uuid,
        moving.columnId,
        moving.beforeUuid,
      )
    : board;

  async function move(task: Task, target: DropPosition) {
    if (disabled) return;
    setAnnouncement(`正在移动 ${task.description}`);
    const saved = await onMove(
      task,
      target.columnId,
      target.beforeUuid,
      target.parentUuid,
    );
    setAnnouncement(
      saved ? `${task.description} 已移动。` : "无法确认移动，请重新加载看板。",
    );
  }

  function openEditor(column: Column) {
    onClearError();
    setEditor({ column, revision });
  }

  const showSectionCreator =
    canAddTask &&
    (canAddSection ??
      (Boolean(currentProj) || (!todaySplit && layout === "list")));

  return (
    <div
      aria-label={layout === "list" ? "按分区排列的任务列表" : "任务看板"}
      aria-busy={loading}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {error && !editor && !deleting && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center gap-2">
            <span>{error}</span>
            <Button
              variant="link"
              disabled={saving}
              className="h-auto justify-start p-0 text-current"
              onClick={() => void onReload()}
            >
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading && !loaded && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-4" />
          加载中…
        </div>
      )}

      {loaded && !loading && !tasks.length && hasSearch && onClearSearch && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <span>当前视图下没有匹配的任务。</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSearch}
            className="h-8 px-2.5 text-xs text-foreground"
          >
            清除搜索
          </Button>
        </div>
      )}

      {loaded && !loading && !tasks.length && !hasSearch && !canAddTask && (
        <p className="py-8 text-sm text-muted-foreground">暂无已完成任务。</p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={accessibility}
      >
        <div
          ref={scrollArea}
          data-board-scroll
          role="region"
          aria-label={layout === "list" ? "任务分组" : "看板版块"}
          tabIndex={0}
          onScroll={(event) =>
            onScrollPositionChange(event.currentTarget.scrollLeft)
          }
          className={cn(
            "min-w-0 rounded-sm pb-6 outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset",
            layout === "board" &&
              "snap-x snap-proximity overflow-x-auto overscroll-x-contain",
          )}
        >
          <div
            className={
              layout === "list"
                ? "space-y-4"
                : "task-board-columns grid grid-flow-col items-start"
            }
          >
            {todaySplit && layout === "list" ? (
              <TodaySplitView
                columns={columns}
                tasks={tasks}
                displayBoard={displayBoard}
                moving={moving}
                disabled={disabled}
                canAddTask={canAddTask}
                defaultProject={defaultProject}
                defaultDue={defaultDue}
                projects={projects}
                availableLabels={availableLabels}
                renderTask={renderTask}
                onRescheduleOverdue={onRescheduleOverdue}
                onCreateTask={onCreateTask}
                onAdd={onAdd}
              />
            ) : (
              columns.map((column, index) => {
                const items = preserveTaskOrder
                  ? tasks
                  : columnTasks(
                      tasks,
                      displayBoard,
                      column.id,
                      visibleColumnIds,
                    );
                const isUnsectioned = column.id === UNSECTIONED;
                const showColumnHeader = layout === "board" || !isUnsectioned;
                return (
                  <BoardColumn
                    key={column.id}
                    compact={layout === "list"}
                    column={column}
                    count={items.length}
                    index={index - 1}
                    total={projectColumns.length}
                    disabled={disabled}
                    showHeader={showColumnHeader}
                    onEdit={() => openEditor(column)}
                    onShift={(direction) => {
                      onClearError();
                      void onChange({
                        kind: "board",
                        action: "column.move",
                        revision,
                        columnId: column.id,
                        direction,
                      });
                    }}
                    onDelete={() => {
                      onClearError();
                      setDeleting({ column, revision });
                    }}
                  >
                    {items.length === 0 && !hasCustomColumns && (
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <div className="relative mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
                          <Inbox className="size-6" strokeWidth={1.5} />
                        </div>
                        <h3 className="text-sm font-medium text-foreground">
                          暂无任务
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          在下方添加任务以开始
                        </p>
                      </div>
                    )}
                    {items.map((task) => (
                      <BoardCard
                        key={task.uuid}
                        compact={layout === "list"}
                        interactive={canAddTask && !preserveTaskOrder}
                        task={task}
                        column={column}
                        disabled={disabled}
                        saving={moving?.uuid === task.uuid}
                      >
                        {renderTask(
                          task,
                          undefined,
                          layout === "board" ? "card" : "list",
                          0,
                          layout === "list"
                            ? (child, defaultRender) => (
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
                              )
                            : undefined,
                        )}
                      </BoardCard>
                    ))}
                    {canAddTask && (
                      <TodoistTaskComposer
                        mode="add"
                        compact={layout === "list"}
                        disabled={disabled}
                        ariaLabel={`在${columnDisplayName(column)}中添加任务`}
                        placeholder={
                          column.id !== UNSECTIONED
                            ? `在“${columnDisplayName(column)}”中添加任务…`
                            : "添加任务（支持 #项目, @标签, 明天, p1）"
                        }
                        defaultProject={defaultProject}
                        defaultDue={defaultDue}
                        projects={projects}
                        availableLabels={availableLabels}
                        onSubmitTask={
                          onCreateTask
                            ? (task) => onCreateTask(task, column.id)
                            : undefined
                        }
                        onOpenFullEditor={onAdd}
                      />
                    )}
                  </BoardColumn>
                );
              })
            )}
            {showSectionCreator && (
              <InlineColumnCreator
                layout={layout}
                revision={revision}
                project={currentProj}
                disabled={disabled}
                saving={saving}
                onSave={(change) => {
                  onClearError();
                  return onChange(change);
                }}
              />
            )}
          </div>
        </div>
        <TaskDragLayer
          area={scrollArea}
          tasks={allTasksMap}
          layout={layout}
          onDrop={(task, target) => void move(task, target)}
        />
      </DndContext>

      <BoardSectionDialogs
        layout={layout}
        editor={editor}
        deleting={deleting}
        saving={saving}
        blocked={blocked}
        error={error}
        onCloseEditor={() => setEditor(undefined)}
        onCloseDelete={() => setDeleting(undefined)}
        onUpdateDeleteRevision={(nextRevision) =>
          setDeleting((current) =>
            current ? { ...current, revision: nextRevision } : undefined,
          )
        }
        onChange={onChange}
        onReload={onReload}
      />
    </div>
  );
}
