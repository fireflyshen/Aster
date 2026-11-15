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
import { Switch } from "@/components/ui/switch";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TaskGroupBy } from "@/features/tasks/task-grouping";
import { Columns3, List, SlidersHorizontal } from "lucide-react";
import { useId } from "react";
import type { CompleteBehavior } from "../hooks/use-workspace-navigation";

/** One quiet display entry keeps view preferences out of the task content. */
export function WorkspaceDisplayOptions({
  disabled,
  groupBy,
  groupOptions,
  onGroupByChange,
  completeBehavior,
  onCompleteBehaviorChange,
  onReset,
}: {
  disabled: boolean;
  groupBy: TaskGroupBy;
  groupOptions: readonly { value: TaskGroupBy; label: string }[];
  onGroupByChange?: (value: TaskGroupBy) => void;
  completeBehavior: CompleteBehavior;
  onCompleteBehaviorChange?: (value: CompleteBehavior) => void;
  onReset?: () => void;
}) {
  const completedId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="显示选项"
          className="h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground data-[state=open]:bg-accent"
        >
          <SlidersHorizontal className="size-3.5" />
          显示
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 max-w-[calc(100vw-24px)] space-y-4 p-3"
        aria-label="任务显示选项"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">显示</span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              恢复默认
            </button>
          )}
        </div>
        <div className="space-y-2">
          <span className="text-[11px] text-muted-foreground">布局</span>
          <TabsList aria-label="布局模式" className="flex h-8 w-full">
            <TabsTrigger
              value="list"
              aria-label="列表视图"
              disabled={disabled}
              className="flex-1 gap-1.5 text-xs"
            >
              <List className="size-3.5" />
              列表
            </TabsTrigger>
            <TabsTrigger
              value="board"
              aria-label="看板视图"
              disabled={disabled}
              className="flex-1 gap-1.5 text-xs"
            >
              <Columns3 className="size-3.5" />
              看板
            </TabsTrigger>
          </TabsList>
        </div>
        {onGroupByChange && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">分组</span>
            <Select
              value={groupBy}
              onValueChange={(value) => onGroupByChange(value as TaskGroupBy)}
              disabled={disabled}
            >
              <SelectTrigger
                aria-label="分组方式"
                className="h-8 w-40 text-xs shadow-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groupOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {onCompleteBehaviorChange && (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <label
              htmlFor={completedId}
              className="cursor-pointer text-xs text-muted-foreground"
            >
              显示已完成
            </label>
            <Switch
              id={completedId}
              checked={completeBehavior === "strikethrough"}
              disabled={disabled}
              onCheckedChange={(value) =>
                onCompleteBehaviorChange(value ? "strikethrough" : "hide")
              }
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
