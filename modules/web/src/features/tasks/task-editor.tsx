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
import { Hash, Inbox } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useDesktop } from "@/lib/use-desktop";
import { cn } from "cn";

export function TaskEditor({
  open,
  onOpenChange,
  busy,
  title,
  children,
  detail = false,
  location = "收件箱",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: string;
  children: ReactNode;
  detail?: boolean;
  location?: string;
}) {
  const desktop = useDesktop();
  const mobileContent = useRef<HTMLDivElement>(null);
  const Header = desktop ? DialogHeader : SheetHeader;
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const isInboxLocation =
    !location || location === "收件箱" || location === "Inbox";
  const body = (
    <>
      <Header className="task-detail-header shrink-0 border-b border-border/70 px-5 py-3 pr-12 text-left">
        <Title className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          {detail ? (
            <>
              {isInboxLocation ? (
                <Inbox className="size-4 shrink-0" strokeWidth={1.6} />
              ) : (
                <Hash className="size-4 shrink-0" strokeWidth={1.6} />
              )}
              <span>{isInboxLocation ? "收件箱" : location}</span>
            </>
          ) : (
            title
          )}
        </Title>
        <Description className="sr-only">编辑任务及其属性。</Description>
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
        ref={mobileContent}
        data-editor-layout="mobile"
        data-task-detail={detail}
        side="bottom"
        onOpenAutoFocus={(event) => {
          if (detail) {
            event.preventDefault();
            mobileContent.current?.focus({ preventScroll: true });
          }
        }}
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
