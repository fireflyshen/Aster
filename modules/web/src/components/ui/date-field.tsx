import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { useI18n } from "@/app/language";

/** Shared day-only input; never converts the chosen local day through UTC. */
export function DateField({
  value,
  onChange,
  id,
  disabled,
  className,
  displayValue,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  displayValue?: string;
  "aria-label"?: string;
}) {
  const { t, locale } = useI18n();
  const label = ariaLabel ?? t("选择日期");
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value + "T12:00:00") : undefined;
  const date = parsed && !Number.isNaN(+parsed) ? parsed : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          id={id}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "date-field w-full min-w-0 justify-between px-2.5 font-normal",
            className,
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {displayValue ??
                (date
                  ? format(date, locale === "en" ? "M/d/yyyy" : "yyyy/M/d")
                  : t("选择日期"))}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" aria-label={label}>
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          required
          onSelect={(day) => {
            if (day) {
              onChange(format(day, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
        />
        <div className="calendar-footer">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              onChange(format(new Date(), "yyyy-MM-dd"));
              setOpen(false);
            }}
          >
            {t("今天")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
