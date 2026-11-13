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
import { Ellipsis, Flag, Plus, Trash2, X } from "lucide-react";
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

  return (
    <aside className="task-detail-aside" aria-label="任务属性">
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
                  className="size-6 rounded text-muted-foreground hover:bg-(--navigation-hover) hover:text-foreground"
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
                    className="inline-flex max-w-full items-center gap-1 rounded-[6px] border border-border/80 bg-(--navigation-hover)/60 px-2 py-0.5 text-xs text-foreground"
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
                        className="ml-0.5 cursor-pointer rounded-xs text-muted-foreground hover:text-foreground"
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
