import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DatePicker } from "@/features/tasks/date-picker";
import { TaskCheckbox } from "@/features/tasks/task-checkbox";
import { PRIORITIES } from "@/features/tasks/task-constants";
import { dueLabel, toDueDay } from "@/features/tasks/task-date";
import { TaskMetaChips } from "@/features/tasks/task-meta-chips";
import { TaskRowMenu } from "@/features/tasks/task-row-menu";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { taskDate } from "@core/tasks/quick-task";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { addDays, format } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Flag,
  GripVertical,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Square,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

const SWIPE_EVENT = "aster:swipe-row";

export type TaskRowProps = {
  task: Task;
  completed: boolean;
  overdue: boolean;
  disabled: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onToggleStart?: () => void;
  onDueChange?: (due: string) => void;
  onPriorityChange?: (priority: "H" | "M" | "L" | "") => void;
  onSaveInline?: (
    input: TaskInput & { taskDescription?: string },
  ) => Promise<boolean>;
  onDelete?: () => void;
  projects?: string[];
  availableLabels?: SavedTag[];
  extraActions?: ReactNode;
  trackedSeconds?: number;
  timingUnavailable?: boolean;
  showProject?: boolean;
  variant?: "list" | "card";
  transition?: { checked: boolean; phase: "checking" | "leaving" };
  subtasks?: Task[];
  isSubtask?: boolean;
  depth?: number;
  description?: string;
  onAddSubtask?: (input: TaskInput) => Promise<boolean>;
  onUnlinkSubtask?: () => void;
  onToggleSubtask?: (subtask: Task, completed: boolean) => void;
  onEditSubtask?: (subtask: Task) => void;
  renderSubtask?: (subtask: Task) => ReactNode;
  expandSubtasks?: number;
};

