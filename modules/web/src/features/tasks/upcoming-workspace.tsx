import { upcomingWeek } from "./upcoming-model";
import { useCallback, useEffect, useRef, useState } from "react";
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

const INITIAL_DAYS = 28;
const MAX_DAYS = 140;

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
  const [rangeAnchor, setRangeAnchor] = useState(today);
  const [activeDay, setActiveDay] = useState(today);
  const [dayCount, setDayCount] = useState(INITIAL_DAYS);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntilRef = useRef(0);

  const weekStart = upcomingWeek(rangeAnchor)[0];
  const listStart =
    layout === "list" && rangeAnchor === today ? today : weekStart;
  const visibleDays =
    layout === "board"
      ? upcomingWeek(rangeAnchor)
      : Array.from({ length: dayCount }, (_, index) =>
          addLocalDays(listStart, index),
        );
  const stripDays = upcomingWeek(activeDay);

  const byId = new Map(tasks.map((task) => [task.uuid, task]));
  const taskCountsByDay = new Map<string, number>();
  for (const task of tasks) {
    if (!task.due) continue;
    const day = toDueDay(task.due);
    const parent = byId.get(taskLinks?.[task.uuid] || "");
    if (!parent?.due || toDueDay(parent.due) !== day) {
      taskCountsByDay.set(day, (taskCountsByDay.get(day) ?? 0) + 1);
    }
  }

  const groups = visibleDays.map((day) => ({
    day,
    tasks: tasks.filter((task) => {
      if (!task.due || toDueDay(task.due) !== day) return false;
      const parent = byId.get(taskLinks?.[task.uuid] || "");
      return !parent?.due || toDueDay(parent.due) !== day;
    }),
  }));

  const scrollToDay = useCallback((day: string) => {
    setActiveDay(day);
    programmaticScrollUntilRef.current = Date.now() + 700;
    requestAnimationFrame(() => {
      document.getElementById(`upcoming-${day}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "start",
      });
    });
  }, []);

  const jumpToDate = useCallback(
    (targetDay: string) => {
      setRangeAnchor(targetDay);
      setDayCount(INITIAL_DAYS);
      scrollToDay(targetDay);
    },
    [scrollToDay],
  );

  // Sync activeDay & week strip with vertical scroll position in list mode.
  useEffect(() => {
    if (layout === "board") return;
    let raf = 0;

    const updateActiveFromScroll = () => {
      raf = 0;
      if (Date.now() < programmaticScrollUntilRef.current) return;
      const headerEl = stickyHeaderRef.current;
      const threshold = (headerEl?.getBoundingClientRect().bottom ?? 144) + 18;
      let current = visibleDays[0];
      for (const day of visibleDays) {
        const el = document.getElementById(`upcoming-${day}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) {
          current = day;
        } else {
          break;
        }
      }
      if (current) {
        setActiveDay((prev) => (prev === current ? prev : current));
      }

      const nearBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 480;
      if (nearBottom) {
        setDayCount((prev) => (prev < MAX_DAYS ? Math.min(MAX_DAYS, prev + 14) : prev));
      }
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(updateActiveFromScroll);
    };
    const onScrollEnd = () => {
      programmaticScrollUntilRef.current = 0;
      updateActiveFromScroll();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", onScrollEnd, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
    };
  }, [layout, visibleDays]);

  const label = (day: string) => {
    const date = new Date(`${day}T12:00:00`);
    return `${date.getMonth() + 1}月${date.getDate()}日${
      day === today
        ? " · 今天"
        : day === addLocalDays(today, 1)
          ? " · 明天"
          : ""
    } · ${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date)}`;
  };

  return (
    <div className="upcoming-workspace" data-upcoming-layout={layout}>
      <div ref={stickyHeaderRef} className="upcoming-sticky-header">
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
                }).format(new Date(activeDay + "T12:00:00"))}
                <ChevronDown className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                locale={zhCN}
                selected={new Date(activeDay + "T12:00:00")}
                defaultMonth={new Date(activeDay + "T12:00:00")}
                onSelect={(date) => {
                  if (date) {
                    jumpToDate(toDueDay(date.toISOString()));
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
              onClick={() => jumpToDate(addLocalDays(activeDay, -7))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => jumpToDate(today)}
            >
              今天
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下一周"
              onClick={() => jumpToDate(addLocalDays(activeDay, 7))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <nav className="upcoming-week-nav" aria-label="一周日期">
          {stripDays.map((day) => {
            const isToday = day === today;
            const isActive = day === activeDay;
            const isPast = day < today;
            const hasTasks = (taskCountsByDay.get(day) ?? 0) > 0;
            const inRange = visibleDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                data-today={isToday || undefined}
                data-active={isActive || undefined}
                data-past={isPast || undefined}
                data-has-tasks={hasTasks || undefined}
                aria-current={isActive ? "date" : undefined}
                onClick={() => {
                  if (inRange) scrollToDay(day);
                  else jumpToDate(day);
                }}
              >
                <span>
                  {new Intl.DateTimeFormat("zh-CN", {
                    weekday: "narrow",
                  }).format(new Date(`${day}T12:00:00`))}
                </span>
                <strong>{Number(day.slice(8))}</strong>
                {hasTasks && <i className="upcoming-day-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </nav>
      </div>

      {loading && (
        <p role="status" className="pt-2 text-xs text-muted-foreground">
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
