import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProjectIcon } from "@/features/projects/project-icon";
import { formatDuration } from "@core/workspace/energy";
import type { Task } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import { CalendarDays, Check, Clock3, Flag, Play, Square } from "lucide-react";

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
            ? "Today"
            : +local === +tomorrow
              ? "Tomorrow"
              : format(date, "MMM d");
    return (
        day +
        (date.getHours() || date.getMinutes()
            ? ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
            : "")
    );
}
export function TaskRow({
    task,
    completed,
    overdue,
    disabled,
    onEdit,
    onComplete,
    onToggleStart,
    trackedSeconds,
    showProject = true,
    transition,
    variant = "list",
}: {
    task: Task;
    completed: boolean;
    overdue: boolean;
    disabled: boolean;
    onEdit: () => void;
    onComplete: () => void;
    onToggleStart?: () => void;
    trackedSeconds?: number;
    showProject?: boolean;
    variant?: "list" | "card";
    transition?: { checked: boolean; phase: "checking" | "leaving" };
}) {
    const checked = transition?.checked ?? completed;
    const started = !!task.start && !checked;
    const hasDetails = !!(
        (showProject && task.project) ||
        task.due ||
        task.tags.length ||
        task.priority ||
        task.wait ||
        started ||
        (trackedSeconds ?? 0) > 0
    );
    return (
        <article
            data-task-row
            data-completion={transition?.phase}
            aria-busy={!!transition}
            className="task-row"
        >
            <div className="min-h-0 overflow-hidden">
                <div
                    className={cn(
                        "group/row [&:has(:focus-visible)]:bg-muted/50",
                        variant === "list" && "border-b border-border",
                    )}
                >
                    <div
                        className={cn(
                            "grid",
                            !completed && onToggleStart
                                ? "grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[1.75rem_minmax(0,1fr)_auto]"
                                : "grid-cols-[2rem_minmax(0,1fr)] md:grid-cols-[1.75rem_minmax(0,1fr)]",
                        )}
                    >
                        <Label
                            htmlFor={`complete-${task.uuid}`}
                            className={cn(
                                "task-check-target relative flex h-11 w-8 items-center justify-start self-start md:h-8 md:w-7",
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
                                    "task-complete size-[18px] disabled:opacity-100 rounded-full border-muted-foreground/60 bg-background shadow-none transition-colors focus-visible:ring-1 enabled:hover:border-foreground data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground",
                                    !checked &&
                                        task.priority === "H" &&
                                        "border-foreground bg-muted",
                                )}
                            />
                            {!checked && !disabled && (
                                <Check
                                    aria-hidden="true"
                                    className="task-check-preview pointer-events-none absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                                />
                            )}
                        </Label>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={disabled}
                            data-task-drag-surface={
                                variant === "card" ? "" : undefined
                            }
                            onClick={onEdit}
                            className="disabled:opacity-100 flex h-auto min-h-11 min-w-0 w-full flex-col items-start justify-start gap-0 self-start rounded-sm px-0 py-3 text-left font-normal whitespace-normal hover:bg-transparent focus-visible:ring-1 md:min-h-8 md:py-1.5 dark:hover:bg-transparent"
                        >
                            <span
                                data-task-title
                                className={cn(
                                    "block min-w-0 w-full transition-colors duration-150 text-sm leading-5 [overflow-wrap:anywhere]",
                                    checked &&
                                        "text-muted-foreground line-through decoration-muted-foreground/40",
                                )}
                            >
                                {task.description}
                            </span>
                            {hasDetails && (
                                <span
                                    data-task-details
                                    className="mt-0.5 flex min-w-0 w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 [overflow-wrap:anywhere] text-muted-foreground"
                                >
                                    {showProject && task.project && (
                                        <span className="inline-flex min-w-0 items-center gap-1">
                                            <ProjectIcon
                                                name={task.project}
                                                className="size-3 shrink-0"
                                            />
                                            <span className="truncate">
                                                {task.project}
                                            </span>
                                        </span>
                                    )}
                                    {(started || (trackedSeconds ?? 0) > 0) && (
                                        <span
                                            className={cn(
                                                "flex items-center gap-1 tabular-nums",
                                                started &&
                                                    "font-medium text-foreground",
                                            )}
                                        >
                                            <Clock3
                                                className="size-3"
                                                strokeWidth={1.5}
                                            />
                                            {started
                                                ? `Active · ${formatDuration(trackedSeconds || 0)}`
                                                : formatDuration(
                                                      trackedSeconds || 0,
                                                  )}
                                        </span>
                                    )}
                                    {task.due && (
                                        <span
                                            className={cn(
                                                "flex items-center gap-1",
                                                overdue &&
                                                    !checked &&
                                                    "text-destructive",
                                            )}
                                        >
                                            <CalendarDays
                                                className="size-3"
                                                strokeWidth={1.5}
                                            />
                                            {overdue &&
                                                !checked &&
                                                "Overdue · "}
                                            {dueLabel(task.due)}
                                        </span>
                                    )}
                                    {!!task.wait &&
                                        new Date(task.wait) > new Date() &&
                                        !checked && (
                                            <span className="flex items-center gap-1">
                                                <Clock3
                                                    className="size-3"
                                                    strokeWidth={1.5}
                                                />
                                                Waiting · {dueLabel(task.wait)}
                                            </span>
                                        )}
                                    {task.priority && (
                                        <span className="flex items-center gap-1">
                                            <Flag
                                                className="size-3"
                                                strokeWidth={1.5}
                                            />
                                            {
                                                (
                                                    {
                                                        H: "High priority",
                                                        M: "Medium priority",
                                                        L: "Low priority",
                                                    } as Record<string, string>
                                                )[task.priority]
                                            }
                                        </span>
                                    )}
                                    {task.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="flex min-w-0 max-w-full items-start gap-1"
                                        >
                                            <LabelIcon
                                                className="mt-0.5 size-3 shrink-0"
                                                strokeWidth={1.5}
                                            />
                                            <span className="min-w-0 [overflow-wrap:anywhere]">
                                                {tag}
                                            </span>
                                        </span>
                                    ))}
                                </span>
                            )}
                        </Button>
                        {!completed && onToggleStart && (
                            <div className="flex h-11 items-center pl-1 md:h-8">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={disabled}
                                    aria-label={`${started ? "Stop" : "Start"}: ${task.description}`}
                                    onClick={onToggleStart}
                                    className={cn(
                                        "size-7 text-muted-foreground transition-opacity hover:text-foreground",
                                        started
                                            ? "text-foreground opacity-100"
                                            : "opacity-70 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100",
                                    )}
                                >
                                    {started ? (
                                        <Square className="size-3 fill-current" />
                                    ) : (
                                        <Play className="size-3.5" />
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}
