import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "cn";
import { addDays, format, nextMonday, nextSaturday } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  Armchair,
  ArrowRight,
  CalendarIcon,
  Sun,
  Sunrise,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

export function DatePicker({
  value,
  onChange,
  disabled,
  compact = false,
  label,
  id = "due",
  returnFocus,
  className,
  ariaLabel = "Due date",
  emptyLabel,
  trigger,
  align = "start",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  id?: string;
  returnFocus?: () => void;
  className?: string;
  ariaLabel?: string;
  emptyLabel?: string;
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);
  const weekend = nextSaturday(today);
  const nextWeek = nextMonday(today);
  const todayStr = format(today, "yyyy-MM-dd");
  const tomorrowStr = format(tomorrow, "yyyy-MM-dd");
  const weekendStr = format(weekend, "yyyy-MM-dd");
  const nextWeekStr = format(nextWeek, "yyyy-MM-dd");

  const select = (next?: Date) => {
    onChange(next ? format(next, "yyyy-MM-dd") : "");
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              "h-11 w-full justify-start px-3 text-left text-base font-normal",
              !compact && "md:h-9 md:text-sm",
              compact &&
                "h-9 w-auto max-w-48 min-w-0 shrink gap-1.5 rounded-[5px] border-input px-2 py-0 text-[13px] text-muted-foreground shadow-none has-[>svg]:px-2 md:h-7 [&_svg]:size-4",
              compact &&
                value &&
                (value === todayStr
                  ? "border-emerald-500/35 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400"
                  : value === tomorrowStr
                    ? "border-amber-500/35 bg-amber-500/8 text-amber-700 dark:text-amber-400"
                    : "border-violet-500/35 bg-violet-500/8 text-violet-700 dark:text-violet-400"),
              !value && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="size-4 shrink-0" />
            <span className="truncate">
              {date
                ? label ||
                  (value === todayStr
                    ? "Today"
                    : value === tomorrowStr
                      ? "Tomorrow"
                      : format(date, compact ? "MMM d" : "MMM d, yyyy"))
                : emptyLabel || (compact ? "Date" : "No date")}
            </span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={16}
        className="w-auto p-0"
        aria-label={`Choose ${ariaLabel.toLowerCase()}`}
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                 event.preventDefault();
                 returnFocus();
              }
            : undefined
        }
      >
        <div className="grid grid-cols-1 gap-0.5 border-b p-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => select(today)}
            className={cn(
              "h-8 justify-between px-2.5 text-xs font-normal",
              value === todayStr && "bg-accent font-medium",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Sun className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Today
            </span>
            <span className="text-muted-foreground">
              {format(today, "EEE")}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => select(tomorrow)}
            className={cn(
              "h-8 justify-between px-2.5 text-xs font-normal",
              value === tomorrowStr && "bg-accent font-medium",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Sunrise className="size-3.5 text-amber-600 dark:text-amber-400" />
              Tomorrow
            </span>
            <span className="text-muted-foreground">
              {format(tomorrow, "EEE")}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => select(weekend)}
            className={cn(
              "h-8 justify-between px-2.5 text-xs font-normal",
              value === weekendStr && "bg-accent font-medium",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Armchair className="size-3.5 text-blue-600 dark:text-blue-400" />
              This weekend
            </span>
            <span className="text-muted-foreground">
              {format(weekend, "EEE")}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => select(nextWeek)}
            className={cn(
              "h-8 justify-between px-2.5 text-xs font-normal",
              value === nextWeekStr && "bg-accent font-medium",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <ArrowRight className="size-3.5 text-violet-600 dark:text-violet-400" />
              Next week
            </span>
            <span className="text-muted-foreground">
              {format(nextWeek, "MMM d")}
            </span>
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => select()}
              className="h-8 justify-start gap-2 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
              No date
            </Button>
          )}
        </div>
        <Calendar
          mode="single"
          locale={enUS}
          labels={{
            labelNav: () => "Month navigation",
            labelPrevious: () => "Previous month",
            labelNext: () => "Next month",
            labelDayButton: (date, modifiers) =>
              `${format(date, "EEEE, MMMM d, yyyy", { locale: enUS })}${modifiers.today ? ", today" : ""}${modifiers.selected ? ", selected" : ""}`,
          }}
          selected={date}
          defaultMonth={date}
          onSelect={select}
          weekStartsOn={1}
        />
      </PopoverContent>
    </Popover>
  );
}
