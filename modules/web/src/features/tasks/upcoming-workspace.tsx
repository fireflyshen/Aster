import { useState } from "react";
import type { TaskRenderFn } from "@/app/hooks/use-task-renderer";
import type { Task, TaskInput } from "@shared/tasks";
import { taskDate } from "@core/tasks/quick-task";
import { addLocalDays } from "@core/time/zone";
import { Plus } from "lucide-react";
import { toDueDay } from "./task-date";
import { LedgerPeriodPicker } from "@/features/time/ledger-ui";

export function upcomingWeek(date: string) {
  const day = new Date(`${date}T12:00:00`);
  const mondayOffset = (day.getDay() + 6) % 7;
  const monday = addLocalDays(date, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
}

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
  const today = taskDate(new Date()).slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const days = upcomingWeek(selectedDate);
  const byId = new Map(tasks.map((task) => [task.uuid, task]));
  const groups = days.map((day) => ({
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
      <LedgerPeriodPicker
        date={selectedDate}
        label="选择预览日期"
        onDate={setSelectedDate}
        onPrevious={() => setSelectedDate(addLocalDays(selectedDate, -7))}
        onNext={() => setSelectedDate(addLocalDays(selectedDate, 7))}
        onToday={() => setSelectedDate(today)}
      />
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
