import { LabelIcon } from "@/components/icons";
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
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { LabelsPicker } from "@/features/tasks/labels-picker";
import { ProjectPicker } from "@/features/tasks/project-picker";
import type { TriggerKind } from "@/features/tasks/quick-token-helpers";
import { PRIORITIES, priorityOption } from "@/features/tasks/task-constants";
import type { QuickToken } from "@core/tasks/quick-task";
import { itemColor, type SavedTag } from "@core/workspace/organization";
import { cn } from "cn";
import { ArrowUp, CircleHelp, Flag, ListPlus, X } from "lucide-react";

const CHIP_CLASS =
  "h-9 gap-1.5 md:h-7 rounded-[6px] border-input px-2 py-0 text-[12px] font-normal text-muted-foreground shadow-none has-[>svg]:px-2";

/** Renders inline `#project` or `@label` completion pills inside QuickAdd. */
export function QuickAddSuggestions({
  triggerKind,
  projectSuggestions,
  labelSuggestions,
  onApply,
}: {
  triggerKind: TriggerKind | null;
  projectSuggestions: string[];
  labelSuggestions: SavedTag[];
  onApply: (tokenText: string) => void;
}) {
  if (!projectSuggestions.length && !labelSuggestions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
      <span className="text-[11px] text-muted-foreground">
        {triggerKind === "#" ? "项目 (Tab 补全):" : "标签 (Tab 补全):"}
      </span>
      {projectSuggestions.map((name, idx) => (
        <Button
          key={name}
          type="button"
          variant={idx === 0 ? "secondary" : "ghost"}
          size="xs"
          className="h-6 gap-1 rounded-full px-2 text-xs font-normal"
          onClick={() => onApply(/\s/.test(name) ? `#"${name}"` : `#${name}`)}
        >
          <ProjectIcon name={name} className="size-3" />
          <span>{name}</span>
        </Button>
      ))}
      {labelSuggestions.map((label, idx) => (
        <Button
          key={label.id}
          type="button"
          variant={idx === 0 ? "secondary" : "ghost"}
          size="xs"
          className="h-6 gap-1 rounded-full px-2 text-xs font-normal"
          onClick={() => onApply(`@${label.name}`)}
        >
          <LabelIcon
            className="size-3"
            style={{ color: itemColor(label.color) }}
          />
          <span>{label.name}</span>
        </Button>
      ))}
    </div>
  );
}

/** Renders QuickAdd due date, priority, labels, and syntax-help controls. */
export function QuickAddOptionRow({
  locked,
  dueDay,
  dueToken,
  priorityValue,
  tags,
  availableLabels,
  hasParseErrors,
  onReturnFocus,
  onRestoreInput,
  onSetField,
  onIgnoreDue,
  onOpenFullEditor,
}: {
  locked: boolean;
  dueDay: string;
  dueToken?: QuickToken;
  priorityValue?: string;
  tags: string[];
  availableLabels: SavedTag[];
  hasParseErrors: boolean;
  onReturnFocus: () => void;
  onRestoreInput: (event: Event) => void;
  onSetField: (kind: QuickToken["kind"], expression: string) => void;
  onIgnoreDue: (tokenId: string) => void;
  onOpenFullEditor: () => void;
}) {
  const activePriority = priorityOption(priorityValue);
  return (
    <div
      data-quick-options
      className="mt-2.5 flex flex-wrap items-center gap-1.5"
    >
      <div
        className={
          "flex max-w-full" +
          (dueToken ? " rounded-[6px] border border-input" : "")
        }
      >
        <DatePicker
          returnFocus={onReturnFocus}
          id="quick-due"
          compact
          value={dueDay}
          label={dueToken?.label}
          disabled={locked}
          className={
            dueToken
              ? "h-[34px] rounded-r-none border-0 md:h-[26px]"
              : undefined
          }
          onChange={(value) => onSetField("due", value)}
        />
        {dueToken && (
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            aria-label="保留日期文本"
            className="h-[34px] w-8 rounded-l-none p-0 text-muted-foreground md:h-[26px] md:w-6"
            onClick={() => {
              onIgnoreDue(dueToken.id);
              onReturnFocus();
            }}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <Select
        disabled={locked}
        value={activePriority.selectValue}
        onValueChange={(v) =>
          onSetField("priority", priorityOption(v).quickWord)
        }
      >
        <SelectTrigger
          aria-label="优先级"
          className={cn(
            CHIP_CLASS,
            "w-auto gap-1.5 data-[size=default]:h-9 md:data-[size=default]:h-7 [&>svg:last-child]:hidden",
            activePriority.chipClass,
          )}
        >
          <Flag className={cn("size-3.5", activePriority.iconClass)} />
          <SelectValue>{activePriority.short}</SelectValue>
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={onRestoreInput}>
          {PRIORITIES.map((p) => (
            <SelectItem key={p.selectValue} value={p.selectValue}>
              <span className="flex items-center gap-2">
                <Flag className={cn("size-3.5", p.iconClass)} />
                <span>{p.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <LabelsPicker
        compact
        id="quick-tags"
        value={tags}
        choices={availableLabels}
        disabled={locked}
        returnFocus={onReturnFocus}
        onChange={(nextTags) =>
          onSetField("tag", nextTags.map((t) => "@" + t).join(" "))
        }
      />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={locked}
            aria-label="快捷语法帮助"
            className="size-8 shrink-0 p-0 text-muted-foreground md:size-7"
          >
            <CircleHelp className="size-4" strokeWidth={1.5} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={12}
          className="w-72 space-y-2.5 p-3 text-xs leading-6"
          onCloseAutoFocus={onRestoreInput}
        >
          <Button
            type="button"
            variant="ghost"
            disabled={locked || hasParseErrors}
            className="h-8 w-full justify-start px-2 text-[13px] font-normal"
            onClick={onOpenFullEditor}
          >
            <ListPlus className="size-4" />
            打开完整编辑窗口 (⌘E)
          </Button>
          <p className="border-t pt-2 text-muted-foreground">
            示例：提交周报 明天 #Work @Focus p1
            <br />
            回车添加 · Tab 自动补全 · ⌘E 完整编辑
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Renders QuickAdd project selector, cancel, and submit buttons. */
export function QuickAddFooter({
  project,
  projects,
  busy,
  locked,
  hasText,
  onReturnFocus,
  onProjectChange,
  onClose,
}: {
  project: string;
  projects: string[];
  busy: boolean;
  locked: boolean;
  hasText: boolean;
  onReturnFocus: () => void;
  onProjectChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      data-quick-attributes
      className="flex items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2.5"
    >
      <div className="min-w-0">
        <ProjectPicker
          returnFocus={onReturnFocus}
          id="quick-project"
          compact
          value={project}
          projects={projects}
          disabled={locked}
          onChange={onProjectChange}
        />
      </div>
      <div data-quick-actions className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label="关闭快速添加"
          onClick={onClose}
          className="size-8 rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" strokeWidth={1.75} />
        </Button>
        <Button
          type="submit"
          size="icon-sm"
          disabled={locked || !hasText}
          aria-label="添加任务"
          className="size-8 rounded-[7px] bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary/90"
        >
          {busy ? (
            <Spinner className="size-4" />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2.2} />
          )}
        </Button>
      </div>
    </div>
  );
}
