import type { BoardColumn as Column } from "@core/workspace/board";
import { useDraggable } from "@dnd-kit/core";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { useCallback, type ReactNode } from "react";

type BoardCardProps = {
  task: Task;
  column: Column;
  disabled: boolean;
  saving?: boolean;
  compact?: boolean;
  isSubtask?: boolean;
  interactive?: boolean;
  children: ReactNode;
};

/** Draggable card or list row wrapper with Todoist-matched placeholder slot while dragging. */
export function BoardCard({
  task,
  column,
  disabled,
  saving,
  children,
  compact,
  isSubtask = false,
  interactive = true,
}: BoardCardProps) {
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
      onKeyDown={(event) => {
        if (
          (event.target as Element).closest("[data-task-card]") ===
          event.currentTarget
        ) {
          listeners?.onKeyDown?.(event);
        }
      }}
      onPointerDown={(event) => {
        // Prevent child subtask drag from starting a drag on the ancestor card.
        const target = event.target as Element | null;
        if (!target) return;
        const nearestCard = target.closest("[data-task-card]");
        if (nearestCard && nearestCard !== event.currentTarget) {
          return;
        }
        listeners?.onPointerDown?.(event);
      }}
      className={cn(
        "board-card group/card relative [&:has(:focus-visible)]:bg-(--row-hover)",
        compact
          ? isSubtask
            ? "flex min-w-0 items-start shadow-none"
            : "-mx-2.5 flex min-w-0 items-start px-2.5 shadow-none md:-mx-3 md:px-3"
          : "task-board-card cursor-grab bg-card transition-[box-shadow,border-color,background-color] duration-150 active:cursor-grabbing",
        isDragging &&
          (compact
            ? "rounded-md bg-(--drag-cavity-compact) [&>*]:opacity-0"
            : "border-transparent! bg-(--drag-cavity)! shadow-none! [&>*]:opacity-0"),
      )}
    >
      {children}
    </div>
  );
}
