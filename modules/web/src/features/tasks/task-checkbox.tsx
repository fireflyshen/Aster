import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { Check } from "lucide-react";

const RING_STYLES: Record<
  string,
  { unchecked: string; checked: string; preview: string }
> = {
  H: {
    unchecked:
      "border-[2px] border-(--priority-1) bg-(--priority-1)/10 enabled:hover:border-(--priority-1) enabled:hover:bg-(--priority-1)/18",
    checked:
      "border-[2px] border-(--priority-1) bg-(--priority-1) text-white data-[state=checked]:border-(--priority-1) data-[state=checked]:bg-(--priority-1) data-[state=checked]:text-white",
    preview: "text-(--priority-1)",
  },
  M: {
    unchecked:
      "border-[2px] border-(--priority-2) bg-(--priority-2)/10 enabled:hover:border-(--priority-2) enabled:hover:bg-(--priority-2)/18",
    checked:
      "border-[2px] border-(--priority-2) bg-(--priority-2) text-white data-[state=checked]:border-(--priority-2) data-[state=checked]:bg-(--priority-2) data-[state=checked]:text-white",
    preview: "text-(--priority-2)",
  },
  L: {
    unchecked:
      "border-[2px] border-(--priority-3) bg-(--priority-3)/10 enabled:hover:border-(--priority-3) enabled:hover:bg-(--priority-3)/18",
    checked:
      "border-[2px] border-(--priority-3) bg-(--priority-3) text-white data-[state=checked]:border-(--priority-3) data-[state=checked]:bg-(--priority-3) data-[state=checked]:text-white",
    preview: "text-(--priority-3)",
  },
  "": {
    unchecked:
      "border-[1.75px] border-(--priority-4)/85 bg-transparent enabled:hover:border-(--priority-4)",
    checked:
      "border-[1.75px] border-(--priority-4) bg-(--priority-4) text-white data-[state=checked]:border-(--priority-4) data-[state=checked]:bg-(--priority-4) data-[state=checked]:text-white",
    preview: "text-(--priority-4)",
  },
};

/** Circular priority-colored Todoist completion checkbox with hover check preview. */
export function TaskCheckbox({
  id,
  checked,
  completed,
  priority,
  description,
  disabled,
  size = "md",
  onComplete,
}: {
  id: string;
  checked: boolean;
  completed: boolean;
  priority?: string;
  description: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  onComplete: () => void;
}) {
  const style = RING_STYLES[priority || ""] || RING_STYLES[""];
  const dims =
    size === "lg" ? "size-[20px]" : size === "sm" ? "size-4" : "size-[18px]";
  const previewSize = size === "lg" ? "size-3.5" : "size-3";

  return (
    <Label
      htmlFor={id}
      className={cn(
        "task-check-target group/check relative flex items-center justify-center",
        dims,
        disabled ? "cursor-default" : "cursor-pointer",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={`${completed ? "重新打开" : "完成"}: ${description}`}
        onCheckedChange={onComplete}
        className={cn(
          "task-complete rounded-full shadow-none transition-all duration-150 focus-visible:ring-1 disabled:opacity-100 cursor-pointer",
          dims,
          checked ? style.checked : style.unchecked,
        )}
      />
      {!checked && !disabled && (
        <Check
          aria-hidden="true"
          className={cn(
            "task-check-preview pointer-events-none absolute inset-0 m-auto opacity-0 transition-opacity duration-150 group-hover/check:opacity-85",
            previewSize,
            style.preview,
          )}
        />
      )}
    </Label>
  );
}
