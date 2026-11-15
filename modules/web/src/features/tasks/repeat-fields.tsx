import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recurrenceOptions, recurrenceLabel } from "@core/tasks/recurrence";
import { taskDate } from "@core/tasks/quick-task";
import { parseTaskwarriorDate } from "@core/tasks/model";
import { DatePicker } from "./date-picker";

const REPEAT_LABELS: Record<string, string> = {
  daily: "每天",
  weekdays: "每个工作日",
  weekly: "每周",
  biweekly: "每两周",
  monthly: "每月",
  yearly: "每年",
};

export function RepeatSelect({
  value,
  onChange,
  disabled,
  allowNone = true,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  allowNone?: boolean;
}) {
  return (
    <Select
      value={value || "none"}
      onValueChange={(value) => onChange(value === "none" ? "" : value)}
      disabled={disabled}
    >
      <SelectTrigger
        id="repeat"
        className="h-11 min-h-11 w-full text-base data-[size=default]:h-11 md:min-h-9 md:text-sm md:data-[size=default]:h-9"
        aria-label="重复"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="none">不重复</SelectItem>}
        {value &&
          !recurrenceOptions.some((option) => option.value === value) && (
            <SelectItem value={value}>
              {REPEAT_LABELS[value] || recurrenceLabel(value)}
            </SelectItem>
          )}
        {recurrenceOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {REPEAT_LABELS[option.value] || option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function RepeatEnd({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const date = parseTaskwarriorDate(value);
  const local = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : "";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label
        htmlFor="repeat-until"
        className="text-xs leading-4 font-normal text-muted-foreground"
      >
        结束日期
      </Label>
      <DatePicker
        id="repeat-until"
        ariaLabel="重复结束日期"
        emptyLabel="从不"
        value={local}
        disabled={disabled}
        onChange={(day) =>
          onChange(day ? taskDate(new Date(`${day}T23:59:59`)) : "")
        }
      />
    </div>
  );
}
