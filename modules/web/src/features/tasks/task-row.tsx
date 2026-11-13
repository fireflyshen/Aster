import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectIcon } from "@/features/projects/project-icon";
import { DatePicker } from "@/features/tasks/date-picker";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { taskDate } from "@core/tasks/quick-task";
import { formatDuration } from "@core/workspace/energy";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { addDays, format, nextMonday, nextSaturday } from "date-fns";
import {
  Armchair,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CornerDownRight,
  Ellipsis,
  Flag,
  GripVertical,
  ListPlus,
  ListTree,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Square,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

const isoDue = (value: string) =>
  value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  );

function dueLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day =
    +local === +today
      ? "今天"
      : +local === +tomorrow
        ? "明天"
        : format(date, "M月d日");
  return (
    day +
    (date.getHours() || date.getMinutes()
      ? ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : "")
  );
}

const PRIORITIES = [
  {
    value: "H" as const,
    label: "优先级 1",
    short: "P1",
    iconClass: "fill-[#d1453b]/20 text-[#d1453b]",
    color: "#d1453b",
  },
  {
    value: "M" as const,
    label: "优先级 2",
    short: "P2",
    iconClass: "fill-[#eb8909]/20 text-[#eb8909]",
    color: "#eb8909",
  },
  {
    value: "L" as const,
    label: "优先级 3",
    short: "P3",
    iconClass: "fill-[#246fe0]/20 text-[#246fe0]",
    color: "#246fe0",
  },
  {
    value: "" as const,
    label: "优先级 4",
    short: "无",
    iconClass: "text-[#888888]",
    color: "#666666",
  },
];

