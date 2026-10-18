import { useState } from "react";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

export function DatePicker({
  value,
  onChange,
  disabled,
  compact = false,
  label,
  id = "due",
  returnFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  id?: string;
  returnFocus?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  const select = (next?: Date) => {
    onChange(next ? format(next, "yyyy-MM-dd") : "");
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label="Due date"
          className={cn(
            "h-11 w-full justify-start px-3 text-left text-base font-normal",
            compact &&
              "h-9 min-w-0 md:h-7 w-auto max-w-48 shrink gap-1.5 rounded-[5px] border-input px-2 py-0 text-[13px] text-muted-foreground shadow-none has-[>svg]:px-2 [&_svg]:size-4",
            compact && value && "text-foreground",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">
            {date ? label || format(date, compact ? "MMM d" : "MMM d, yyyy") : compact ? "Date" : "No date"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-auto p-0"
        aria-label="Choose due date"
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                event.preventDefault();
                returnFocus();
              }
            : undefined
        }
      >
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
          autoFocus
        />
        <div className="flex justify-between gap-2 border-t p-3">
          <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => select()}>
            Clear date
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => select(new Date())}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
