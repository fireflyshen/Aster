import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One fixed slot swaps the task count for the row's menu affordance. */
export function CountMenuTrigger({
  count,
  ...props
}: React.ComponentProps<typeof Button> & { count?: number }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      {...props}
      className="sidebar-count-action"
    >
      <span className="sidebar-row-count" aria-hidden="true">
        {count || ""}
      </span>
      <Ellipsis className="sidebar-row-ellipsis size-4" aria-hidden="true" />
    </Button>
  );
}
