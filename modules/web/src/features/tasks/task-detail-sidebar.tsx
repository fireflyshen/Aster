import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { recurrenceLabel } from "@core/tasks/recurrence";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { Ellipsis, Flag, Play, Plus, Square, Trash2, X } from "lucide-react";
import { DatePicker } from "./date-picker";
import { LabelsPicker } from "./labels-picker";
import { ProjectPicker } from "./project-picker";
import { RepeatEnd, RepeatSelect } from "./repeat-fields";
import { PRIORITIES, priorityOption } from "./task-constants";

type TaskDetailSidebarProps = {
  draft: TaskInput;
  projects: string[];
  due: string;
  tags: string;
  availableLabels: SavedTag[];
  editing?: Task;
  disabled: boolean;
  timingActive?: boolean;
  timingUnavailable?: boolean;
  onToggleStart?: () => void;
  onClearStartMark?: () => void;
  onDraftChange: (draft: TaskInput) => void;
  onDueChange: (due: string) => void;
  onTagsChange: (tags: string) => void;
  onClearError: () => void;
  onEditSeries: (uuid: string) => void;
  onDelete: () => void;
};

/** Right-hand property rail of the Todoist-aligned task detail modal. */
export function TaskDetailSidebar({
  draft,
  projects,
  due,
  tags,
  availableLabels,
  editing,
  disabled,
  timingActive: timingActiveProp,
  timingUnavailable = false,
  onToggleStart,
  onClearStartMark,
  onDraftChange,
  onDueChange,
  onTagsChange,
  onClearError,
  onEditSeries,
  onDelete,
}: TaskDetailSidebarProps) {
  const tagList = tags
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const labelColorMap = new Map(
    availableLabels.map((item) => [item.name, itemColor(item.color)]),
  );
  const currentPriority = priorityOption(draft.priority || "");
  const isStarted = Boolean(editing?.start) && editing?.status !== "completed";
  const isTimingActive = timingActiveProp ?? isStarted;

  return (
    <aside className="task-detail-aside" aria-label="任务属性">
      {editing && editing.status !== "completed" && onToggleStart && (
        <div className="task-detail-properties">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label className="text-xs leading-4 font-medium text-muted-foreground">
              进行状态
            </Label>
            <Button
              type="button"
              variant={isTimingActive ? "secondary" : "outline"}
              disabled={disabled || (!isTimingActive && timingUnavailable)}
              onClick={onToggleStart}
              className={cn(
                "h-9 w-full justify-start gap-2 px-2.5 text-xs shadow-none",
                isTimingActive
                  ? "border border-primary/25 bg-primary/8 font-medium text-foreground hover:bg-primary/14"
                  : isStarted
                    ? "border border-border bg-muted/40 font-medium text-foreground hover:bg-(--navigation-hover)"
                    : "border-border/80 bg-transparent font-normal text-foreground hover:bg-(--navigation-hover)",
              )}
            >
              {isTimingActive ? (
                <>
                  <Square className="size-3 shrink-0 fill-current text-primary" />
                  <span>正在计时中（停止计时）</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    {timingUnavailable
                      ? "计时不可用"
                      : isStarted
                        ? "切换为此任务计时"
                        : "设为正在进行（开始计时）"}
                  </span>
                </>
              )}
            </Button>
            {isStarted && !isTimingActive && onClearStartMark && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onClearStartMark}
                className="h-7 justify-start gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5 shrink-0" />
                <span>清除进行中标记</span>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="task-detail-properties">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label
            htmlFor="edit-project"
            className="text-xs leading-4 font-medium text-muted-foreground"
          >
            项目
          </Label>
          <ProjectPicker
            compact
            value={draft.project || ""}
            projects={projects}
            onChange={(project) => {
              onDraftChange({ ...draft, project });
              onClearError();
            }}
            disabled={disabled}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label
            htmlFor="due"
            className="text-xs leading-4 font-medium text-muted-foreground"
          >
            日期
          </Label>
          <DatePicker
            value={due}
            onChange={(value) => {
              onDueChange(value);
              onClearError();
            }}
            disabled={disabled}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label
            htmlFor="priority"
            className="text-xs leading-4 font-medium text-muted-foreground"
          >
            优先级
          </Label>
          <Select
            disabled={disabled}
            value={draft.priority || "none"}
            onValueChange={(value) => {
              onDraftChange({
                ...draft,
                priority: value === "none" ? "" : value,
              });
              onClearError();
            }}
          >
            <SelectTrigger
              id="priority"
              className="h-9 min-h-9 w-full border-0 bg-transparent px-1.5 text-sm shadow-none hover:bg-(--navigation-hover)"
            >
              <SelectValue>
                <span className="flex items-center gap-2">
                  <Flag className={cn("size-4", currentPriority.iconClass)} />
                  <span>{currentPriority.quickWord.toUpperCase()}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((item) => (
                <SelectItem key={item.selectValue} value={item.selectValue}>
                  <span className="flex items-center gap-2">
                    <Flag className={cn("size-3.5", item.iconClass)} />
                    <span>{item.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="task-detail-properties">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="tags"
              className="text-xs leading-4 font-medium text-muted-foreground"
            >
              标签
            </Label>
            <LabelsPicker
              id="tags"
              value={tagList}
              choices={availableLabels}
              disabled={disabled}
              trigger={
                <Button
                  id="tags"
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="编辑标签"
                  disabled={disabled}
                  className="task-detail-label-add size-6 rounded text-muted-foreground hover:bg-(--navigation-hover) hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </Button>
              }
              onChange={(nextTags) => {
                onTagsChange(nextTags.join(", "));
                onClearError();
              }}
            />
          </div>

          {tagList.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tagList.map((tag) => {
                const color = labelColorMap.get(tag);
                return (
                  <span
                    key={tag}
                    className="task-detail-label-chip inline-flex max-w-full items-center gap-1 rounded-[6px] border border-border/80 bg-(--navigation-hover)/60 px-2 py-0.5 text-xs text-foreground"
                  >
                    <LabelIcon
                      className="size-3 shrink-0"
                      style={color ? { color } : undefined}
                    />
                    <span className="truncate">{tag}</span>
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`移除标签 ${tag}`}
                        onClick={() => {
                          onTagsChange(
                            tagList.filter((item) => item !== tag).join(", "),
                          );
                          onClearError();
                        }}
                        className="task-detail-label-remove ml-0.5 cursor-pointer rounded-xs text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">暂无标签</p>
          )}
        </div>
      </div>

      <div className="task-detail-properties">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label
            htmlFor="repeat"
            className="text-xs leading-4 font-medium text-muted-foreground"
          >
            重复
          </Label>
          {editing?.parent ? (
            <div className="flex min-h-9 items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {recurrenceLabel(editing.recur || "Repeating")}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-8 px-0 text-xs"
                disabled={disabled}
                onClick={() => onEditSeries(editing.parent!)}
              >
                编辑系列
              </Button>
            </div>
          ) : (
            <RepeatSelect
              value={draft.recur || ""}
              disabled={disabled}
              onChange={(recur) => {
                onDraftChange({
                  ...draft,
                  recur,
                  until: recur ? draft.until : "",
                });
                onClearError();
              }}
            />
          )}
        </div>
        {!!draft.recur && !editing?.parent && (
          <RepeatEnd
            value={draft.until || ""}
            disabled={disabled}
            onChange={(until) => {
              onDraftChange({ ...draft, until });
              onClearError();
            }}
          />
        )}
      </div>

      {editing && (
        <div className="pt-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="更多任务操作"
                className="task-detail-more text-muted-foreground hover:text-foreground"
              >
                <Ellipsis className="size-4" /> 更多
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => onDelete()}
                className="h-8 w-full justify-start gap-2 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                删除任务
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </aside>
  );
}
