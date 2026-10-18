import { format } from "date-fns";
import { CalendarDays, Flag } from "lucide-react";
import { LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Task } from "@shared/tasks";
import { cn } from "cn";

function dueLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day = +local === +today ? "Today" : +local === +tomorrow ? "Tomorrow" : format(date, "MMM d");
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
  showProject = true,
}: {
  task: Task;
  completed: boolean;
  overdue: boolean;
  disabled: boolean;
  onEdit: () => void;
  onComplete: () => void;
  showProject?: boolean;
}) {
  const hasDetails = !!((showProject && task.project) || task.due || task.tags.length || task.priority);
  return (
    <article data-task-row className="border-b border-border [&:has(:focus-visible)]:bg-muted/50">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] md:grid-cols-[1.75rem_minmax(0,1fr)]">
        <Label
          htmlFor={`complete-${task.uuid}`}
          className={cn(
            "flex h-11 w-8 items-center justify-start self-start md:h-8 md:w-7",
            disabled ? "cursor-default" : "cursor-pointer",
          )}
        >
          <Checkbox
            id={`complete-${task.uuid}`}
            checked={completed}
            disabled={disabled}
            aria-label={`${completed ? "Reopen" : "Complete"}: ${task.description}`}
            onCheckedChange={onComplete}
            className={cn(
              "size-[18px] rounded-full border-muted-foreground/60 bg-background shadow-none transition-colors focus-visible:ring-1 enabled:hover:border-foreground data-[state=checked]:border-muted-foreground data-[state=checked]:bg-muted-foreground",
              !completed && task.priority === "H" && "border-foreground bg-muted",
            )}
          />
        </Label>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={onEdit}
          className="flex h-auto min-h-11 min-w-0 w-full flex-col items-start justify-start gap-0 self-start rounded-sm px-0 py-3 text-left font-normal whitespace-normal hover:bg-transparent focus-visible:ring-1 md:min-h-8 md:py-1.5 dark:hover:bg-transparent"
        >
          <span
            data-task-title
            className={cn(
              "block min-w-0 w-full text-sm leading-5 [overflow-wrap:anywhere]",
              completed && "text-muted-foreground line-through decoration-muted-foreground/40",
            )}
          >
            {task.description}
          </span>
          {hasDetails && (
            <span
              data-task-details
              className="mt-0.5 flex min-w-0 w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 [overflow-wrap:anywhere] text-muted-foreground"
            >
              {showProject && task.project && <span>{task.project}</span>}
              {task.due && (
                <span className={cn("flex items-center gap-1", overdue && !completed && "text-destructive")}>
                  <CalendarDays className="size-3" strokeWidth={1.5} />
                  {overdue && !completed && "Overdue · "}
                  {dueLabel(task.due)}
                </span>
              )}
              {task.priority && (
                <span className="flex items-center gap-1">
                  <Flag className="size-3" strokeWidth={1.5} />
                  {
                    ({ H: "High priority", M: "Medium priority", L: "Low priority" } as Record<string, string>)[
                      task.priority
                    ]
                  }
                </span>
              )}
              {task.tags.map((tag) => (
                <span key={tag} className="flex min-w-0 max-w-full items-start gap-1">
                  <LabelIcon className="mt-0.5 size-3 shrink-0" strokeWidth={1.5} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{tag}</span>
                </span>
              ))}
            </span>
          )}
        </Button>
      </div>
    </article>
  );
}