/** Single task item rendered either as a List row or a Board card. */
export function TaskRow({
  task,
  completed,
  overdue,
  disabled,
  onEdit,
  onComplete,
  onToggleStart,
  onDueChange,
  onPriorityChange,
  onSaveInline,
  onDelete,
  projects = [],
  availableLabels = [],
  extraActions,
  trackedSeconds,
  timingUnavailable = false,
  showProject = true,
  transition,
  variant = "list",
  subtasks = [],
  isSubtask = false,
  description = "",
  onAddSubtask,
  onUnlinkSubtask,
  renderSubtask,
  expandSubtasks,
}: TaskRowProps) {
  const checked = transition?.checked ?? completed;
  const started = !!task.start && !checked;
  const dueDay = toDueDay(task.due);
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");

  const [editingInline, setEditingInline] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = useState(false);
  const [priorityChipOpen, setPriorityChipOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const rowRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (expandSubtasks !== undefined) setSubtasksExpanded(true);
  }, [expandSubtasks]);

  const totalSubtasks = subtasks.length;
  const completedSubtasks = subtasks.filter(
    (s) => s.status === "completed",
  ).length;

  const hasMoreMenu = Boolean(
    (!completed &&
      (onDueChange || onPriorityChange || onSaveInline || onAddSubtask)) ||
    isSubtask ||
    onDelete,
  );
  const hasRightActions = Boolean(
    (variant === "list" &&
      !completed &&
      (onSaveInline || onToggleStart || onDueChange || onPriorityChange)) ||
    hasMoreMenu ||
    (variant === "list" && extraActions),
  );
  const hasDetails = !!(
    (showProject && task.project) ||
    task.due ||
    task.recur ||
    task.annotations.length ||
    task.tags.length ||
    task.priority ||
    task.wait ||
    started ||
    (trackedSeconds ?? 0) > 0 ||
    totalSubtasks > 0
  );

  useEffect(() => {
    if (!drawerPinned) return;
    const onOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== task.uuid)
        setDrawerPinned(false);
    };
    const onPointerDownOutside = (event: globalThis.PointerEvent) => {
      if (
        rowRef.current &&
        event.target instanceof Node &&
        !rowRef.current.contains(event.target)
      ) {
        setDrawerPinned(false);
      }
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setDrawerPinned(false);
    };
    window.addEventListener(SWIPE_EVENT, onOther);
    window.addEventListener("pointerdown", onPointerDownOutside, true);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(SWIPE_EVENT, onOther);
      window.removeEventListener("pointerdown", onPointerDownOutside, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [drawerPinned, task.uuid]);

  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (disabled || variant !== "list" || editingInline) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return;
    if (event.deltaX > 18 && !drawerPinned) {
      window.dispatchEvent(new CustomEvent(SWIPE_EVENT, { detail: task.uuid }));
      setDrawerPinned(true);
    } else if (event.deltaX < -18 && drawerPinned) {
      setDrawerPinned(false);
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      disabled ||
      editingInline ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      document.querySelector(
        '[role="dialog"], [role="alertdialog"], [data-state="open"][data-slot="popover-content"]',
      )
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (
      key === "j" ||
      event.key === "ArrowDown" ||
      key === "k" ||
      event.key === "ArrowUp"
    ) {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-task-row] [data-task-drag-surface]:not(:disabled)",
        ),
      );
      const current = event.currentTarget.querySelector<HTMLElement>(
        "[data-task-drag-surface]",
      );
      const index = current ? rows.indexOf(current) : -1;
      if (index === -1) return;
      const nextIndex =
        key === "j" || event.key === "ArrowDown"
          ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index - 1);
      if (nextIndex !== index) {
        event.preventDefault();
        rows[nextIndex]?.focus();
      }
      return;
    }
    if (key === "e" && !completed && onSaveInline) {
      event.preventDefault();
      setEditingInline(true);
      return;
    }
    if (key === "x") {
      event.preventDefault();
      onComplete();
      return;
    }
    if (key === "s" && !completed && onToggleStart) {
      event.preventDefault();
      onToggleStart();
      return;
    }
    if (key === "t" && !completed && onDueChange) {
      event.preventDefault();
      onDueChange(dueDay === todayStr ? tomorrowStr : todayStr);
      return;
    }
    if (
      (key === "1" || key === "2" || key === "3" || key === "0") &&
      !completed &&
      onPriorityChange
    ) {
      event.preventDefault();
      const map: Record<string, "H" | "M" | "L" | ""> = {
        "1": "H",
        "2": "M",
        "3": "L",
        "0": "",
      };
      onPriorityChange(map[key]);
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && onDelete) {
      event.preventDefault();
      onDelete();
    }
  }

  const subtreeBlock = (totalSubtasks > 0 || isAddingSubtask) &&
    subtasksExpanded && (
      <div
        className="task-subtree"
        data-subtree-variant={variant}
        data-no-drag={variant === "card" ? "" : undefined}
      >
        {subtasks.map((child) => (
          <div key={child.uuid} className="relative">
            {renderSubtask ? renderSubtask(child) : null}
          </div>
        ))}
        {onAddSubtask && !completed && (
          <div className={variant === "card" ? "pt-1.5" : "pt-1"}>
            {isAddingSubtask ? (
              <TodoistTaskComposer
                mode="add"
                compact
                disabled={disabled}
                ariaLabel={`为“${task.description}”添加子任务`}
                placeholder="子任务名称（支持 @标签, 明天, p1）"
                defaultProject={task.project}
                projects={projects}
                availableLabels={availableLabels}
                onSubmitTask={(subtaskInput) =>
                  onAddSubtask({
                    ...subtaskInput,
                    project: subtaskInput.project || task.project,
                  })
                }
                onCancel={() => setIsAddingSubtask(false)}
              />
            ) : (
              <button
                type="button"
                data-no-drag
                onClick={() => {
                  setIsAddingSubtask(true);
                  setSubtasksExpanded(true);
                }}
                className="flex items-center gap-1.5 py-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-primary hover:bg-muted/50 rounded-md transition-colors cursor-pointer w-full text-left"
              >
                <Plus className="size-3.5 text-primary" />
                <span>添加子任务</span>
              </button>
            )}
          </div>
        )}
      </div>
    );

  if (editingInline && onSaveInline) {
    return (
      <article
        ref={rowRef}
        data-task-row
        className="task-row min-w-0 flex-1 py-1"
      >
        <TodoistTaskComposer
          mode="edit"
          compact={variant === "list"}
          disabled={disabled}
          ariaLabel={`编辑任务: ${task.description}`}
          placeholder="任务名称"
          initialDescription={description}
          initialValue={{
            description: task.description,
            project: task.project || "",
            priority: task.priority || "",
            tags: task.tags,
            due: dueDay ? toDueDay(task.due) : "",
            recur: task.recur,
            until: task.until ? taskDate(new Date(task.until)) : undefined,
            note: "",
          }}
          projects={projects}
          availableLabels={availableLabels}
          onSubmitTask={onSaveInline}
          onOpenFullEditor={() => {
            setEditingInline(false);
            onEdit();
          }}
          onCancel={() => setEditingInline(false)}
        />
        {subtreeBlock}
      </article>
    );
  }

  const actionsVisible =
    drawerPinned || moreOpen || priorityPopoverOpen || priorityChipOpen;

  return (
    <article
      ref={rowRef}
      data-task-row
      data-completion={transition?.phase}
      aria-busy={!!transition}
      onKeyDown={handleRowKeyDown}
      onWheel={handleWheel}
      className="task-row min-w-0 flex-1"
    >
      <div
        className={cn(
          "min-h-0",
          transition?.phase === "leaving" && "overflow-hidden",
        )}
      >
        <div
          data-task-surface
          data-variant={variant}
          className={cn(
            "group/row [&:has(:focus-visible)]:bg-(--row-hover)",
            variant === "list" &&
              "-mx-2.5 px-2.5 md:-mx-3 md:px-3 [.board-card_&]:mx-0 [.board-card_&]:px-0",
            actionsVisible && "bg-(--row-hover)",
          )}
        >
          <div className="flex items-start gap-2 md:gap-2.5 w-full min-w-0">
            {variant === "list" && (
              <div className="task-row-gutter flex items-center justify-center shrink-0 self-start mt-2 md:mt-1.5 gap-0.5">
                <div
                  data-drag-handle
                  className="size-5 flex items-center justify-center opacity-0 md:group-hover/row:opacity-45 hover:opacity-100! transition-opacity cursor-grab active:cursor-grabbing"
                  title="拖动以重新排序或缩进为子任务"
                >
                  <GripVertical className="size-3.5 text-muted-foreground" />
                </div>
                {totalSubtasks > 0 && (
                  <button
                    type="button"
                    data-no-drag
                    aria-expanded={subtasksExpanded}
                    aria-label={subtasksExpanded ? "收起子任务" : "展开子任务"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSubtasksExpanded((expanded) => !expanded);
                    }}
                    className="size-4.5 flex items-center justify-center rounded-sm text-muted-foreground/65 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 transition-transform duration-150",
                        subtasksExpanded && "rotate-90",
                      )}
                    />
                  </button>
                )}
              </div>
            )}

            <div className="task-row-check flex size-5 shrink-0 items-center justify-center self-start mt-2 md:mt-1.5">
              <TaskCheckbox
                id={`complete-${task.uuid}`}
                checked={checked}
                completed={completed}
                priority={task.priority}
                description={task.description}
                disabled={disabled}
                onComplete={onComplete}
              />
            </div>

            <div
              data-task-drag-surface=""
              tabIndex={0}
              role="group"
              aria-label={`任务: ${task.description}`}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  onEdit();
                }
              }}
              className="flex h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-start gap-0 self-start px-0 py-2 md:py-1.5 text-left font-normal outline-none focus-visible:ring-1 focus-visible:ring-ring/50 md:min-h-8"
            >
              <div
                role="button"
                tabIndex={-1}
                data-task-title
                onClick={onEdit}
                className={cn(
                  "block min-w-0 w-full text-[14px] leading-5 font-normal transition-colors duration-150 break-words cursor-pointer outline-none hover:text-foreground",
                  checked
                    ? "text-muted-foreground/60 line-through decoration-muted-foreground/50"
                    : "text-foreground",
                )}
              >
                {task.description}
              </div>

              {description && (
                <div
                  data-task-description-preview
                  onClick={(e) => {
                    if (window.getSelection()?.toString().length) {
                      e.stopPropagation();
                      return;
                    }
                    onEdit();
                  }}
                  className={cn(
                    "mt-0.5 block min-w-0 w-full text-xs leading-relaxed line-clamp-1 select-text whitespace-pre-wrap break-words cursor-pointer transition-colors",
                    checked
                      ? "text-muted-foreground/50 line-through decoration-muted-foreground/40"
                      : "text-muted-foreground/80 hover:text-foreground/85",
                  )}
                >
                  {description}
                </div>
              )}

              {hasDetails && (
                <TaskMetaChips
                  task={task}
                  variant={variant}
                  checked={checked}
                  overdue={overdue}
                  disabled={disabled}
                  showProject={showProject}
                  started={started}
                  timingUnavailable={timingUnavailable}
                  trackedSeconds={trackedSeconds}
                  availableLabels={availableLabels}
                  totalSubtasks={totalSubtasks}
                  completedSubtasks={completedSubtasks}
                  subtasksExpanded={subtasksExpanded}
                  priorityChipOpen={priorityChipOpen}
                  onPriorityChipOpenChange={setPriorityChipOpen}
                  onToggleSubtasks={() => setSubtasksExpanded((v) => !v)}
                  onEdit={onEdit}
                  onDueChange={onDueChange}
                  onPriorityChange={onPriorityChange}
                />
              )}
            </div>

            {hasRightActions && (
              <div
                data-no-drag
                data-row-actions
                data-actions-open={actionsVisible}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-0.5 self-start transition-opacity duration-150 md:mt-0.5",
                  actionsVisible
                    ? "opacity-100"
                    : "opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100",
                )}
              >
                {variant === "list" && extraActions}
                {variant === "list" && !completed && onSaveInline && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`行内编辑: ${task.description}`}
                    title="编辑 (E)"
                    onClick={() => setEditingInline(true)}
                    className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.6} />
                  </Button>
                )}
                {variant === "list" && !completed && onDueChange && (
                  <DatePicker
                    id={`due-${task.uuid}`}
                    value={dueDay}
                    disabled={disabled}
                    align="end"
                    ariaLabel={`截止日期: ${task.description}`}
                    onChange={onDueChange}
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={`设定截止日期: ${task.description}`}
                        title={
                          task.due
                            ? `截止 ${dueLabel(task.due)} — 更改日期`
                            : "设定日期 (T)"
                        }
                        className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                      >
                        <CalendarDays className="size-3.5" strokeWidth={1.6} />
                      </Button>
                    }
                  />
                )}
                {variant === "list" && !completed && onPriorityChange && (
                  <Popover
                    open={priorityPopoverOpen}
                    onOpenChange={setPriorityPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={`设置优先级: ${task.description}`}
                        title="设置优先级 (1-3 / 0)"
                        className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                      >
                        <Flag
                          className={cn(
                            "size-3.5",
                            task.priority === "H" &&
                              "fill-[#d1453b]/20 text-[#d1453b]",
                            task.priority === "M" &&
                              "fill-[#eb8909]/20 text-[#eb8909]",
                            task.priority === "L" &&
                              "fill-[#246fe0]/20 text-[#246fe0]",
                            !task.priority && "text-muted-foreground",
                          )}
                          strokeWidth={1.6}
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-36 p-1">
                      {PRIORITIES.map((item) => (
                        <Button
                          key={item.label}
                          type="button"
                          variant="navigation"
                          className="h-8 justify-between px-2 text-xs font-normal"
                          onClick={() => {
                            setPriorityPopoverOpen(false);
                            onPriorityChange(item.value);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Flag className={cn("size-3.5", item.iconClass)} />
                            <span>{item.label}</span>
                          </span>
                          {(task.priority || "") === item.value && (
                            <Check className="size-3 text-foreground" />
                          )}
                        </Button>
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
                {variant === "list" && !completed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`评论与详情: ${task.description}`}
                    title="评论与详情"
                    onClick={onEdit}
                    className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <MessageSquare className="size-3.5" strokeWidth={1.6} />
                  </Button>
                )}
                {variant === "list" && !completed && onToggleStart && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || (!started && timingUnavailable)}
                    aria-label={`${started ? "停止计时" : "开始计时"}: ${task.description}`}
                    title={
                      !started && timingUnavailable
                        ? "计时不可用"
                        : started
                          ? "停止计时 (S)"
                          : "开始计时 (S)"
                    }
                    onClick={onToggleStart}
                    className={cn(
                      "size-6 rounded-[4px] transition-colors hover:bg-accent",
                      started
                        ? "text-primary font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {started ? (
                      <Square className="size-3 fill-current" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </Button>
                )}
                {hasMoreMenu && (
                  <TaskRowMenu
                    task={task}
                    completed={completed}
                    disabled={disabled}
                    isSubtask={isSubtask}
                    open={moreOpen}
                    onOpenChange={setMoreOpen}
                    onInlineEdit={
                      onSaveInline ? () => setEditingInline(true) : undefined
                    }
                    onDueChange={onDueChange}
                    onPriorityChange={onPriorityChange}
                    onStartAddSubtask={
                      onAddSubtask
                        ? () => {
                            setSubtasksExpanded(true);
                            setIsAddingSubtask(true);
                          }
                        : undefined
                    }
                    onUnlinkSubtask={onUnlinkSubtask}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        {subtreeBlock}
      </div>
    </article>
  );
}
