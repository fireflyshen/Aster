import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FileText, X } from "lucide-react";
import { useId, useState } from "react";
import { DescriptionReader } from "./description-reader";

/** Descriptions are available on demand without competing with the task title. */
export function DescriptionPopover({
  text,
  title,
  onOpenDetails,
  compact = false,
}: {
  text: string;
  compact?: boolean;
  title: string;
  onOpenDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  if (!text.trim()) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-no-drag
          data-description-trigger
          className="description-trigger"
          title={`查看说明：${title}`}
          data-icon-only={compact || undefined}
          aria-label={`查看说明：${title}`}
          onClick={(event) => event.stopPropagation()}
        >
          <FileText aria-hidden="true" />
          {!compact && <span>说明</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="description-popover"
        align="start"
        sideOffset={8}
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (
            document.querySelector(
              '[role="dialog"]:not(.description-popover), [role="alertdialog"]',
            )
          )
            event.preventDefault();
        }}
      >
        <div className="description-popover-header">
          <h3 id={headingId}>{title}</h3>
          <button
            type="button"
            aria-label="关闭说明"
            onClick={() => setOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="description-popover-body">
          <DescriptionReader text={text} />
        </div>
        <button
          type="button"
          className="description-popover-details"
          onClick={() => {
            setOpen(false);
            onOpenDetails();
          }}
        >
          打开详情
        </button>
      </PopoverContent>
    </Popover>
  );
}
