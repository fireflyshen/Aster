import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { taskDate } from "@core/tasks/quick-task";
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
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

export function columnDisplayName(col?: { id?: string; name?: string }) {
  if (
    !col ||
    col.id === UNSECTIONED ||
    col.name === "No section" ||
    col.name === "未分区" ||
    col.name === "(没有版块)"
  ) {
    return "(没有版块)";
  }
  return col.name;
}
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Ellipsis,
  FolderPlus,
  Inbox,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { BoardColumnEditor } from "./board-column-editor";
import { TaskDragLayer } from "./task-drag-layer";
import type { DropPosition } from "./drag-model";

type Position = DropPosition;
type Props = {
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
  onRescheduleOverdue?: (overdueTasks: Task[]) => Promise<void>;
  canAddTask?: boolean;
  canAddSection?: boolean;
  hasSearch?: boolean;
  onClearSearch?: () => void;
  onChange: (change: BoardChange) => Promise<boolean>;
  onReload: () => Promise<Organization | undefined>;
  onClearError: () => void;
};

export class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (!event.isPrimary || event.button !== 0) return false;
        const target = event.target as Element | null;
        if (!target) return true;
        if (
          target.closest(
            '[data-no-drag], button, a, input, textarea, select, [role="checkbox"], [role="combobox"], [contenteditable="true"]',
          )
        ) {
          return false;
        }
        if (target.closest("[data-drag-handle]")) return true;
        const isList = Boolean(target.closest("[data-compact='true']"));
        if (isList) {
          return Boolean(target.closest("[data-drag-handle]"));
        }
        return true;
      },
    },
  ];
}

function isTaskOverdue(task: Task): boolean {
  if (task.status === "completed" || !task.due) return false;
  const iso = task.due.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(iso) < today;
}

function InlineColumnCreator({
  layout,
  revision,
  project,
  disabled,
  saving,
  onSave,
}: {
  layout: "list" | "board";
  revision: number;
  project?: string;
  disabled: boolean;
  saving: boolean;
  onSave: (change: BoardChange) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <div
        className={
          layout === "list" ? "task-add-section group/add-section my-3" : ""
        }
      >
        {layout === "list" ? (
          <div className="relative flex items-center justify-center py-2.5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-dashed border-border/70 transition-colors duration-200 group-hover/add-section:border-ring/50" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => {
                setEditing(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="relative h-7 gap-1.5 rounded bg-background px-3 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
              添加分区
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="h-10 w-[260px] justify-start gap-2 self-start rounded-lg border border-dashed border-border/80 px-3 text-sm font-normal text-muted-foreground hover:border-ring/40 hover:bg-muted/40 hover:text-foreground"
          >
            <Plus className="size-4 text-[#de4c4a]" strokeWidth={1.75} />
            添加版块
          </Button>
        )}
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setEditing(false);
      setName("");
      return;
    }
    if (disabled || saving) return;
    const ok = await onSave({
      kind: "board",
      action: "column.save",
      revision,
      column: { id: "", name: trimmed, project: project || "" },
    });
    if (ok) {
      setName("");
      setEditing(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={
        layout === "list"
          ? "my-2 flex max-w-sm items-center gap-1.5 rounded-xl border border-ring/40 bg-card p-2 shadow-sm"
          : "flex h-10 w-[260px] items-center gap-1.5 self-start rounded-lg border border-ring/40 bg-card px-3"
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        maxLength={40}
        disabled={disabled || saving}
        placeholder="为此分区命名…"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
            setName("");
          }
        }}
        onBlur={(event) => {
          if (
            !name.trim() &&
            !saving &&
            !event.currentTarget.form?.contains(
              event.relatedTarget as Node | null,
            )
          ) {
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
      />
      <Button
        type="submit"
        size="xs"
        disabled={disabled || saving || !name.trim()}
        className="h-7 rounded-md px-2.5 text-xs font-medium shadow-none"
      >
        {saving ? <Spinner className="size-3" /> : "添加分区"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => {
          setEditing(false);
          setName("");
        }}
        className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        取消
      </Button>
    </form>
  );
}

function BoardCard({
  task,
  column,
  disabled,
  saving,
  children,
  compact,
  isSubtask = false,
  interactive = true,
}: {
  task: Task;
  column: Column;
  disabled: boolean;
  saving?: boolean;
  compact?: boolean;
  isSubtask?: boolean;
  interactive?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: task.uuid,
      data: { columnId: column.id, name: task.description, isSubtask },
      disabled: disabled || !interactive,
    });
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      setActivatorNodeRef(node);
    },
    [setNodeRef, setActivatorNodeRef],
  );
  return (
    <div
      ref={setRefs}
      data-task-card={task.uuid}
      data-subtask={isSubtask ? "true" : undefined}
      data-compact={compact ? "true" : undefined}
      data-dragging={isDragging || undefined}
      aria-busy={saving}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (
          (e.target as Element).closest("[data-task-card]") === e.currentTarget
        )
          listeners?.onKeyDown?.(e);
      }}
      onPointerDown={(e) => {
        // Prevent child subtask drag from triggering parent task!
        const target = e.target as Element | null;
        if (!target) return;
        const nearestCard = target.closest("[data-task-card]");
        if (nearestCard && nearestCard !== e.currentTarget) {
          return;
        }
        listeners?.onPointerDown?.(e);
      }}
      className={cn(
        "board-card group/card relative [&:has(:focus-visible)]:bg-(--row-hover)",
        compact
          ? isSubtask
            ? "flex min-w-0 items-start shadow-none"
            : "-mx-2.5 flex min-w-0 items-start px-2.5 shadow-none md:-mx-3 md:px-3"
          : "cursor-grab rounded-[10px] border border-border/70 bg-card px-2.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-2 transition-[box-shadow,opacity,border-color,background-color] duration-150 hover:border-foreground/20 hover:shadow-[0_2px_4px_rgba(0,0,0,0.25)] active:cursor-grabbing",
        isDragging && "opacity-25",
      )}
    >
      {children}
    </div>
  );
}

