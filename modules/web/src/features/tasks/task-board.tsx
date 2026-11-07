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
import { parseQuickTask } from "@core/tasks/quick-task";
import {
  columnTasks,
  placeCard,
  UNSECTIONED,
  unsectionedColumn,
  type BoardChange,
  type BoardColumn as Column,
  type BoardState,
} from "@core/workspace/board";
import type { Organization } from "@core/workspace/organization";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CornerDownLeft,
  Ellipsis,
  FolderPlus,
  GripVertical,
  ListPlus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { BoardColumnEditor } from "./board-column-editor";

type Position = { columnId: string; beforeUuid: string | null };
type Props = {
  layout?: "board" | "list";
  initialScrollLeft: number;
  onScrollPositionChange: (position: number) => void;
  tasks: Task[];
  board: BoardState;
  revision: number;
  loading: boolean;
  loaded: boolean;
  disabled: boolean;
  saving: boolean;
  blocked: boolean;
  error: string;
  moving?: { uuid: string; columnId: string; beforeUuid: string | null };
  renderTask: (task: Task) => ReactNode;
  onMove: (
    task: Task,
    columnId: string,
    beforeUuid: string | null,
  ) => Promise<boolean>;
  onAdd: (draft?: TaskInput) => void;
  onCreateTask?: (task: TaskInput, columnId?: string) => Promise<boolean>;
  canAddTask?: boolean;
  hasSearch?: boolean;
  onClearSearch?: () => void;
  onChange: (change: BoardChange) => Promise<boolean>;
  onReload: () => Promise<Organization | undefined>;
  onClearError: () => void;
};

function canDrag(target: EventTarget, card: HTMLDivElement) {
  // Portal menus bubble through React's card tree, but are not drag surfaces.
  if (!(target instanceof Element) || !card.contains(target)) return false;
  if (target.closest("[data-drag-handle]")) return true;
  if (
    target.closest(
      '[data-no-drag],label,input,textarea,select,[role="checkbox"],[role="combobox"],[contenteditable="true"]',
    )
  )
    return false;
  const control = target.closest("button,a");
  return !control || control.hasAttribute("data-task-drag-surface");
}

