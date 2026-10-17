import { CalendarDays, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Task } from "@/lib/api";
import { cn } from "cn";

function dueLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  const day =
    +local === +today ? "今天" : +local === +tomorrow ? "明天" : `${date.getMonth() + 1}月${date.getDate()}日`;
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
  const hasDetails = !!((showProject && task.project) || task.due || task.tags.length);
  return (
    <article data-task-row className="border-b border-[#f1f1f1] [&:has(:focus-visible)]:bg-[#fafafa]">
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
            aria-label={`${completed ? "重新打开" : "完成"}：${task.description}`}
            onCheckedChange={onComplete}
            className={cn(
              "size-[18px] rounded-full border-[#aaa] bg-white shadow-none focus-visible:ring-1 data-[state=checked]:border-[#aaa] data-[state=checked]:bg-[#aaa]",
              !completed && task.priority === "H" && "border-[#d1453b] bg-[#fff0ef]",
              !completed && task.priority === "M" && "border-[#eb8909] bg-[#fff6e9]",
              !completed && task.priority === "L" && "border-[#246fe0] bg-[#edf4ff]",
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
              className="mt-0.5 flex min-w-0 w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 [overflow-wrap:anywhere] text-[#888]"
            >
              {showProject && task.project && <span>{task.project}</span>}
              {task.due && (
                <span className={cn("flex items-center gap-1 text-[#9d7b26]", overdue && "text-primary")}>
                  <CalendarDays className="size-3" strokeWidth={1.5} />
                  {dueLabel(task.due)}
                </span>
              )}
              {task.tags.map((tag) => (
                <span key={tag} className="flex min-w-0 max-w-full items-start gap-1">
                  <Tag className="mt-0.5 size-3 shrink-0" strokeWidth={1.5} />
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
