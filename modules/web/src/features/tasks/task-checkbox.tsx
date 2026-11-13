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
      "border-[2px] border-[#d1453b] bg-[#d1453b]/10 enabled:hover:border-[#d1453b] enabled:hover:bg-[#d1453b]/20",
    checked:
      "border-[2px] border-[#d1453b] bg-[#d1453b] text-white data-[state=checked]:border-[#d1453b] data-[state=checked]:bg-[#d1453b] data-[state=checked]:text-white",
    preview: "text-[#d1453b]",
  },
  M: {
    unchecked:
      "border-[2px] border-[#eb8909] bg-[#eb8909]/10 enabled:hover:border-[#eb8909] enabled:hover:bg-[#eb8909]/20",
    checked:
      "border-[2px] border-[#eb8909] bg-[#eb8909] text-white data-[state=checked]:border-[#eb8909] data-[state=checked]:bg-[#eb8909] data-[state=checked]:text-white",
    preview: "text-[#eb8909]",
  },
  L: {
    unchecked:
      "border-[2px] border-[#246fe0] bg-[#246fe0]/10 enabled:hover:border-[#246fe0] enabled:hover:bg-[#246fe0]/20",
    checked:
      "border-[2px] border-[#246fe0] bg-[#246fe0] text-white data-[state=checked]:border-[#246fe0] data-[state=checked]:bg-[#246fe0] data-[state=checked]:text-white",
    preview: "text-[#246fe0]",
  },
  "": {
    unchecked:
      "border-[1.75px] border-[#7a7a7a] bg-transparent enabled:hover:border-[#999999]",
    checked:
      "border-[1.75px] border-[#888888] bg-[#888888] text-white data-[state=checked]:border-[#888888] data-[state=checked]:bg-[#888888] data-[state=checked]:text-white",
    preview: "text-[#888888]",
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
