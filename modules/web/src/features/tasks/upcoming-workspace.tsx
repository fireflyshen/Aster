import { upcomingWeek } from "./upcoming-model";
import { useState } from "react";
import type { TaskRenderFn } from "@/app/hooks/use-task-renderer";
import type { Task, TaskInput } from "@shared/tasks";
import { addLocalDays } from "@core/time/zone";
import { Plus, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { zhCN } from "date-fns/locale";
import { toDueDay } from "./task-date";

export function UpcomingWorkspace({
  tasks,
  layout,
  renderTask,
  onAdd,
  disabled,
  loading,
  taskLinks,
}: {
  tasks: Task[];
  layout: "list" | "board";
  renderTask: TaskRenderFn;
  onAdd: (draft: TaskInput) => void;
  disabled: boolean;
  loading: boolean;
  taskLinks?: Record<string, string>;
}) {
  const today = toDueDay(new Date().toISOString());
  const [selectedDate, setSelectedDate] = useState(today);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const days = upcomingWeek(selectedDate);
  const byId = new Map(tasks.map((task) => [task.uuid, task]));
  const visibleDays =
    layout === "board"
      ? days
      : Array.from({ length: 28 }, (_, index) => addLocalDays(days[0], index));
  const groups = visibleDays.map((day) => ({
    day,
    tasks: tasks.filter((task) => {
      if (!task.due || toDueDay(task.due) !== day) return false;
      const parent = byId.get(taskLinks?.[task.uuid] || "");
      return !parent?.due || toDueDay(parent.due) !== day;
    }),
  }));
  const label = (day: string) => {
    const date = new Date(`${day}T12:00:00`);
    return `${date.getMonth() + 1}月${date.getDate()}日${day === today ? " · 今天" : day === addLocalDays(today, 1) ? " · 明天" : ""} · ${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date)}`;
  };
  return (
    <div className="upcoming-workspace" data-upcoming-layout={layout}>
      <div className="upcoming-period">
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="upcoming-month"
              aria-label="选择预览日期"
            >
              {new Intl.DateTimeFormat("zh-CN", {
                year: "numeric",
                month: "long",
              }).format(new Date(selectedDate + "T12:00:00"))}
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              locale={zhCN}
              selected={new Date(selectedDate + "T12:00:00")}
              defaultMonth={new Date(selectedDate + "T12:00:00")}
              onSelect={(date) => {
                if (date) {
                  setSelectedDate(toDueDay(date.toISOString()));
                  setDatePickerOpen(false);
                }
              }}
            />
          </PopoverContent>
        </Popover>
        <div className="ledger-date-stepper">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一周"
            onClick={() => setSelectedDate(addLocalDays(selectedDate, -7))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDate(today)}
          >
            今天
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一周"
            onClick={() => setSelectedDate(addLocalDays(selectedDate, 7))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <nav className="upcoming-week-nav" aria-label="一周日期">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            data-today={day === today || undefined}
            onClick={() =>
              document.getElementById(`upcoming-${day}`)?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "start",
              })
            }
          >
            <span>
              {new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(
                new Date(`${day}T12:00:00`),
              )}
            </span>
            <strong>{Number(day.slice(8))}</strong>
          </button>
        ))}
      </nav>
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          加载任务…
        </p>
      )}
      <div className="upcoming-days">
        {groups.map((group) => (
          <section
            key={group.day}
            id={`upcoming-${group.day}`}
            aria-label={label(group.day)}
            className="upcoming-day"
          >
            <h2>
              {label(group.day)}
              <span>{group.tasks.length || ""}</span>
            </h2>
            <div className="upcoming-day-tasks">
              {group.tasks.map((task) => (
                <div
                  key={task.uuid}
                  className={layout === "board" ? "task-board-card mb-2" : ""}
                >
                  {renderTask(
                    task,
                    undefined,
                    layout === "board" ? "card" : "list",
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="upcoming-add"
              disabled={disabled}
              aria-label={`在 ${group.day} 添加任务`}
              onClick={() =>
                onAdd({ description: "", tags: [], due: group.day })
              }
            >
              <Plus className="size-4" />
              添加任务
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}