function BoardColumn({
  column,
  count,
  index,
  total,
  disabled,
  showHeader = true,
  onEdit,
  onShift,
  onDelete,
  children,
  compact,
}: {
  column: Column;
  count: number;
  index: number;
  total: number;
  disabled: boolean;
  showHeader?: boolean;
  onEdit: () => void;
  onShift: (direction: "left" | "right") => void;
  onDelete: () => void;
  children: ReactNode;
  compact?: boolean;
}) {
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: { kind: "column", columnId: column.id },
    disabled,
  });
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section
      ref={setNodeRef}
      data-board-column={column.id}
      aria-label={`${columnDisplayName(column)} 列`}
      className={cn(
        "group/column min-w-0 snap-start rounded-lg transition-colors",
        compact
          ? "pb-0"
          : "w-[260px] min-w-[260px] flex flex-col min-h-[calc(100vh-220px)] pb-4",
      )}
    >
      {showHeader && (
        <div
          data-list-section={compact}
          className={cn(
            "mb-3 flex h-11 items-center gap-1.5 md:h-10",
            compact && "mb-0.5 border-b border-border/80",
          )}
        >
          {compact ? (
            <div className="flex w-full items-center justify-between gap-2">
              <button
                type="button"
                aria-label={`${collapsed ? "展开" : "收起"}分组: ${columnDisplayName(column)}`}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed(!collapsed)}
                className="task-section-toggle flex min-w-0 items-center gap-1.5 rounded-md py-1 text-left transition-colors select-none hover:bg-(--row-hover)"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                    !collapsed && "rotate-90",
                  )}
                />
                <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
                  {columnDisplayName(column)}
                </h2>
                <span className="text-xs font-normal tabular-nums text-muted-foreground/75 ml-0.5">
                  {count}
                </span>
              </button>
              <div className="flex-1" />
              {column.id !== UNSECTIONED && (
                <Popover open={menu} onOpenChange={setMenu}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`分区选项: ${columnDisplayName(column)}`}
                      disabled={disabled}
                      className="size-7 text-muted-foreground transition-opacity md:opacity-0 md:group-hover/column:opacity-100 md:group-focus-within/column:opacity-100 data-[state=open]:opacity-100 hover:text-foreground"
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-44 p-1">
                    <Button
                      variant="navigation"
                      className="h-8 text-xs"
                      onClick={() => {
                        setMenu(false);
                        onEdit();
                      }}
                    >
                      <Pencil className="size-3.5" />
                      重命名分区
                    </Button>
                    <Button
                      variant="navigation"
                      className="h-8 text-xs"
                      disabled={index === 0}
                      onClick={() => {
                        setMenu(false);
                        onShift("left");
                      }}
                    >
                      <ArrowUp className="size-3.5" />
                      向上移动
                    </Button>
                    <Button
                      variant="navigation"
                      className="h-8 text-xs"
                      disabled={index === total - 1}
                      onClick={() => {
                        setMenu(false);
                        onShift("right");
                      }}
                    >
                      <ArrowDown className="size-3.5" />
                      向下移动
                    </Button>
                    <Button
                      variant="navigation"
                      className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        setMenu(false);
                        onDelete();
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      删除分区
                    </Button>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          ) : (
            <>
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {columnDisplayName(column)}
              </h2>
              <span className="text-xs font-normal tabular-nums text-muted-foreground/75 ml-0.5">
                {count}
              </span>
              {column.id !== UNSECTIONED && (
                <Popover open={menu} onOpenChange={setMenu}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`列选项: ${columnDisplayName(column)}`}
                      disabled={disabled}
                      className="ml-auto text-muted-foreground transition-opacity md:opacity-0 md:group-hover/column:opacity-100 md:group-focus-within/column:opacity-100 data-[state=open]:opacity-100"
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-40 p-1">
                    <Button
                      variant="navigation"
                      className="h-8 text-xs"
                      onClick={() => {
                        setMenu(false);
                        onEdit();
                      }}
                    >
                      <Pencil className="size-3.5" />
                      重命名
                    </Button>
                    <Button
                      variant="navigation"
                      className="h-8 text-xs"
                      disabled={index === 0}
                      onClick={() => {
                        setMenu(false);
                        onShift("left");
                      }}
                    >
                      <ArrowLeft className="size-3.5" />
                      向左移动
                    </Button>
                    <Button
                      variant="navigation"
                      className="h-8 text-xs"
                      disabled={index === total - 1}
                      onClick={() => {
                        setMenu(false);
                        onShift("right");
                      }}
                    >
                      <ArrowRight className="size-3.5" />
                      向右移动
                    </Button>
                    <Button
                      variant="navigation"
                      className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        setMenu(false);
                        onDelete();
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      删除列
                    </Button>
                  </PopoverContent>
                </Popover>
              )}
            </>
          )}
        </div>
      )}
      <div
        data-drop-content
        hidden={compact && showHeader && collapsed}
        className={
          compact ? "min-h-7" : "flex-1 flex flex-col space-y-2 min-h-64"
        }
      >
        {children}
      </div>
    </section>
  );
}

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
  onRescheduleOverdue,
  canAddTask = true,
  canAddSection,
  hasSearch = false,
  onClearSearch,
  onChange,
  onReload,
  onClearError,
}: Props) {
  const [announcement, setAnnouncement] = useState("");
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const [reschedulingOverdue, setReschedulingOverdue] = useState(false);
  const allTasksList = allTasks.length ? allTasks : tasks;
  const allTasksMap = useMemo(
    () => new Map(allTasksList.map((t) => [t.uuid, t])),
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
  const projectColumns = board.columns.filter(
    (item) => (item.project || "") === currentProj,
  );
  const columns = [unsectionedColumn, ...projectColumns];
  const hasCustomColumns = projectColumns.length > 0;
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollLeft = initialScrollLeft;
  }, [initialScrollLeft, projectColumns.length]);

  const keyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { currentCoordinates, context },
  ) => {
    const backward = layout === "list" ? "ArrowUp" : "ArrowLeft";
    const forward = layout === "list" ? "ArrowDown" : "ArrowRight";
    if (event.code !== backward && event.code !== forward) return;
    event.preventDefault();
    const current =
      context.over?.data.current?.columnId ??
      context.active?.data.current?.columnId;
    const index = columns.findIndex((item) => item.id === current);
    const target = columns[index + (event.code === forward ? 1 : -1)];
    const rect = target && context.droppableRects.get(target.id);
    if (!rect || !context.collisionRect) return;
    if (layout === "list")
      return {
        ...currentCoordinates,
        y:
          currentCoordinates.y +
          rect.top +
          rect.height / 2 -
          (context.collisionRect.top + context.collisionRect.height / 2),
      };
    return {
      ...currentCoordinates,
      x:
        currentCoordinates.x +
        rect.left +
        rect.width / 2 -
        (context.collisionRect.left + context.collisionRect.width / 2),
    };
  };
  const sensors = useSensors(
    useSensor(SmartPointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const displayBoard = moving
    ? placeCard(
        board,
        allTasksList,
        moving.uuid,
        moving.columnId,
        moving.beforeUuid,
      )
    : board;
  async function move(task: Task, target: Position) {
    if (disabled) return;
    setAnnouncement(`Moving ${task.description}.`);
    const saved = await onMove(
      task,
      target.columnId,
      target.beforeUuid,
      target.parentUuid,
    );
    setAnnouncement(
      saved
        ? `${task.description} moved.`
        : "Could not confirm the move. Reload the board.",
    );
  }
  function openEditor(column: Column) {
    onClearError();
    setEditor({ column, revision });
  }
  return (
    <div
      aria-label={layout === "list" ? "Tasks grouped by column" : "Task board"}
      aria-busy={loading}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && !editor && !deleting && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {error}
            <Button
              variant="link"
              disabled={saving}
              className="h-auto justify-start p-0 text-current"
              onClick={() => void onReload()}
            >
              Reload board
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && !loaded && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-4" />
          Loading…
        </div>
      )}
      {loaded && !loading && !tasks.length && hasSearch && onClearSearch && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <span>No matching tasks in this view.</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSearch}
            className="h-8 px-2.5 text-xs text-foreground"
          >
            Clear search
          </Button>
        </div>
      )}
      {loaded && !loading && !tasks.length && !hasSearch && !canAddTask && (
        <p className="py-8 text-sm text-muted-foreground">
          No completed tasks yet.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${active.data.current?.name || "task"}.`,
            onDragOver: ({ over }) =>
              over
                ? `Over ${columns.find((item) => item.id === over.data.current?.columnId)?.name || "column"}.`
                : "Outside the board. Release to cancel.",
            onDragEnd: () => "Task released.",
            onDragCancel: () => "Move cancelled.",
          },
          screenReaderInstructions: {
            draggable:
              layout === "list"
                ? "Press Space to pick up a task, Up or Down to choose a group, Space to move, or Escape to cancel. Use the Move menu as an alternative."
                : "Press Space to pick up a task, Left or Right to choose a column, Space to move, or Escape to cancel. Use the Move menu as an alternative.",
          },
        }}
      >
        <div
          ref={scrollArea}
          data-board-scroll
          role="region"
          aria-label={layout === "list" ? "Task groups" : "Board columns"}
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
                : "grid grid-flow-col auto-cols-[260px] gap-4 items-start"
            }
          >
            {todaySplit && layout === "list"
              ? (() => {
                  const ordered = columns.flatMap((col) =>
                    columnTasks(tasks, displayBoard, col.id).map((task) => ({
                      task,
                      column: col,
                    })),
                  );
                  const overdueEntries = ordered.filter(({ task }) =>
                    isTaskOverdue(task),
                  );
                  const todayEntries = ordered.filter(
                    ({ task }) => !isTaskOverdue(task),
                  );
                  return (
                    <div className="space-y-6">
                      {overdueEntries.length > 0 && (
                        <section
                          data-board-column={UNSECTIONED}
                          aria-label="Overdue tasks"
                          className="min-w-0"
                        >
                          <div className="mb-1 flex h-10 items-center justify-between gap-2 border-b border-border/80">
                            <button
                              type="button"
                              aria-expanded={!overdueCollapsed}
                              onClick={() =>
                                setOverdueCollapsed(!overdueCollapsed)
                              }
                              className="-ml-2 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors select-none hover:bg-(--row-hover)"
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                                  !overdueCollapsed && "rotate-90",
                                )}
                              />
                              <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">
                                Overdue
                              </h2>
                              <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-red-600 dark:text-red-400">
                                {overdueEntries.length}
                              </span>
                            </button>
                            {onRescheduleOverdue && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
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
                                className="h-7 gap-1.5 rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
                              >
                                {reschedulingOverdue ? (
                                  <Spinner className="size-3" />
                                ) : (
                                  <CalendarClock className="size-3.5" />
                                )}
                                Reschedule to Today
                              </Button>
                            )}
                          </div>
                          <div hidden={overdueCollapsed}>
                            {overdueEntries.map(({ task, column }) => (
                              <BoardCard
                                key={task.uuid}
                                compact
                                interactive={canAddTask}
                                task={task}
                                column={column}
                                disabled={disabled}
                                saving={moving?.uuid === task.uuid}
                              >
                                {renderTask(
                                  task,
                                  undefined,
                                  "list",
                                  0,
                                  (child, defaultRender) => (
                                    <BoardCard
                                      key={child.uuid}
                                      task={child}
                                      column={column}
                                      compact={true}
                                      isSubtask={true}
                                      disabled={disabled}
                                      interactive={canAddTask}
                                      saving={moving?.uuid === child.uuid}
                                    >
                                      {defaultRender(child)}
                                    </BoardCard>
                                  ),
                                )}
                              </BoardCard>
                            ))}
                          </div>
                        </section>
                      )}
                      <section
                        data-board-column={UNSECTIONED}
                        aria-label="Today tasks"
                        className="min-w-0"
                      >
                        {overdueEntries.length > 0 && (
                          <div className="mb-1 flex h-10 items-center gap-2 border-b border-border/80">
                            <h2 className="text-sm font-semibold">
                              {format(new Date(), "M月d日")} · 今天 ·{" "}
                              {format(new Date(), "EEEE", { locale: zhCN })}
                            </h2>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {todayEntries.length}
                            </span>
                          </div>
                        )}
                        <div>
                          {todayEntries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                              <div className="relative mb-3 flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                                <CheckCircle2
                                  className="size-7"
                                  strokeWidth={1.75}
                                />
                              </div>
                              <h3 className="text-sm font-semibold text-foreground">
                                所有任务已完成！
                              </h3>
                              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                今天安排的所有任务都已完成。享受美好的一天！
                              </p>
                            </div>
                          ) : (
                            todayEntries.map(({ task, column }) => (
                              <BoardCard
                                key={task.uuid}
                                compact
                                interactive={canAddTask}
                                task={task}
                                column={column}
                                disabled={disabled}
                                saving={moving?.uuid === task.uuid}
                              >
                                {renderTask(
                                  task,
                                  undefined,
                                  "list",
                                  0,
                                  (child, defaultRender) => (
                                    <BoardCard
                                      key={child.uuid}
                                      task={child}
                                      column={column}
                                      compact={true}
                                      isSubtask={true}
                                      disabled={disabled}
                                      interactive={canAddTask}
                                      saving={moving?.uuid === child.uuid}
                                    >
                                      {defaultRender(child)}
                                    </BoardCard>
                                  ),
                                )}
                              </BoardCard>
                            ))
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
                                  ? (task) =>
                                      onCreateTask(task, unsectionedColumn.id)
                                  : undefined
                              }
                              onOpenFullEditor={onAdd}
                            />
                          )}
                        </div>
                      </section>
                    </div>
                  );
                })()
              : columns.map((column, index) => {
                  const items = columnTasks(tasks, displayBoard, column.id);
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
                          interactive={canAddTask}
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
                                    compact={true}
                                    isSubtask={true}
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
                })}
            {canAddTask &&
              (canAddSection ??
                (!!currentProj || (!todaySplit && layout === "list"))) && (
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
      {editor && (
        <BoardColumnEditor
          column={editor.column}
          revision={editor.revision}
          busy={saving}
          blocked={blocked}
          error={error}
          onClose={() => setEditor(undefined)}
          onSave={onChange}
          onReload={onReload}
        />
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleting(undefined);
        }}
      >
        <AlertDialogContent
          className="max-w-sm"
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除分区“{columnDisplayName(deleting?.column)}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该分区下的任务将移至未分区，任务内容将被保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                <Button
                  variant="link"
                  disabled={saving}
                  onClick={async () => {
                    const latest = await onReload();
                    if (latest && deleting)
                      setDeleting({
                        ...deleting,
                        revision: latest.revision,
                      });
                  }}
                >
                  重新加载看板
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || blocked}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                if (
                  deleting &&
                  (await onChange({
                    kind: "board",
                    action: "column.delete",
                    revision: deleting.revision,
                    columnId: deleting.column.id,
                  }))
                )
                  setDeleting(undefined);
              }}
            >
              {saving ? (
                <Spinner className="size-4" />
              ) : layout === "list" ? (
                "删除分区"
              ) : (
                "删除列"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
