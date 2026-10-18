import { Toast } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TaskToast({
  open,
  onOpenChange,
  project,
  onView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  onView: () => void;
}) {
  return (
    <Toast.Provider duration={4500} swipeDirection="down">
      <Toast.Root
        open={open}
        onOpenChange={onOpenChange}
        className="flex items-center gap-3 rounded-lg bg-primary px-3 py-2 text-[13px] text-primary-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      >
        <Toast.Title className="min-w-0 flex-1 truncate">
          Task added to <span className="underline underline-offset-2">{project || "Inbox"}</span>
        </Toast.Title>
        <Toast.Action altText="View task location" asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onView}
            className="h-9 px-2 text-xs text-white hover:bg-white/10 md:h-8"
          >
            Open
          </Button>
        </Toast.Action>
        <Toast.Close asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss notification"
            className="size-9 p-0 text-white/70 hover:bg-white/10 hover:text-white md:size-8"
          >
            <X className="size-4" />
          </Button>
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-20 left-4 z-[100] m-0 w-auto max-w-[calc(100vw-2rem)] list-none outline-none md:bottom-4" />
    </Toast.Provider>
  );
}
