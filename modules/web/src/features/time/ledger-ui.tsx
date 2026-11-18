import { useI18n } from "@/app/language";
import type { ComponentProps, ReactNode } from "react";
import { CalendarCheck2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { projectLeaf } from "@core/workspace/projects";

export function LedgerIconButton({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "title"> & {
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      {...props}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

export function LedgerPeriodPicker({
  date,
  dateLabel,
  label,
  onDate,
  onPrevious,
  onNext,
  onToday,
  todayLabel,
  children,
}: {
  date: string;
  dateLabel?: string;
  label: string;
  onDate: (date: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  todayLabel?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="ledger-period-bar">
      <div className="ledger-period-date">
        <DateField
          aria-label={label}
          displayValue={dateLabel}
          value={date}
          onChange={onDate}
        />
        <div className="ledger-date-stepper">
          <LedgerIconButton label={t("上一周期")} onClick={onPrevious}>
            <ChevronLeft className="size-4" />
          </LedgerIconButton>
          <LedgerIconButton label={todayLabel ?? t("今天")} onClick={onToday}>
            <CalendarCheck2 className="size-4" />
          </LedgerIconButton>
          <LedgerIconButton label={t("下一周期")} onClick={onNext}>
            <ChevronRight className="size-4" />
          </LedgerIconButton>
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
    attention?: boolean;
  }[];
}) {
  return (
    <dl className="ledger-summary">
      {items.map((item) => (
        <div key={item.label} data-attention={item.attention || undefined}>
          <dt className={item.attention ? undefined : "sr-only"}>
            {item.label}
          </dt>
          <dd title={item.label}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LedgerAttribution({
  project,
  tags,
}: {
  project?: string;
  tags?: readonly string[];
}) {
  return (
    <>
      {project && <span title={project}>{projectLeaf(project)}</span>}
      {!!tags?.length && (
        <span title={tags.map((tag) => `#${tag}`).join("、")}>
          #{tags[0]}
          {tags.length > 1 && (
            <span className="ml-1.5">+{tags.length - 1}</span>
          )}
        </span>
      )}
    </>
  );
}