function BoardTaskComposer({
  column,
  compact,
  disabled,
  onCreateTask,
  onFallbackAdd,
}: {
  column: Column;
  compact: boolean;
  disabled: boolean;
  onCreateTask?: (task: TaskInput, columnId?: string) => Promise<boolean>;
  onFallbackAdd: (draft?: TaskInput) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          if (!onCreateTask) {
            onFallbackAdd();
            return;
          }
          setError("");
          setEditing(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={
          compact
            ? "task-add-button"
            : "mt-1 flex h-9 w-full items-center justify-start gap-2 rounded-lg px-2.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-(--row-hover) hover:text-foreground has-[>svg]:px-2.5"
        }
      >
        <Plus
          className={compact ? "size-[18px]" : "size-4"}
          strokeWidth={1.5}
        />
        Add task
      </Button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || submitting || !onCreateTask) return;
    const parsed = parseQuickTask(text);
    if (parsed.errors.length) {
      setError(parsed.errors[0]);
      inputRef.current?.focus();
      return;
    }
    if (!parsed.task.description.trim()) {
      setEditing(false);
      setText("");
      setError("");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const ok = await onCreateTask(parsed.task, column.id);
      if (ok) {
        setText("");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className={compact ? "mt-0.5" : "mt-1"}>
      <div
        className={
          compact
            ? "-mx-2.5 flex min-h-11 items-center gap-2 rounded-lg bg-(--row-hover) px-2.5 md:-mx-3 md:min-h-8 md:px-3"
            : "flex min-h-10 items-center gap-2 rounded-xl border border-ring/40 bg-card px-3 py-1.5 shadow-xs"
        }
      >
        {compact && (
          <span
            aria-hidden="true"
            className="flex h-11 w-8 shrink-0 items-center justify-start md:h-8 md:w-7"
          >
            <span className="size-[18px] rounded-full border border-muted-foreground/45 bg-background" />
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={text}
          disabled={disabled || submitting}
          aria-label={`Add task${column.id !== UNSECTIONED ? ` to ${column.name}` : ""}`}
          placeholder={
            column.id !== UNSECTIONED
              ? `Add task to ${column.name}…`
              : "New task… (Enter to add, Esc to close)"
          }
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setText("");
              setError("");
              return;
            }
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "e"
            ) {
              event.preventDefault();
              const parsed = parseQuickTask(text);
              setEditing(false);
              setText("");
              setError("");
              onFallbackAdd(parsed.task);
            }
          }}
          onBlur={(event) => {
            if (
              !text.trim() &&
              !submitting &&
              !event.currentTarget.form?.contains(
                event.relatedTarget as Node | null,
              )
            ) {
              setEditing(false);
              setError("");
            }
          }}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled || submitting}
            title="Open full task editor (⌘E)"
            aria-label="Open full task editor"
            onClick={() => {
              const parsed = parseQuickTask(text);
              setEditing(false);
              setText("");
              setError("");
              onFallbackAdd(parsed.task);
            }}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <ListPlus className="size-3.5" />
          </Button>
          <Button
            type="submit"
            size="xs"
            disabled={disabled || submitting || !text.trim()}
            className="h-6 gap-1 rounded-md px-2 text-xs shadow-none"
          >
            {submitting ? (
              <Spinner className="size-3" />
            ) : (
              <>
                Add
                <CornerDownLeft className="size-3 opacity-70" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={submitting}
            aria-label="Cancel adding task"
            onClick={() => {
              setEditing(false);
              setText("");
              setError("");
            }}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function InlineColumnCreator({
  layout,
  revision,
  disabled,
  saving,
  onSave,
}: {
  layout: "list" | "board";
  revision: number;
  disabled: boolean;
  saving: boolean;
  onSave: (change: BoardChange) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <div className={layout === "list" ? "pt-2" : ""}>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setEditing(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className={
            layout === "list"
              ? "-ml-2.5 h-8 gap-2 rounded-lg px-2.5 text-xs font-normal text-muted-foreground/80 hover:bg-(--row-hover) hover:text-foreground has-[>svg]:px-2.5"
              : "h-11 w-full justify-start gap-2.5 self-start rounded-xl border border-dashed border-border/80 px-3.5 text-sm font-normal text-muted-foreground hover:border-ring/40 hover:bg-(--row-hover) hover:text-foreground md:h-10"
          }
        >
          <FolderPlus className="size-4" strokeWidth={1.5} />
          {layout === "list" ? "Add section" : "Add column"}
        </Button>
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
      column: { id: "", name: trimmed },
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
          ? "mt-2 flex max-w-sm items-center gap-1.5 rounded-lg border border-ring/40 bg-background px-2.5 py-1"
          : "flex h-10 w-full items-center gap-1.5 self-start rounded-xl border border-ring/40 bg-background px-3"
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        maxLength={40}
        disabled={disabled || saving}
        placeholder={layout === "list" ? "Section name…" : "Column name…"}
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
        className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="xs"
        disabled={disabled || saving || !name.trim()}
        className="h-6 rounded-md px-2 text-xs shadow-none"
      >
        {saving ? <Spinner className="size-3" /> : "Add"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={saving}
        aria-label="Cancel"
        onClick={() => {
          setEditing(false);
          setName("");
        }}
        className="size-6 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </form>
  );
}

function BoardCard({
  task,
  column,
  columns,
  disabled,
  saving,
  before,
  children,
  onMove,
  compact,
  interactive = true,
}: {
  task: Task;
  column: Column;
  columns: Column[];
  disabled: boolean;
  saving: boolean;
  before: boolean;
  compact?: boolean;
  interactive?: boolean;
  children: ReactNode;
  onMove: (task: Task, columnId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: task.uuid,
      data: { columnId: column.id, name: task.description },
      disabled: disabled || !interactive,
    });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${task.uuid}`,
    data: { kind: "card", columnId: column.id, uuid: task.uuid },
    disabled: disabled || !interactive,
  });
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      setDropRef(node);
    },
    [setNodeRef, setDropRef],
  );
  const canMoveColumn = columns.length > 1;
  return (
    <div
      ref={setRefs}
      data-task-card={task.uuid}
      data-compact={compact ? "true" : undefined}
      aria-busy={saving}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (interactive && canDrag(event.target, event.currentTarget))
          listeners?.onMouseDown?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLDivElement>) => {
        if (interactive && canDrag(event.target, event.currentTarget))
          listeners?.onTouchStart?.(event);
      }}
      className={cn(
        "board-card group/card relative select-none [&:has(:focus-visible)]:bg-(--row-hover)",
        compact
          ? "-mx-2.5 flex min-w-0 items-start px-2.5 shadow-none md:-mx-3 md:px-3"
          : "cursor-grab rounded-xl border border-border/80 bg-card px-3.5 pt-1.5 pb-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[box-shadow,opacity,border-color,background-color] duration-150 hover:border-ring/40 hover:shadow-[0_3px_10px_rgb(0_0_0/0.05)] active:cursor-grabbing",
        isDragging && "opacity-30",
        before &&
          "before:absolute before:-top-2 before:inset-x-0 before:h-0.5 before:rounded-full before:bg-primary/60",
      )}
    >
      {children}
      {interactive && (!compact || canMoveColumn || saving) && (
        <div
          data-no-drag
          className={cn(
            "flex items-center text-muted-foreground transition-opacity",
            compact
              ? "h-11 shrink-0 gap-0.5 self-start pl-0.5 opacity-75 md:h-8 md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 [&:has([data-state=open])]:opacity-100"
              : "h-9 justify-between pb-0.5 opacity-80 md:h-7 md:opacity-65 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 [&:has([data-state=open])]:opacity-100",
          )}
        >
          {!compact && (
            <Button
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={(event) => listeners?.onKeyDown?.(event)}
              data-drag-handle
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`Drag task: ${task.description}`}
              className="-ml-1 size-7 cursor-grab touch-none text-muted-foreground opacity-70 transition-opacity hover:opacity-100 active:cursor-grabbing max-md:size-9"
            >
              <GripVertical className="size-3.5" />
            </Button>
          )}
          {saving ? (
            <Spinner className="mr-2 size-3.5" aria-label="Saving task" />
          ) : (
            canMoveColumn && (
              <Select
                value={column.id}
                disabled={disabled}
                onValueChange={(id) => {
                  if (id !== column.id) onMove(task, id);
                }}
              >
                <SelectTrigger
                  aria-label={`Move task: ${task.description}`}
                  className={cn(
                    "w-auto gap-1 rounded-md border-0 bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-transparent dark:hover:bg-accent",
                    compact
                      ? "data-[size=default]:h-9 md:data-[size=default]:h-7"
                      : "-mr-1 data-[size=default]:h-9 md:data-[size=default]:h-6",
                  )}
                >
                  <SelectValue>{column.name}</SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" align="end" sideOffset={4}>
                  {columns.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          )}
        </div>
      )}
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
  append,
  compact,
  activeDrag,
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
  append: boolean;
  compact?: boolean;
  activeDrag?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
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
      aria-label={`${column.name} column`}
      className={cn(
        "group/column min-w-0 snap-start rounded-lg transition-colors",
        compact ? "pb-0" : "pb-4",
        isOver && "bg-muted/70",
      )}
    >
      {showHeader && (
        <div
          className={cn(
            "mb-3 flex h-11 items-center gap-1.5 md:h-10",
            compact && "mb-0.5 border-b border-border/80",
          )}
        >
          {compact ? (
            <button
              type="button"
              aria-label={`${collapsed ? "Expand" : "Collapse"} group: ${column.name}`}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
              className="-ml-2 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors select-none hover:bg-(--row-hover)"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  !collapsed && "rotate-90",
                )}
              />
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {column.name}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </button>
          ) : (
            <>
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {column.name}
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            </>
          )}
          {column.id !== UNSECTIONED && (
            <Popover open={menu} onOpenChange={setMenu}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Column options: ${column.name}`}
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
                  Rename
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
                  Move left
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
                  Move right
                </Button>
                {column.id !== UNSECTIONED && (
                  <Button
                    variant="navigation"
                    className="h-8 text-xs text-destructive"
                    onClick={() => {
                      setMenu(false);
                      onDelete();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete column
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
      <div
        hidden={compact && showHeader && collapsed}
        className={
          compact
            ? activeDrag
              ? "min-h-6"
              : "min-h-0"
            : "min-h-56 space-y-2.5"
        }
      >
        {children}
        {append && <div className="h-0.5 rounded-full bg-primary/60" />}
      </div>
    </section>
  );
}

export function TaskBoard({
  layout = "board",
  initialScrollLeft,
  onScrollPositionChange,
  tasks,
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
  canAddTask = true,
  hasSearch = false,
  onClearSearch,
  onChange,
  onReload,
  onClearError,
}: Props) {
  const [active, setActive] = useState<Task>();
  const [position, setPosition] = useState<Position>();
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<{
    column: Column;
    revision: number;
  }>();
  const [deleting, setDeleting] = useState<{
    column: Column;
    revision: number;
  }>();
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollLeft = initialScrollLeft;
  }, [initialScrollLeft, board.columns.length]);
  const columns = [unsectionedColumn, ...board.columns];
  const hasCustomColumns = board.columns.length > 0;

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
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const displayBoard = moving
    ? placeCard(board, tasks, moving.uuid, moving.columnId, moving.beforeUuid)
    : board;
  function destination(
    event: DragOverEvent | DragEndEvent | DragMoveEvent,
  ): Position | undefined {
    const { over, active, delta, activatorEvent } = event;
    if (!over) return;
    const columnId = over.data.current?.columnId as string | undefined;
    if (!columnId || !columns.some((item) => item.id === columnId)) return;
    const targetUuid = over.data.current?.uuid as string | undefined;
    if (!targetUuid) return { columnId, beforeUuid: null };
    const items = columnTasks(tasks, board, columnId).filter(
      (task) => task.uuid !== active.id,
    );
    const index = items.findIndex((task) => task.uuid === targetUuid);
    const eventY =
      "clientY" in activatorEvent
        ? Number(activatorEvent.clientY) + delta.y
        : "touches" in activatorEvent
          ? ((activatorEvent as globalThis.TouchEvent).touches[0]?.clientY ??
              0) + delta.y
          : over.rect.top;
    return {
      columnId,
      beforeUuid:
        eventY < over.rect.top + over.rect.height / 2
          ? targetUuid
          : items[index + 1]?.uuid || null,
    };
  }
  async function move(task: Task, target: Position) {
    if (disabled) return;
    setAnnouncement(`Moving ${task.description}.`);
    const saved = await onMove(task, target.columnId, target.beforeUuid);
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
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
        collisionDetection={(args) => {
          const available = args.droppableContainers.filter(
            (item) => item.data.current?.uuid !== args.active.id,
          );
          if (args.pointerCoordinates) {
            const hits = pointerWithin({
              ...args,
              droppableContainers: available,
            });
            const cards = hits.filter((hit) =>
              String(hit.id).startsWith("card:"),
            );
            return cards.length ? cards : hits;
          }
          return closestCenter({
            ...args,
            droppableContainers: available.filter(
              (item) => item.data.current?.kind === "column",
            ),
          });
        }}
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
        onDragStart={({ active }) =>
          setActive(tasks.find((task) => task.uuid === active.id))
        }
        onDragOver={(event) => setPosition(destination(event))}
        onDragMove={(event) => setPosition(destination(event))}
        onDragCancel={() => {
          setActive(undefined);
          setPosition(undefined);
        }}
        onDragEnd={(event) => {
          const task = tasks.find((task) => task.uuid === event.active.id);
          const next = destination(event);
          setActive(undefined);
          setPosition(undefined);
          if (task && next) void move(task, next);
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
                ? "space-y-5"
                : "grid grid-flow-col auto-cols-[18rem] gap-6"
            }
          >
            {columns.map((column, index) => {
              const items = columnTasks(tasks, displayBoard, column.id);
              const showColumnHeader =
                layout === "board" ||
                (hasCustomColumns &&
                  (column.id !== UNSECTIONED || items.length > 0 || !!active));
              return (
                <BoardColumn
                  key={column.id}
                  compact={layout === "list"}
                  activeDrag={!!active}
                  column={column}
                  count={items.length}
                  index={index - 1}
                  total={board.columns.length}
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
                  append={
                    !!active &&
                    position?.columnId === column.id &&
                    position.beforeUuid === null
                  }
                >
                  {items.map((task) => (
                    <BoardCard
                      key={task.uuid}
                      compact={layout === "list"}
                      interactive={canAddTask}
                      task={task}
                      column={column}
                      columns={columns}
                      disabled={disabled}
                      saving={moving?.uuid === task.uuid}
                      before={!!active && position?.beforeUuid === task.uuid}
                      onMove={(task, columnId) =>
                        void move(task, {
                          columnId,
                          beforeUuid: null,
                        })
                      }
                    >
                      {renderTask(task)}
                    </BoardCard>
                  ))}
                  {canAddTask &&
                    (layout === "board" ||
                      column.id !== UNSECTIONED ||
                      !hasCustomColumns ||
                      items.length > 0) && (
                      <BoardTaskComposer
                        column={column}
                        compact={layout === "list"}
                        disabled={disabled}
                        onCreateTask={onCreateTask}
                        onFallbackAdd={onAdd}
                      />
                    )}
                </BoardColumn>
              );
            })}
            {canAddTask && (
              <InlineColumnCreator
                layout={layout}
                revision={revision}
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
        <DragOverlay
          dropAnimation={reduced ? null : { duration: 180, easing: "ease-out" }}
        >
          {active && (
            <div className="rounded-lg border border-border bg-background p-4 text-sm shadow-lg [overflow-wrap:anywhere]">
              {active.description}
            </div>
          )}
        </DragOverlay>
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
            <AlertDialogTitle>Delete {deleting?.column.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tasks will move to Unsectioned. Your tasks will be kept.
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
                  Reload board
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
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
              {saving ? <Spinner className="size-4" /> : "Delete column"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
