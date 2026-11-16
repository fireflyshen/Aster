import { Button } from "@/components/ui/button";
import { CountMenuTrigger } from "@/components/count-menu-trigger";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Check,
  Ellipsis,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

export function ProjectActions({
  name,
  disabled,
  onEdit,
  onDelete,
  status,
  onStatus,
  canFocus = true,
  onAddChild,
  compact = false,
  count,
}: {
  name: string;
  compact?: boolean;
  count?: number;
  onAddChild?: (name: string) => void;
  status?: import("@core/workspace/focus").ProjectStatus;
  onStatus?: (
    name: string,
    status: import("@core/workspace/focus").ProjectStatus,
  ) => void;
  canFocus?: boolean;
  disabled: boolean;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <CountMenuTrigger
            count={count}
            disabled={disabled}
            aria-label={`Project options: ${name}`}
            title={name}
          />
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Project options: ${name}`}
            className="shrink-0 text-muted-foreground md:opacity-0 md:transition-opacity md:group-hover/project:opacity-100 md:group-focus-within/project:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100"
          >
            <Ellipsis className="size-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-48 p-1"
        onCloseAutoFocus={(event) => {
          if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
            event.preventDefault();
        }}
      >
        {onStatus && (
          <>
            {canFocus && (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start font-normal"
                onClick={() => {
                  setOpen(false);
                  onStatus(name, status === "active" ? "later" : "active");
                }}
              >
                {status === "active" ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
                {status === "active" ? "移至稍后" : "设为焦点"}
              </Button>
            )}
            {status !== "completed" && (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start font-normal"
                onClick={() => {
                  setOpen(false);
                  onStatus(name, "completed");
                }}
              >
                <Check className="size-4" />
                完成项目
              </Button>
            )}
          </>
        )}
        {onAddChild && (
          <Button
            variant="ghost"
            className="h-9 w-full justify-start font-normal"
            onClick={() => {
              setOpen(false);
              onAddChild(name);
            }}
          >
            <Plus className="size-4" />
            添加子项目
          </Button>
        )}
        <Button
          variant="ghost"
          className="h-9 w-full justify-start font-normal"
          onClick={() => {
            setOpen(false);
            onEdit(name);
          }}
        >
          <Pencil className="size-4" />
          编辑项目
        </Button>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start font-normal text-destructive"
          onClick={() => {
            setOpen(false);
            onDelete(name);
          }}
        >
          <Trash2 className="size-4" />
          删除项目
        </Button>
      </PopoverContent>
    </Popover>
  );
}
