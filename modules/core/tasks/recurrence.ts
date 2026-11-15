import { isCompactTaskDate } from "./model.ts";
export const recurrenceOptions = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "yearly", label: "Every year" },
] as const;

export function validateRecurrence(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    (value &&
      !recurrenceOptions.some((option) => option.value === value) &&
      !/^[1-9]\d{0,2}(?:days?|wks?|mo|yrs?)$/.test(value))
  )
    throw new Error("Choose a valid repeat interval.");
  return value;
}

export function recurrenceLabel(value: string) {
  return (
    recurrenceOptions.find((option) => option.value === value)?.label || value
  );
}

export function validateUntil(value: unknown, due?: unknown): string {
  if (typeof value !== "string" || (value && !isCompactTaskDate(value)))
    throw new Error("Choose a valid repeat end date.");
  if (value && typeof due === "string" && due && value < due)
    throw new Error("Repeat end date must follow the first due date.");
  return value;
}
