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
import {
  columnTasks,
  placeCard,
  UNSECTIONED,
  unsectionedColumn,
  type BoardChange,
  type BoardState,
  type BoardColumn as Column,
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
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { BoardColumnEditor } from "./board-column-editor";

type Position = { columnId: string; beforeUuid: string | null };
type Props = {
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
  onAdd: () => void;
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
function BoardCard({
  task,
  column,
  columns,
  disabled,
  saving,
  before,
  children,
  onMove,
}: {
  task: Task;
  column: Column;
  columns: Column[];
  disabled: boolean;
  saving: boolean;
  before: boolean;
  children: ReactNode;
  onMove: (task: Task, columnId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: task.uuid,
      data: { columnId: column.id, name: task.description },
      disabled,
    });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${task.uuid}`,
    data: { kind: "card", columnId: column.id, uuid: task.uuid },
    disabled,
  });
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      setDropRef(node);
    },
    [setNodeRef, setDropRef],
  );
  return (
    <div
      ref={setRefs}
      data-task-card={task.uuid}
      aria-busy={saving}
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (canDrag(event.target, event.currentTarget))
          listeners?.onMouseDown?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLDivElement>) => {
        if (canDrag(event.target, event.currentTarget))
          listeners?.onTouchStart?.(event);
      }}
      className={cn(
        "board-card group relative cursor-grab rounded-lg border border-border bg-background px-3 pt-1 select-none shadow-[0_1px_2px_rgb(0_0_0/0.025)] transition-[box-shadow,opacity] duration-150 hover:shadow-sm active:cursor-grabbing",
        isDragging && "opacity-30",
        before &&
          "before:absolute before:-top-2 before:inset-x-0 before:h-0.5 before:rounded-full before:bg-primary/60",
      )}
    >
      {children}
      <div
        data-no-drag
        className="flex h-11 items-center justify-between pb-1 text-muted-foreground md:h-9"
      >
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
          className="size-8 cursor-grab touch-none text-muted-foreground opacity-60 transition-opacity hover:opacity-100 max-md:size-11 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </Button>
        {saving ? (
          <Spinner className="mr-2 size-3.5" aria-label="Saving task" />
        ) : (
          <Select
            value={column.id}
            disabled={disabled}
            onValueChange={(id) => {
              if (id !== column.id) onMove(task, id);
            }}
          >
            <SelectTrigger
              aria-label={`Move task: ${task.description}`}
              className="w-auto gap-1 rounded-sm border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent data-[size=default]:h-11 md:data-[size=default]:h-8"
            >
              <SelectValue>Move</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={4}>
              {columns.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
function BoardColumn({
  column,
  count,
  index,
  total,
  disabled,
  onEdit,
  onShift,
  onDelete,
  children,
  append,
}: {
  column: Column;
  count: number;
  index: number;
  total: number;
  disabled: boolean;
  onEdit: () => void;
  onShift: (direction: "left" | "right") => void;
  onDelete: () => void;
  children: ReactNode;
  append: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { kind: "column", columnId: column.id },
    disabled,
  });
  const [menu, setMenu] = useState(false);
  return (
    <section
      ref={setNodeRef}
      data-board-column={column.id}
      aria-label={`${column.name} column`}
      className={cn(
        "min-w-0 snap-start rounded-lg pb-4 transition-colors",
        isOver && "bg-muted/70",
      )}
    >
      <div className="mb-3 flex h-11 items-center gap-2 md:h-10">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {column.name}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
        {column.id !== UNSECTIONED && (
          <Popover open={menu} onOpenChange={setMenu}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Column options: ${column.name}`}
                disabled={disabled}
                className="ml-auto text-muted-foreground"
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
      <div className="min-h-56 space-y-2.5">
        {children}
        {append && <div className="h-0.5 rounded-full bg-primary/60" />}
      </div>
    </section>
  );
}
export function TaskBoard({
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
  const keyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { currentCoordinates, context },
  ) => {
    if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
    event.preventDefault();
    const current =
      context.over?.data.current?.columnId ??
      context.active?.data.current?.columnId;
    const index = columns.findIndex((item) => item.id === current);
    const target = columns[index + (event.code === "ArrowRight" ? 1 : -1)];
    const rect = target && context.droppableRects.get(target.id);
    if (!rect || !context.collisionRect) return;
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
    <div aria-label="Task board" aria-busy={loading}>
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
              "Press Space to pick up a task, Left or Right to choose a column, Space to move, or Escape to cancel. Use the Move menu as an alternative.",
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
          aria-label="Board columns"
          tabIndex={0}
          onScroll={(event) =>
            onScrollPositionChange(event.currentTarget.scrollLeft)
          }
          className="min-w-0 snap-x snap-proximity overflow-x-auto overscroll-x-contain rounded-sm pb-6 outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <div className="grid grid-flow-col auto-cols-[18rem] gap-6">
            {columns.map((column, index) => {
              const items = columnTasks(tasks, displayBoard, column.id);
              return (
                <BoardColumn
                  key={column.id}
                  column={column}
                  count={items.length}
                  index={index - 1}
                  total={board.columns.length}
                  disabled={disabled}
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
                  {column.id === UNSECTIONED && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={onAdd}
                      className="task-add-button"
                    >
                      <Plus className="size-[18px]" strokeWidth={1.5} />
                      Add task
                    </Button>
                  )}
                </BoardColumn>
              );
            })}
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => openEditor({ id: "", name: "" })}
              className="h-11 w-full justify-start gap-2.5 self-start text-sm font-normal text-muted-foreground md:h-10"
            >
              <Plus className="size-[18px]" strokeWidth={1.5} />
              Add column
            </Button>
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
