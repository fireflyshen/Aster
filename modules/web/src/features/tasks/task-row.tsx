import { TaskCheckbox } from "@/features/tasks/task-checkbox";
import { toDueDay } from "@/features/tasks/task-date";
import { TaskMetaChips } from "@/features/tasks/task-meta-chips";
import { TaskRowActions } from "@/features/tasks/task-row-actions";
import { handleTaskRowShortcut } from "@/features/tasks/task-row-shortcuts";
import { TaskRowSubtree } from "@/features/tasks/task-row-subtree";
import { TodoistTaskComposer } from "@/features/tasks/todoist-task-composer";
import { formatDescriptionPreview } from "@core/tasks/description";
import { taskDate } from "@core/tasks/quick-task";
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
    const descriptionPreview = formatDescriptionPreview(description);
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
            window.removeEventListener(
                "pointerdown",
                onPointerDownOutside,
                true,
            );
            window.removeEventListener("keydown", onEscape);
        };
    }, [drawerPinned, task.uuid]);

    const totalSubtasks = subtasks.length;
    const completedSubtasks = subtasks.filter(
        (s) => s.status === "completed",
    ).length;
    const hasMoreMenu = Boolean(
        (!completed &&
            (onDueChange ||
                onPriorityChange ||
                onSaveInline ||
                onAddSubtask)) ||
        isSubtask ||
        onDelete,
    );
    const hasRightActions = Boolean(
        (variant === "list" &&
            !completed &&
            (onSaveInline ||
                onToggleStart ||
                onDueChange ||
                onPriorityChange)) ||
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
        (Number.isFinite(task.urgency) && task.urgency > 0) ||
        started ||
        (trackedSeconds ?? 0) > 0 ||
        totalSubtasks > 0
    );

    function handleWheel(event: WheelEvent<HTMLElement>) {
        if (disabled || variant !== "list" || editingInline) return;
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return;
        if (event.deltaX > 18 && !drawerPinned) {
            window.dispatchEvent(
                new CustomEvent(SWIPE_EVENT, { detail: task.uuid }),
            );
            setDrawerPinned(true);
        } else if (event.deltaX < -18 && drawerPinned) {
            setDrawerPinned(false);
        }
    }

    const subtreeNode = (totalSubtasks > 0 || isAddingSubtask) &&
        subtasksExpanded && (
            <TaskRowSubtree
                parentTask={task}
                variant={variant}
                completed={completed}
                disabled={disabled}
                subtasks={subtasks}
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
                        until: task.until
                            ? taskDate(new Date(task.until))
                            : undefined,
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

    const actionsVisible =
        drawerPinned || moreOpen || priorityPopoverOpen || priorityChipOpen;

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
                    onToggleStart,
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
                        "group/row [&:has(:focus-visible)]:bg-(--row-hover)",
                        variant === "list" &&
                            "-mx-2.5 px-2.5 md:-mx-3 md:px-3 [.board-card_&]:mx-0 [.board-card_&]:px-0",
                        actionsVisible && "bg-(--row-hover)",
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
                                        aria-label={
                                            subtasksExpanded
                                                ? "收起子任务"
                                                : "展开子任务"
                                        }
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setSubtasksExpanded(
                                                (expanded) => !expanded,
                                            );
                                        }}
                                        className="size-4.5 flex cursor-pointer items-center justify-center rounded-sm text-muted-foreground/65 transition-colors hover:bg-muted/80 hover:text-foreground"
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
                            className="flex h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-start gap-0 self-start px-0 py-2 text-left font-normal outline-none focus-visible:ring-1 focus-visible:ring-ring/50 md:min-h-8 md:py-1.5"
                        >
                            <div
                                role="button"
                                tabIndex={-1}
                                data-task-title
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

                            {descriptionPreview && (
                                <div
                                    data-task-description-preview
                                    title={description}
                                    onClick={(e) => {
                                        if (
                                            window.getSelection()?.toString()
                                                .length
                                        ) {
                                            e.stopPropagation();
                                            return;
                                        }
                                        onEdit();
                                    }}
                                    className={cn(
                                        "mt-0.5 block w-full min-w-0 max-w-full cursor-pointer truncate text-[12px] leading-[18px] transition-colors select-text",
                                        checked
                                            ? "text-muted-foreground/45 line-through decoration-muted-foreground/40"
                                            : "text-muted-foreground/75 hover:text-foreground/85",
                                    )}
                                >
                                    {descriptionPreview}
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
                                    onPriorityChipOpenChange={
                                        setPriorityChipOpen
                                    }
                                    onToggleSubtasks={() =>
                                        setSubtasksExpanded((v) => !v)
                                    }
                                    onEdit={onEdit}
                                    onDueChange={onDueChange}
                                    onPriorityChange={onPriorityChange}
                                />
                            )}
                        </div>

                        {hasRightActions && (
                            <TaskRowActions
                                task={task}
                                variant={variant}
                                completed={completed}
                                disabled={disabled}
                                started={started}
                                timingUnavailable={timingUnavailable}
                                dueDay={dueDay}
                                isSubtask={isSubtask}
                                actionsVisible={actionsVisible}
                                moreOpen={moreOpen}
                                onMoreOpenChange={setMoreOpen}
                                priorityPopoverOpen={priorityPopoverOpen}
                                onPriorityPopoverOpenChange={
                                    setPriorityPopoverOpen
                                }
                                hasMoreMenu={hasMoreMenu}
                                extraActions={extraActions}
                                onEdit={onEdit}
                                onInlineEdit={
                                    onSaveInline
                                        ? () => setEditingInline(true)
                                        : undefined
                                }
                                onToggleStart={onToggleStart}
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
                                onDelete={onDelete}
                            />
                        )}
                    </div>
                </div>
                {subtreeNode}
            </div>
        </article>
    );
}
