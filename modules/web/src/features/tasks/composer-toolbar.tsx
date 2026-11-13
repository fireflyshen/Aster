import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { DatePicker } from "@/features/tasks/date-picker";
import { LabelsPicker } from "@/features/tasks/labels-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import { PRIORITIES, priorityOption } from "@/features/tasks/task-constants";
import type { QuickToken } from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import { cn } from "cn";
import {
  CalendarDays,
  Check,
  CornerDownLeft,
  Flag,
  Hash,
  ListPlus,
  Tag,
  X,
} from "lucide-react";

type ComposerTokenBarProps = {
  tokens: QuickToken[];
  onRemoveToken: (token: QuickToken) => void;
};

/** Displays parsed inline smart tokens (`due`, `priority`, `project`, `tag`) with remove buttons. */
export function ComposerTokenBar({
  tokens,
  onRemoveToken,
}: ComposerTokenBarProps) {
  if (tokens.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[11px]">
      {tokens.map((token) => (
        <span
          key={token.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors",
            token.kind === "due" && "bg-(--due-today)/12 text-(--due-today)",
            token.kind === "priority" &&
              "bg-(--priority-1)/12 text-(--priority-1)",
            token.kind === "project" &&
              "bg-(--priority-3)/12 text-(--priority-3)",
            token.kind === "tag" &&
              "bg-(--due-upcoming)/12 text-(--due-upcoming)",
          )}
        >
          {token.kind === "due" && <CalendarDays className="size-3" />}
          {token.kind === "priority" && <Flag className="size-3" />}
          {token.kind === "project" && <Hash className="size-3" />}
          {token.kind === "tag" && <Tag className="size-3" />}
          <span>{token.label}</span>
          <button
            type="button"
            onClick={() => onRemoveToken(token)}
            title={`移除 ${token.label}`}
            className="hover:text-destructive"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

type ComposerToolbarProps = {
  mode: "add" | "edit";
  disabled: boolean;
  submitting: boolean;
  canSubmit: boolean;
  activeDueDay: string;
  activePriority: "H" | "M" | "L" | "";
  activeProject: string;
  activeTags: string[];
  projects: string[];
  availableLabels: SavedTag[];
  priorityOpen: boolean;
  onPriorityOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  onDueChange: (day: string) => void;
  onPriorityChange: (priority: "H" | "M" | "L" | "", quickWord: string) => void;
  onTagsChange: (tags: string[]) => void;
  onProjectChange: (project: string) => void;
  onOpenFullEditor?: () => void;
  onCancel: () => void;
};

/** Renders composer metadata pickers (date, priority, labels, project) and cancel/submit actions. */
export function ComposerToolbar({
  mode,
  disabled,
  submitting,
  canSubmit,
  activeDueDay,
  activePriority,
  activeProject,
  activeTags,
  projects,
  availableLabels,
  priorityOpen,
  onPriorityOpenChange,
  onReturnFocus,
  onDueChange,
  onPriorityChange,
  onTagsChange,
  onProjectChange,
  onOpenFullEditor,
  onCancel,
}: ComposerToolbarProps) {
  const locked = disabled || submitting;
  const activePriorityItem = priorityOption(activePriority);

  return (
    <div className="task-composer-toolbar mt-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <DatePicker
          id={`composer-due-${mode}`}
          compact
          value={activeDueDay}
          disabled={locked}
          returnFocus={onReturnFocus}
          onChange={onDueChange}
        />

        <Popover open={priorityOpen} onOpenChange={onPriorityOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              aria-label="优先级"
              className={cn(
                "h-8 gap-1.5 rounded-[6px] px-2 py-0 text-[12px] font-normal shadow-none has-[>svg]:px-2 md:h-7",
                activePriorityItem.chipClass,
              )}
            >
              <Flag
                className={cn(
                  "size-3.5 shrink-0",
                  activePriorityItem.iconClass,
                )}
              />
              <span>{activePriorityItem.short}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-40 p-1"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              onReturnFocus();
            }}
          >
            {PRIORITIES.map((item) => (
              <Button
                key={item.label}
                type="button"
                variant="navigation"
                className="h-8 justify-between px-2 text-xs font-normal"
                onClick={() => {
                  onPriorityOpenChange(false);
                  onPriorityChange(item.value, item.quickWord);
                }}
              >
                <span className="flex items-center gap-2">
                  <Flag className={cn("size-3.5", item.iconClass)} />
                  <span>{item.label}</span>
                </span>
                {activePriority === item.value && (
                  <Check className="size-3.5 text-foreground" />
                )}
              </Button>
            ))}
          </PopoverContent>
        </Popover>

        {availableLabels.length > 0 && (
          <LabelsPicker
            id={`composer-tags-${mode}`}
            compact
            value={activeTags}
            choices={availableLabels}
            disabled={locked}
            returnFocus={onReturnFocus}
            onChange={onTagsChange}
          />
        )}

        {projects.length > 0 && (
          <ProjectPicker
            id={`composer-project-${mode}`}
            compact
            value={activeProject}
            projects={projects}
            disabled={locked}
            returnFocus={onReturnFocus}
            onChange={onProjectChange}
          />
        )}

        {onOpenFullEditor && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={locked}
            title="打开完整任务编辑 (⌘E)"
            aria-label="打开完整任务编辑"
            onClick={onOpenFullEditor}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <ListPlus className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="task-composer-actions ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={submitting}
          aria-label={mode === "edit" ? "取消编辑任务" : "取消添加任务"}
          onClick={onCancel}
          className="h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium"
        >
          <X className={cn("size-3.5", mode !== "edit" && "sm:hidden")} />
          {mode !== "edit" && <span className="hidden sm:inline">取消</span>}
        </Button>
        <Button
          type="submit"
          size="xs"
          disabled={locked || !canSubmit}
          aria-label={mode === "edit" ? "保存任务" : "添加任务"}
          className="h-8 cursor-pointer gap-1 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-45"
        >
          {submitting ? (
            <Spinner className="size-3" />
          ) : mode === "edit" ? (
            <Check className="size-4" />
          ) : (
            <>
              添加任务
              <CornerDownLeft className="size-3 opacity-75" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
