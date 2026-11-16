import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LedgerPeriodPicker({
  date,
  label,
  onDate,
  onPrevious,
  onNext,
  onToday,
  todayLabel = "今天",
  children,
}: {
  date: string;
  label: string;
  onDate: (date: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  todayLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ledger-period-bar">
      <div className="ledger-period-date">
        <Input
          type="date"
          aria-label={label}
          value={date}
          onChange={(event) => {
            if (event.target.value) onDate(event.target.value);
          }}
        />
        <div className="ledger-date-stepper">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一周期"
            onClick={onPrevious}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onToday}>
            {todayLabel}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一周期"
            onClick={onNext}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="ledger-period-actions">{children}</div>
    </div>
  );
}
export function LedgerSummary({
  items,
}: {
  items: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    attention?: boolean;
  }[];
}) {
  return (
    <dl className="ledger-summary">
      {items.map((item) => (
        <div key={item.label} data-attention={item.attention || undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.hint && <p>{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
