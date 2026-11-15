import { formatDescriptionSummary } from "@core/tasks/description";
import { cn } from "cn";

/** Quiet, single-line supporting text shared by Todo and habit lists. */
export function DescriptionSummary({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const summary = formatDescriptionSummary(text);
  if (!summary) return null;
  return (
    <span
      data-description-summary
      className={cn("description-summary", className)}
    >
      {summary}
    </span>
  );
}
