import { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
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
          aria-label="截止日期"
          className={cn(
            "h-11 w-full justify-start px-3 text-left text-base font-normal",
            compact &&
              "h-7 min-w-0 w-auto max-w-48 shrink gap-1.5 rounded-[5px] border-[#e6e6e6] px-2 py-0 text-[13px] text-[#666] shadow-none has-[>svg]:px-2 [&_svg]:size-4",
            compact && value && "text-[#9d7b26]",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">
            {date ? label || format(date, compact ? "M月d日" : "yyyy/MM/dd") : compact ? "日期" : "未设置"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-auto p-0"
        aria-label="选择截止日期"
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
          locale={zhCN}
          labels={{
            labelNav: () => "月份导航",
            labelPrevious: () => "上个月",
            labelNext: () => "下个月",
            labelDayButton: (date, modifiers) =>
              `${format(date, "yyyy年M月d日 EEEE", { locale: zhCN })}${modifiers.today ? "，今天" : ""}${modifiers.selected ? "，已选" : ""}`,
          }}
          selected={date}
          defaultMonth={date}
          onSelect={select}
          weekStartsOn={1}
          autoFocus
        />
        <div className="flex justify-between gap-2 border-t p-3">
          <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => select()}>
            清除日期
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => select(new Date())}>
            今天
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