const SWIPE_EVENT = "aster:swipe-row";

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
  depth = 0,
  description = "",
  onAddSubtask,
  onUnlinkSubtask,
  onToggleSubtask,
  onEditSubtask,
  renderSubtask,
  expandSubtasks,
}: {
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
}) {
  const checked = transition?.checked ?? completed;
  const started = !!task.start && !checked;
  const dueDay = task.due
    ? format(new Date(isoDue(task.due)), "yyyy-MM-dd")
    : "";
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");
  const weekendStr = format(nextSaturday(now), "yyyy-MM-dd");
  const nextWeekStr = format(nextMonday(now), "yyyy-MM-dd");
  const isDueToday = dueDay === todayStr;
  const isDueTomorrow = dueDay === tomorrowStr;

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
    !completed &&
      (onDueChange || onPriorityChange || onSaveInline || onAddSubtask)
      ? true
      : isSubtask || onDelete,
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
    description ||
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
      const custom = event as CustomEvent<string>;
      if (custom.detail !== task.uuid) setDrawerPinned(false);
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
    )
      return;
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
      onDueChange(isDueToday ? tomorrowStr : todayStr);
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
          ariaLabel={`Edit task: ${task.description}`}
          placeholder="Task name"
          initialDescription={description}
          initialValue={{
            description: task.description,
            project: task.project || "",
            priority: task.priority || "",
            tags: task.tags,
            due: task.due ? isoDue(task.due) : "",
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
        {subtasksExpanded && subtasks.length > 0 && (
          <div
            className="task-subtree"
            data-subtree-variant={variant}
            data-no-drag={variant === "card" ? "" : undefined}
          >
            {subtasks.map((child) => (
              <div key={child.uuid}>{renderSubtask?.(child)}</div>
            ))}
          </div>
        )}
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
            {/* Left Gutter: Drag handles in list view & chevron for tasks with subtasks */}
            {variant === "list" && (
              <div className="task-row-gutter flex items-center justify-center shrink-0 self-start mt-2 md:mt-1.5 gap-0.5">
                <div
                  data-drag-handle
                  className="size-5 flex items-center justify-center opacity-0 md:group-hover/row:opacity-40 hover:opacity-100! transition-opacity cursor-grab active:cursor-grabbing"
                  title="拖动以重新排序"
                >
                  <GripVertical className="size-3 text-muted-foreground" />
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
                    className="size-4.5 flex items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
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

            {/* Checkbox */}
            <div className="task-row-check flex size-5 shrink-0 items-center justify-center self-start mt-2 md:mt-1.5">
              <Label
                htmlFor={`complete-${task.uuid}`}
                className={cn(
                  "task-check-target group/check relative flex size-[18px] items-center justify-center",
                  disabled ? "cursor-default" : "cursor-pointer",
                )}
              >
                <Checkbox
                  id={`complete-${task.uuid}`}
                  checked={checked}
                  disabled={disabled}
                  aria-label={`${completed ? "Reopen" : "Complete"}: ${task.description}`}
                  onCheckedChange={onComplete}
                  className={cn(
                    "task-complete size-[18px] rounded-full shadow-none transition-all duration-150 focus-visible:ring-1 disabled:opacity-100 cursor-pointer",
                    !checked &&
                      !task.priority &&
                      "border-[2px] border-[#666666] bg-transparent enabled:hover:border-[#888888]",
                    !checked &&
                      task.priority === "H" &&
                      "border-[2px] border-[#d1453b] bg-[#d1453b]/10 enabled:hover:border-[#d1453b] enabled:hover:bg-[#d1453b]/20",
                    !checked &&
                      task.priority === "M" &&
                      "border-[2px] border-[#eb8909] bg-[#eb8909]/10 enabled:hover:border-[#eb8909] enabled:hover:bg-[#eb8909]/20",
                    !checked &&
                      task.priority === "L" &&
                      "border-[2px] border-[#246fe0] bg-[#246fe0]/10 enabled:hover:border-[#246fe0] enabled:hover:bg-[#246fe0]/20",
                    checked &&
                      task.priority === "H" &&
                      "border-[2px] border-[#d1453b] bg-[#d1453b] text-white data-[state=checked]:border-[#d1453b] data-[state=checked]:bg-[#d1453b] data-[state=checked]:text-white",
                    checked &&
                      task.priority === "M" &&
                      "border-[2px] border-[#eb8909] bg-[#eb8909] text-white data-[state=checked]:border-[#eb8909] data-[state=checked]:bg-[#eb8909] data-[state=checked]:text-white",
                    checked &&
                      task.priority === "L" &&
                      "border-[2px] border-[#246fe0] bg-[#246fe0] text-white data-[state=checked]:border-[#246fe0] data-[state=checked]:bg-[#246fe0] data-[state=checked]:text-white",
                    checked &&
                      !task.priority &&
                      "border-[2px] border-[#888888] bg-[#888888] text-white data-[state=checked]:border-[#888888] data-[state=checked]:bg-[#888888] data-[state=checked]:text-white",
                  )}
                />
                {!checked && !disabled && (
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "task-check-preview pointer-events-none absolute inset-0 m-auto size-3 opacity-0 transition-opacity duration-150 group-hover/check:opacity-80",
                      task.priority === "H"
                        ? "text-[#d1453b]"
                        : task.priority === "M"
                          ? "text-[#eb8909]"
                          : task.priority === "L"
                            ? "text-[#246fe0]"
                            : "text-[#888888]",
                    )}
                  />
                )}
              </Label>
            </div>
            <div
              data-task-drag-surface=""
              tabIndex={0}
              role="group"
              aria-label={`Task: ${task.description}`}
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
                    "mt-0.5 block min-w-0 w-full text-xs leading-relaxed line-clamp-2 select-text whitespace-pre-wrap break-words cursor-pointer transition-colors",
                    checked
                      ? "text-muted-foreground/50 line-through decoration-muted-foreground/40"
                      : "text-muted-foreground/80 hover:text-foreground/85",
                  )}
                >
                  {description}
                </div>
              )}
              {hasDetails && (
                <div
                  data-task-details
                  className="mt-1.5 flex min-w-0 w-full flex-wrap items-center gap-1.5 text-xs leading-4 text-muted-foreground"
                >
                  {showProject && task.project && (
                    <span className="inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap">
                      <ProjectIcon
                        name={task.project}
                        className="size-3 shrink-0"
                      />
                      <span className="truncate">{task.project}</span>
                    </span>
                  )}
                  {totalSubtasks > 0 && (
                    <button
                      type="button"
                      data-no-drag
                      aria-expanded={subtasksExpanded}
                      aria-label={`${subtasksExpanded ? "收起" : "展开"}子任务: ${task.description}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSubtasksExpanded(!subtasksExpanded);
                      }}
                      title={`${completedSubtasks}/${totalSubtasks} 个子任务`}
                      className="inline-flex shrink-0 items-center gap-1 h-4 rounded-[4px] text-[12px] leading-none text-muted-foreground/80 hover:text-foreground hover:bg-muted transition-colors cursor-pointer select-none whitespace-nowrap"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="size-3.5 shrink-0 opacity-80"
                        aria-hidden="true"
                      >
                        <path d="M4.5 2A2.5 2.5 0 0 1 5 6.95V8.5a2.5 2.5 0 0 0 2.336 2.495L7.5 11h1.55a2.5 2.5 0 1 1 0 1H7.5a3.5 3.5 0 0 1-3.495-3.308L4 8.5V6.95A2.5 2.5 0 0 1 4.5 2m7 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m-7-7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3" />
                      </svg>
                      <span className="tabular-nums">
                        {completedSubtasks}/{totalSubtasks}
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        className={cn(
                          "size-3 shrink-0 opacity-60 transition-transform duration-150",
                          subtasksExpanded && "rotate-90",
                        )}
                        aria-hidden="true"
                      >
                        <path
                          fill="currentColor"
                          d="M5.646 4.354a.5.5 0 1 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L9.293 8z"
                        />
                      </svg>
                    </button>
                  )}
                  {!!task.annotations.length && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] leading-none text-muted-foreground hover:text-foreground transition-colors cursor-pointer whitespace-nowrap"
                      title={`${task.annotations.length} 条评论`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                      }}
                    >
                      <MessageSquare
                        className="size-3.5 shrink-0"
                        strokeWidth={1.5}
                      />
                      <span className="tabular-nums">
                        {task.annotations.length}
                      </span>
                    </span>
                  )}
                  {(started || (trackedSeconds ?? 0) > 0) && (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 tabular-nums whitespace-nowrap",
                        started && "font-medium text-foreground",
                      )}
                    >
                      <Clock3 className="size-3" strokeWidth={1.5} />
                      {started
                        ? timingUnavailable
                          ? "进行中 · 计时不可用"
                          : `进行中 · ${formatDuration(trackedSeconds || 0)}`
                        : formatDuration(trackedSeconds || 0)}
                    </span>
                  )}
                  {task.due &&
                    (!checked && onDueChange ? (
                      <div
                        data-task-meta="due"
                        data-no-drag
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex shrink-0 items-center"
                      >
                        <DatePicker
                          id={`due-chip-${task.uuid}`}
                          value={dueDay}
                          disabled={disabled}
                          align="start"
                          ariaLabel={`截止日期: ${task.description}`}
                          onChange={onDueChange}
                          trigger={
                            <button
                              type="button"
                              className={cn(
                                "group/due inline-flex shrink-0 items-center gap-1 text-[12px] leading-none transition-opacity hover:opacity-75 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs whitespace-nowrap",
                                overdue
                                  ? "font-medium text-[#d1453b]"
                                  : isDueToday
                                    ? "font-medium text-[#058527] dark:text-[#25b84c]"
                                    : isDueTomorrow
                                      ? "font-medium text-[#eb8909]"
                                      : "text-[#a970ff]",
                              )}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="12"
                                height="12"
                                fill="none"
                                viewBox="0 0 12 12"
                                aria-hidden="true"
                                className="size-3 shrink-0"
                              >
                                <path
                                  fill="currentColor"
                                  fillRule="evenodd"
                                  d="M9.5 1h-7A1.5 1.5 0 0 0 1 2.5v7A1.5 1.5 0 0 0 2.5 11h7A1.5 1.5 0 0 0 11 9.5v-7A1.5 1.5 0 0 0 9.5 1M2 2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5zM8.75 8a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M3.5 4a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              {overdue && "逾期 · "}
                              {dueLabel(task.due)}
                            </button>
                          }
                        />
                      </div>
                    ) : (
                      <span
                        data-task-meta="due"
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 text-[12px] leading-none transition-colors whitespace-nowrap",
                          checked && "text-muted-foreground",
                        )}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          fill="none"
                          viewBox="0 0 12 12"
                          aria-hidden="true"
                          className="size-3 shrink-0"
                        >
                          <path
                            fill="currentColor"
                            fillRule="evenodd"
                            d="M9.5 1h-7A1.5 1.5 0 0 0 1 2.5v7A1.5 1.5 0 0 0 2.5 11h7A1.5 1.5 0 0 0 11 9.5v-7A1.5 1.5 0 0 0 9.5 1M2 2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5zM8.75 8a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M3.5 4a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {overdue && !checked && "逾期 · "}
                        {dueLabel(task.due)}
                      </span>
                    ))}
                  {!!task.wait &&
                    new Date(task.wait) > new Date() &&
                    !checked && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] leading-none text-muted-foreground whitespace-nowrap">
                        <Clock3
                          className="size-3.5 shrink-0"
                          strokeWidth={1.5}
                        />
                        等待 · {dueLabel(task.wait)}
                      </span>
                    )}
                  {!!task.recur && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-[12px] leading-none text-muted-foreground whitespace-nowrap"
                      aria-label={`重复 ${task.recur}`}
                    >
                      <Repeat2
                        className="size-3.5 shrink-0"
                        strokeWidth={1.5}
                      />
                      {task.recur}
                    </span>
                  )}
                  {task.priority &&
                    (!checked && onPriorityChange ? (
                      <div
                        data-no-drag
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex shrink-0 items-center"
                      >
                        <Popover
                          open={priorityChipOpen}
                          onOpenChange={setPriorityChipOpen}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-none transition-opacity hover:opacity-75 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xs whitespace-nowrap",
                                task.priority === "H"
                                  ? "text-red-600 dark:text-red-400"
                                  : task.priority === "M"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-blue-600 dark:text-blue-400",
                              )}
                            >
                              <Flag
                                className="size-3.5 shrink-0 fill-current"
                                strokeWidth={1.6}
                              />
                              {
                                (
                                  {
                                    H: "P1",
                                    M: "P2",
                                    L: "P3",
                                  } as Record<string, string>
                                )[task.priority]
                              }
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-36 p-1">
                            {PRIORITIES.map((item) => (
                              <Button
                                key={item.label}
                                type="button"
                                variant="navigation"
                                className="h-8 w-full justify-between px-2 text-xs font-normal"
                                onClick={() => {
                                  setPriorityChipOpen(false);
                                  onPriorityChange(item.value);
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <Flag
                                    className={cn("size-3.5", item.iconClass)}
                                  />
                                  <span>{item.label}</span>
                                </span>
                                {(task.priority || "") === item.value && (
                                  <Check className="size-3 text-foreground" />
                                )}
                              </Button>
                            ))}
                          </PopoverContent>
                        </Popover>
                      </div>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-none transition-colors whitespace-nowrap",
                          checked
                            ? "text-muted-foreground"
                            : task.priority === "H"
                              ? "text-[#d1453b]"
                              : task.priority === "M"
                                ? "text-[#eb8909]"
                                : task.priority === "L"
                                  ? "text-[#246fe0]"
                                  : "text-muted-foreground",
                        )}
                      >
                        <Flag
                          className="size-3.5 shrink-0 fill-current"
                          strokeWidth={1.6}
                        />
                        {
                          (
                            {
                              H: "P1",
                              M: "P2",
                              L: "P3",
                            } as Record<string, string>
                          )[task.priority]
                        }
                      </span>
                    ))}
                  {task.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex shrink-0 max-w-[120px] items-center gap-1 text-[12px] leading-none text-muted-foreground/80 hover:text-foreground transition-colors whitespace-nowrap"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        fill="none"
                        viewBox="0 0 12 12"
                        className="size-3 shrink-0 opacity-70"
                        aria-hidden="true"
                      >
                        <path
                          fill="currentColor"
                          fillRule="evenodd"
                          d="M5.93 1h3.427C10.264 1 11 1.736 11 2.643V6.07c0 .436-.173.854-.481 1.162L7.232 10.52a1.643 1.643 0 0 1-2.323 0L1.48 7.09a1.643 1.643 0 0 1 0-2.323L4.768 1.48A1.64 1.64 0 0 1 5.93 1m.001.91a.8.8 0 0 0-.569.235L2.145 5.362a.804.804 0 0 0 0 1.138L5.5 9.855a.804.804 0 0 0 1.138 0l3.217-3.217a.804.804 0 0 0 .236-.569V2.713a.804.804 0 0 0-.804-.804zm1.433 3.635a.91.91 0 1 0 0-1.818.91.91 0 0 0 0 1.818"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="truncate">{tag}</span>
                    </span>
                  ))}
                </div>
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
                    title="行内编辑 (E)"
                    onClick={() => setEditingInline(true)}
                    className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
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
                        aria-label={`设置截止日期: ${task.description}`}
                        title={
                          task.due
                            ? `截止 ${dueLabel(task.due)} — 点击更改`
                            : "选择截止日期"
                        }
                        className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground data-[state=open]:bg-white/10 data-[state=open]:text-foreground"
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
                        title={
                          task.priority
                            ? `优先级 ${task.priority === "H" ? "1" : task.priority === "M" ? "2" : "3"}`
                            : "设置优先级"
                        }
                        className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground data-[state=open]:bg-white/10 data-[state=open]:text-foreground"
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
                {variant === "list" && !completed && onToggleStart && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || (!started && timingUnavailable)}
                    aria-label={`${started ? "停止" : "开始"}: ${task.description}`}
                    title={
                      !started && timingUnavailable
                        ? "计时不可用"
                        : started
                          ? "停止计时"
                          : "开始计时"
                    }
                    onClick={onToggleStart}
                    className={cn(
                      "size-6 rounded-[4px] transition-colors hover:bg-white/10",
                      started
                        ? "text-foreground font-semibold"
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
                  <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        aria-label={`更多操作: ${task.description}`}
                        title="更多操作"
                        className="size-6 rounded-[4px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground data-[state=open]:bg-white/10 data-[state=open]:text-foreground"
                      >
                        <Ellipsis className="size-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      collisionPadding={12}
                      data-task-menu
                      className="w-60 p-1"
                    >
                      {!completed && onSaveInline && (
                        <Button
                          type="button"
                          variant="navigation"
                          className="h-8 text-xs font-normal"
                          onClick={() => {
                            setMoreOpen(false);
                            setEditingInline(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                          编辑任务{" "}
                          <kbd className="ml-auto text-[11px] text-muted-foreground">
                            E
                          </kbd>
                        </Button>
                      )}
                      {!completed && onDueChange && (
                        <div className="border-b border-border/60 px-1.5 pt-1 pb-2">
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                            <span>日期</span>
                            <span className="font-normal">
                              {task.due ? dueLabel(task.due) : "无日期"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <Button
                              type="button"
                              variant={isDueToday ? "secondary" : "ghost"}
                              size="icon-xs"
                              title="今天"
                              aria-label="安排至今天"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(todayStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <Sun className="size-4 text-emerald-500" />
                            </Button>
                            <Button
                              type="button"
                              variant={isDueTomorrow ? "secondary" : "ghost"}
                              size="icon-xs"
                              title="明天"
                              aria-label="安排至明天"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(tomorrowStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <Sunrise className="size-4 text-amber-500" />
                            </Button>
                            <Button
                              type="button"
                              variant={
                                dueDay === weekendStr ? "secondary" : "ghost"
                              }
                              size="icon-xs"
                              title="本周末"
                              aria-label="安排至本周末"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(weekendStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <Armchair className="size-4 text-blue-500" />
                            </Button>
                            <Button
                              type="button"
                              variant={
                                dueDay === nextWeekStr ? "secondary" : "ghost"
                              }
                              size="icon-xs"
                              title="下周"
                              aria-label="安排至下周"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange(nextWeekStr);
                              }}
                              className="size-8 rounded-md"
                            >
                              <ArrowRight className="size-4 text-violet-500" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              disabled={!task.due}
                              title="无日期"
                              aria-label="清除截止日期"
                              onClick={() => {
                                setMoreOpen(false);
                                onDueChange("");
                              }}
                              className="size-8 rounded-md text-muted-foreground"
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                      {!completed && onPriorityChange && (
                        <div className="border-b border-border/60 px-1.5 pt-2 pb-2">
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                            <span>优先级</span>
                            <span className="font-normal">
                              {task.priority === "H"
                                ? "P1"
                                : task.priority === "M"
                                  ? "P2"
                                  : task.priority === "L"
                                    ? "P3"
                                    : "P4"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            {[
                              {
                                val: "H" as const,
                                label: "优先级 1",
                                cls: "fill-red-500/20 text-red-600 dark:text-red-400",
                              },
                              {
                                val: "M" as const,
                                label: "优先级 2",
                                cls: "fill-amber-500/20 text-amber-600 dark:text-amber-400",
                              },
                              {
                                val: "L" as const,
                                label: "优先级 3",
                                cls: "fill-blue-500/20 text-blue-600 dark:text-blue-400",
                              },
                              {
                                val: "" as const,
                                label: "优先级 4",
                                cls: "text-muted-foreground",
                              },
                            ].map((item) => (
                              <Button
                                key={item.label}
                                type="button"
                                variant={
                                  (task.priority || "") === item.val
                                    ? "secondary"
                                    : "ghost"
                                }
                                size="icon-xs"
                                title={item.label}
                                aria-label={item.label}
                                onClick={() => {
                                  setMoreOpen(false);
                                  onPriorityChange(item.val);
                                }}
                                className="size-8 rounded-md"
                              >
                                <Flag className={cn("size-4", item.cls)} />
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="pt-1">
                        {!completed && onAddSubtask && (
                          <Button
                            type="button"
                            variant="navigation"
                            className="h-8 text-xs font-normal"
                            onClick={() => {
                              setMoreOpen(false);
                              setSubtasksExpanded(true);
                              setIsAddingSubtask(true);
                            }}
                          >
                            <CornerDownRight className="size-3.5" />
                            添加子任务
                          </Button>
                        )}
                        {isSubtask && onUnlinkSubtask && (
                          <Button
                            type="button"
                            variant="navigation"
                            className="h-8 text-xs font-normal"
                            onClick={() => {
                              setMoreOpen(false);
                              onUnlinkSubtask();
                            }}
                          >
                            <ArrowUpRight className="size-3.5" />
                            转为主任务
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="navigation"
                          className="h-8 text-xs font-normal"
                          onClick={() => {
                            setMoreOpen(false);
                            onEdit();
                          }}
                        >
                          <ListPlus className="size-3.5" />
                          备注与完整详情…
                        </Button>
                        {onDelete && (
                          <Button
                            type="button"
                            variant="navigation"
                            aria-label={`删除任务: ${task.description}`}
                            className="h-8 text-xs font-normal text-destructive hover:text-destructive"
                            onClick={() => {
                              setMoreOpen(false);
                              onDelete();
                            }}
                          >
                            <Trash2 className="size-3.5" />
                            删除任务
                          </Button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
          </div>
        </div>
        {(totalSubtasks > 0 || isAddingSubtask) &&
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
                <div className="pt-1">
                  {isAddingSubtask ? (
                    <TodoistTaskComposer
                      mode="add"
                      compact
                      disabled={disabled}
                      ariaLabel={`Add subtask to ${task.description}`}
                      placeholder="Subtask name (try @label, tomorrow, p1)"
                      defaultProject={task.project}
                      projects={projects}
                      availableLabels={availableLabels}
                      onSubmitTask={async (subtaskInput) => {
                        const ok = await onAddSubtask({
                          ...subtaskInput,
                          project: subtaskInput.project || task.project,
                        });
                        return ok;
                      }}
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
                      className="flex items-center gap-1.5 py-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors cursor-pointer w-full text-left"
                    >
                      <Plus className="size-3.5 text-[#de4c4a]" />
                      <span>添加子任务</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
      </div>
    </article>
  );
}
