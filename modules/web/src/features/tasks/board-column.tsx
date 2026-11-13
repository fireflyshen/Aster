import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UNSECTIONED, type BoardColumn as Column } from "@core/workspace/board";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "cn";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Ellipsis,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { columnDisplayName } from "./board-helpers";

type BoardColumnProps = {
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
};

/** Droppable board column or collapsible list section container. */
export function BoardColumn({
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
}: BoardColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: { kind: "column", columnId: column.id },
    disabled,
  });
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const title = columnDisplayName(column);

  return (
    <section
      ref={setNodeRef}
      data-board-column={column.id}
      aria-label={`${title} 列`}
      className={cn(
        "group/column min-w-0 snap-start rounded-lg transition-colors",
        compact
          ? "pb-0"
          : "flex min-h-[calc(100vh-220px)] w-full flex-col pb-4",
      )}
    >
      {showHeader && (
        <div
          data-list-section={compact}
          className={cn(
            "flex items-center gap-2",
            compact
              ? "mb-0.5 h-10 border-b border-border/80"
              : "mb-2 h-9 px-0.5",
          )}
        >
          {compact ? (
            <div className="flex w-full items-center justify-between gap-2">
              <button
                type="button"
                aria-label={`${collapsed ? "展开" : "收起"}分组: ${title}`}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((prev) => !prev)}
                className="task-section-toggle flex min-w-0 items-center gap-1.5 rounded-md py-1 text-left transition-colors select-none hover:bg-(--row-hover)"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                    !collapsed && "rotate-90",
                  )}
                />
                <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
                  {title}
                </h2>
                <span className="ml-0.5 text-xs font-normal tabular-nums text-muted-foreground/75">
                  {count}
                </span>
              </button>
              <div className="flex-1" />
              {column.id !== UNSECTIONED && (
                <ColumnMenu
                  compact
                  title={title}
                  index={index}
                  total={total}
                  disabled={disabled}
                  open={menu}
                  onOpenChange={setMenu}
                  onEdit={onEdit}
                  onShift={onShift}
                  onDelete={onDelete}
                />
              )}
            </div>
          ) : (
            <>
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {title}
              </h2>
              <span className="text-xs font-normal tabular-nums text-muted-foreground/75">
                {count}
              </span>
              {column.id !== UNSECTIONED && (
                <ColumnMenu
                  compact={false}
                  title={title}
                  index={index}
                  total={total}
                  disabled={disabled}
                  open={menu}
                  onOpenChange={setMenu}
                  onEdit={onEdit}
                  onShift={onShift}
                  onDelete={onDelete}
                />
              )}
            </>
          )}
        </div>
      )}
      <div
        data-drop-content
        hidden={compact && showHeader && collapsed}
        className={
          compact ? "min-h-7" : "flex min-h-64 flex-1 flex-col space-y-2.5"
        }
      >
        {children}
      </div>
    </section>
  );
}

function ColumnMenu({
  compact,
  title,
  index,
  total,
  disabled,
  open,
  onOpenChange,
  onEdit,
  onShift,
  onDelete,
}: {
  compact: boolean;
  title?: string;
  index: number;
  total: number;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onShift: (direction: "left" | "right") => void;
  onDelete: () => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={compact ? `分区选项: ${title}` : `列选项: ${title}`}
          disabled={disabled}
          className={cn(
            "text-muted-foreground transition-opacity hover:text-foreground md:opacity-0 md:group-hover/column:opacity-100 md:group-focus-within/column:opacity-100 data-[state=open]:opacity-100",
            compact ? "size-7" : "ml-auto",
          )}
        >
          <Ellipsis className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <Button
          variant="navigation"
          className="h-8 text-xs"
          onClick={() => {
            onOpenChange(false);
            onEdit();
          }}
        >
          <Pencil className="size-3.5" />
          {compact ? "重命名分区" : "重命名"}
        </Button>
        <Button
          variant="navigation"
          className="h-8 text-xs"
          disabled={index === 0}
          onClick={() => {
            onOpenChange(false);
            onShift("left");
          }}
        >
          {compact ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowLeft className="size-3.5" />
          )}
          {compact ? "向上移动" : "向左移动"}
        </Button>
        <Button
          variant="navigation"
          className="h-8 text-xs"
          disabled={index === total - 1}
          onClick={() => {
            onOpenChange(false);
            onShift("right");
          }}
        >
          {compact ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowRight className="size-3.5" />
          )}
          {compact ? "向下移动" : "向右移动"}
        </Button>
        <Button
          variant="navigation"
          className="h-8 text-xs text-destructive hover:text-destructive"
          onClick={() => {
            onOpenChange(false);
            onDelete();
          }}
        >
          <Trash2 className="size-3.5" />
          {compact ? "删除分区" : "删除列"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
