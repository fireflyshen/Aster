import {
  HabitNegativeRowControls,
  HabitNegativeStatusRing,
  HabitSubtaskMetricsButton,
  type HabitTaskActions,
} from "@/features/habits/habit-task-controls";
import { TaskCheckbox } from "@/features/tasks/task-checkbox";
import { priorityOption } from "@/features/tasks/task-constants";
import { toDueDay } from "@/features/tasks/task-date";
import { TaskMetaChips } from "@/features/tasks/task-meta-chips";
import { TaskRowActions } from "@/features/tasks/task-row-actions";
import { handleTaskRowShortcut } from "@/features/tasks/task-row-shortcuts";
import { TaskRowSubtree } from "@/features/tasks/task-row-subtree";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import type { HabitListItem } from "@core/habits/model";
import { taskDate } from "@core/tasks/quick-task";
import type { EffectiveTaskState, TaskState } from "@core/tasks/state";
import type { TaskCostSummary } from "@core/time/model";
import type { SavedTag } from "@core/workspace/organization";
import type { Task, TaskInput } from "@shared/tasks";
import { cn } from "cn";
import { addDays, format } from "date-fns";
import { ChevronRight, GripVertical } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
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
  onClearStartMark?: () => void;
  effectiveRowState?: EffectiveTaskState | null;
  blocked?: boolean;
  onChangeState?: (state: TaskState) => void;
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
  costSummary?: TaskCostSummary;
  highlightCost?: boolean;
  timingActive?: boolean;
  isTimeMode?: boolean;
  timingUnavailable?: boolean;
  showProject?: boolean;
  showInbox?: boolean;
  sectionName?: string;
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
  habit?: HabitListItem;
  parentHabit?: HabitListItem;
  habitTodayDate?: string;
  habitActions?: HabitTaskActions;
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
  onClearStartMark,
  effectiveRowState,
  blocked = false,
  onChangeState,
  onDueChange,
  onPriorityChange,
  onSaveInline,
  onDelete,
  projects = [],
  availableLabels = [],
  extraActions,
  trackedSeconds,
  costSummary,
  highlightCost = true,
  timingActive: timingActiveProp,
  isTimeMode = false,
  timingUnavailable = false,
  showProject = true,
  showInbox = false,
  sectionName,
  transition,
  variant = "list",
  subtasks = [],
  isSubtask = false,
  description = "",
  onAddSubtask,
  onUnlinkSubtask,
  renderSubtask,
  expandSubtasks,
  habit,
  parentHabit,
  habitTodayDate,
  habitActions,
}: TaskRowProps) {
  const checked = transition?.checked ?? completed;
  const started = !!task.start && !checked;
  const timingActive = (timingActiveProp ?? started) && !checked;
  const dueDay = toDueDay(task.due);
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");

  const [editingInline, setEditingInline] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [priorityPopoverOpen, setPriorityPopoverOpen] = useState(false);
  const [drawerPinned, setDrawerPinned] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
  const canExpandSubtasks = variant !== "card";
  const effectiveSubtasksExpanded = canExpandSubtasks && subtasksExpanded;

  useEffect(() => {
    if (canExpandSubtasks && expandSubtasks !== undefined) {
      setSubtasksExpanded(true);
    }
  }, [canExpandSubtasks, expandSubtasks]);

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

  const activePlanKey =
    habit?.abEnabled && habit.plans.length > 1
      ? habit.todayEvaluation?.planId === habit.plans[1]?.id
        ? "B"
        : "A"
      : undefined;
  const habitPlanSubtasks = activePlanKey
    ? subtasks.filter(
        (s) =>
          (habit?.subtaskPlans?.[s.uuid] === "B" ? "B" : "A") === activePlanKey,
      )
    : subtasks;
  const effectiveSubtasks = subtasks;
  const totalSubtasks = habit
    ? habit.todayEvaluation?.requiredTotalCount ||
      habitPlanSubtasks.length ||
      subtasks.length
    : subtasks.length;
  const completedSubtasks = habit
    ? (habit.todayEvaluation?.requiredDoneCount ??
      habitPlanSubtasks.filter((s) =>
        Boolean(habit.todayEvaluation?.checklistProgress[s.uuid]?.done),
      ).length)
    : subtasks.filter((s) => s.status === "completed").length;
  const timingAllowed =
    (!habit || Boolean(habit.trackTime)) &&
    (!parentHabit || Boolean(parentHabit.trackTime));
  const effectiveIsTimeMode = isTimeMode && timingAllowed;
  const effectiveOnToggleStart = timingAllowed ? onToggleStart : undefined;
  const effectiveOnClearStartMark = timingAllowed
    ? onClearStartMark
    : undefined;

  const hasMoreMenu = Boolean(
    (!completed &&
      (onDueChange ||
        onPriorityChange ||
        onSaveInline ||
        onChangeState ||
        (canExpandSubtasks && onAddSubtask))) ||
    isSubtask ||
    onDelete,
  );
  const statePreventsComplete =
    !habit &&
    !parentHabit &&
    (effectiveRowState === "waiting" || effectiveRowState === "parked");
  const hasRightActions = Boolean(
    (!completed && effectiveOnToggleStart) ||
    (variant === "list" &&
      !completed &&
      (onSaveInline || onDueChange || onPriorityChange)) ||
    hasMoreMenu ||
    (variant === "list" && extraActions),
  );
  const showCost = Boolean(
    variant === "list" &&
    effectiveIsTimeMode &&
    highlightCost &&
    costSummary &&
    (costSummary.confirmedCostCents > 0 ||
      costSummary.provisionalCostCents > 0 ||
      costSummary.hasBudget),
  );
  const hasDetails = !!(
    (!habit && effectiveRowState && effectiveRowState !== "completed") ||
    blocked ||
    showCost ||
    description.trim() ||
    habit ||
    (showProject && (task.project || showInbox)) ||
    task.due ||
    task.recur ||
    task.annotations.length ||
    task.tags.length ||
    (!checked && task.wait && new Date(task.wait) > now) ||
    (timingAllowed && (started || timingActive || (trackedSeconds ?? 0) > 0)) ||
    totalSubtasks > 0
  );

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

  const subtreeNode = canExpandSubtasks &&
    (totalSubtasks > 0 || isAddingSubtask) &&
    effectiveSubtasksExpanded && (
      <TaskRowSubtree
        parentTask={task}
        variant={variant}
        completed={habit ? false : completed}
        disabled={disabled}
        subtasks={effectiveSubtasks}
        isAddingSubtask={isAddingSubtask}
        projects={projects}
        availableLabels={availableLabels}
        onStartAdd={() => {
          setIsAddingSubtask(true);
          setSubtasksExpanded(true);
        }}
        onCancelAdd={() => setIsAddingSubtask(false)}
        onAddSubtask={onAddSubtask}
        renderSubtask={renderSubtask}
      />
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
        {subtreeNode}
      </article>
    );
  }

  const actionsVisible = drawerPinned || moreOpen || priorityPopoverOpen;
  const negativeControls =
    habit?.kind === "negative" && habitActions && habitTodayDate ? (
      <HabitNegativeRowControls
        habit={habit}
        date={habitTodayDate}
        disabled={disabled}
        stacked={variant === "card"}
        onRecordNegative={habitActions.recordNegative}
        onUndoNegative={habitActions.undoNegative}
      />
    ) : null;
  const subtaskMetricsControl =
    parentHabit && habitActions && habitTodayDate ? (
      <HabitSubtaskMetricsButton
        parentHabit={parentHabit}
        subtaskUuid={task.uuid}
        date={habitTodayDate}
        disabled={disabled}
        onSetChecklistItem={habitActions.setChecklistItem}
        onAssignSubtaskPlan={habitActions.assignSubtaskPlan}
      />
    ) : null;

  return (
    <article
      ref={rowRef}
      data-task-row
      data-completion={transition?.phase}
      aria-busy={!!transition}
      onKeyDown={(event) =>
        handleTaskRowShortcut(event, {
          disabled,
          editingInline,
          completed,
          dueDay,
          todayStr,
          tomorrowStr,
          onStartInlineEdit: onSaveInline
            ? () => setEditingInline(true)
            : undefined,
          onComplete,
          onToggleStart: effectiveOnToggleStart,
          onDueChange,
          onPriorityChange,
          onDelete,
        })
      }
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
            "group/row",
            variant === "card" && "[&:has(:focus-visible)]:bg-(--row-hover)",
            variant === "card" && actionsVisible && "bg-(--row-hover)",
          )}
        >
          <div className="flex w-full min-w-0 items-start gap-2 md:gap-2.5">
            {variant === "list" && (
              <div className="task-row-gutter mt-2 flex shrink-0 items-center justify-center gap-0.5 self-start md:mt-1.5">
                <div
                  data-drag-handle
                  className="flex size-5 cursor-grab items-center justify-center opacity-0 transition-opacity hover:opacity-100! active:cursor-grabbing md:group-hover/row:opacity-45"
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
                    className="flex size-5 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground/70 transition-colors hover:bg-accent/70 hover:text-foreground"
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

            <div className="task-row-check mt-2 flex size-5 shrink-0 items-center justify-center self-start md:mt-1.5">
              {habit?.kind === "negative" ? (
                <HabitNegativeStatusRing habit={habit} />
              ) : (
                <TaskCheckbox
                  id={`complete-${task.uuid}`}
                  checked={checked}
                  completed={completed}
                  priority={task.priority}
                  description={task.description}
                  disabled={disabled || statePreventsComplete}
                  title={statePreventsComplete ? "先移回处理中" : undefined}
                  onComplete={onComplete}
                />
              )}
            </div>

            <div className="task-row-primary relative flex min-w-0 flex-1 items-start">
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
                className="flex h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-start gap-0 self-start px-0 py-2 text-left font-normal outline-none focus-visible:ring-1 focus-visible:ring-ring/50 md:min-h-8 md:py-1.5"
              >
                <div
                  role="button"
                  tabIndex={-1}
                  data-task-title
                  title={[
                    task.description,
                    task.priority ? priorityOption(task.priority).label : "",
                    Number.isFinite(task.urgency) && task.urgency > 0
                      ? `紧迫度 ${task.urgency.toFixed(1)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={onEdit}
                  className={cn(
                    "block w-full min-w-0 cursor-pointer text-[14px] leading-5 font-normal break-words transition-colors duration-150 outline-none hover:text-foreground",
                    checked
                      ? "text-muted-foreground/60 line-through decoration-muted-foreground/50"
                      : "text-foreground",
                  )}
                >
                  {task.description}
                </div>

                {hasDetails && (
                  <TaskMetaChips
                    description={description}
                    task={task}
                    costSummary={showCost ? costSummary : undefined}
                    checked={checked}
                    overdue={overdue}
                    disabled={disabled}
                    showProject={showProject}
                    showInbox={showInbox}
                    sectionName={sectionName}
                    started={timingAllowed ? started : false}
                    timingActive={timingAllowed ? timingActive : false}
                    isTimeMode={effectiveIsTimeMode}
                    timingUnavailable={timingUnavailable}
                    trackedSeconds={timingAllowed ? trackedSeconds : undefined}
                    availableLabels={availableLabels}
                    totalSubtasks={totalSubtasks}
                    completedSubtasks={completedSubtasks}
                    subtasksExpanded={effectiveSubtasksExpanded}
                    onToggleSubtasks={
                      canExpandSubtasks
                        ? () => setSubtasksExpanded((v) => !v)
                        : undefined
                    }
                    onEdit={onEdit}
                    onDueChange={onDueChange}
                    effectiveRowState={effectiveRowState}
                    blocked={blocked}
                    habit={habit}
                    habitTodayDate={habitTodayDate}
                    onHabitSwitchPlan={habitActions?.switchPlan}
                    onOpenHabitDetail={habitActions?.openDetail}
                  />
                )}
              </div>

              {hasRightActions && (
                <TaskRowActions
                  task={task}
                  variant={variant}
                  completed={completed}
                  disabled={disabled}
                  started={timingAllowed ? started : false}
                  timingActive={timingAllowed ? timingActive : false}
                  timingUnavailable={timingUnavailable}
                  dueDay={dueDay}
                  isSubtask={isSubtask}
                  actionsVisible={actionsVisible}
                  moreOpen={moreOpen}
                  onMoreOpenChange={setMoreOpen}
                  priorityPopoverOpen={priorityPopoverOpen}
                  onPriorityPopoverOpenChange={setPriorityPopoverOpen}
                  hasMoreMenu={hasMoreMenu}
                  extraActions={extraActions}
                  onEdit={onEdit}
                  onInlineEdit={
                    onSaveInline ? () => setEditingInline(true) : undefined
                  }
                  onToggleStart={effectiveOnToggleStart}
                  onClearStartMark={effectiveOnClearStartMark}
                  effectiveRowState={effectiveRowState}
                  onChangeState={onChangeState}
                  onDueChange={onDueChange}
                  onPriorityChange={onPriorityChange}
                  onStartAddSubtask={
                    canExpandSubtasks && onAddSubtask
                      ? () => {
                          setSubtasksExpanded(true);
                          setIsAddingSubtask(true);
                        }
                      : undefined
                  }
                  onUnlinkSubtask={onUnlinkSubtask}
                  onDelete={onDelete}
                />
              )}
            </div>

            {variant !== "card" && negativeControls}
            {variant !== "card" && subtaskMetricsControl}
          </div>
          {variant === "card" && negativeControls && (
            <div className="mt-2.5 border-t border-border/45 pt-2">
              {negativeControls}
            </div>
          )}
          {variant === "card" && subtaskMetricsControl && (
            <div className="mt-1 pl-7">{subtaskMetricsControl}</div>
          )}
        </div>
        {subtreeNode}
      </div>
    </article>
  );
}
