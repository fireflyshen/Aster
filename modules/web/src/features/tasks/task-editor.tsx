import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Inbox, ChevronRight } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "cn";

const desktopQuery = "(min-width: 768px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;

export function TaskEditor({
  open,
  onOpenChange,
  busy,
  title,
  children,
  detail = false,
  location = "Inbox",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: string;
  children: ReactNode;
  detail?: boolean;
  location?: string;
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => false);
  const Header = desktop ? DialogHeader : SheetHeader;
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const body = (
    <>
      <Header className="task-detail-header shrink-0 border-b border-border/70 px-5 py-3.5 pr-12 text-left">
        <Title className="flex items-center gap-2 text-[13px] font-normal text-muted-foreground">
          {detail ? (
            <>
              <Inbox className="size-4 shrink-0" strokeWidth={1.5} />
              <span>{location}</span>
            </>
          ) : (
            title
          )}
        </Title>
        <Description className="sr-only">
          Edit the task and its properties.
        </Description>
      </Header>
      {children}
    </>
  );
  const preventClose = (event: Event) => {
    if (busy) event.preventDefault();
  };
  return desktop ? (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-editor-layout="desktop"
        data-task-detail={detail}
        showCloseButton={!busy}
        className={cn(
          "task-editor-dialog flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden rounded-xl p-0",
          detail ? "sm:max-w-[864px]" : "sm:max-w-[680px]",
        )}
        onEscapeKeyDown={preventClose}
        onPointerDownOutside={preventClose}
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-editor-layout="mobile"
        data-task-detail={detail}
        side="bottom"
        showCloseButton={!busy}
        className="mx-auto max-h-[calc(100dvh-0.75rem)] max-w-xl gap-0 overflow-hidden rounded-t-xl p-0"
        onEscapeKeyDown={preventClose}
        onPointerDownOutside={preventClose}
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}
