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
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const onOpenAutoFocus = (event: Event) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (detail) {
      event.preventDefault();
      content.current?.focus({ preventScroll: true });
    }
  };
  const onCloseAutoFocus = (event: Event) => {
    if (opener.current?.isConnected) {
      event.preventDefault();
      opener.current.focus({ preventScroll: true });
    }
  };
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
              <span className="min-w-0 truncate" title={location}>
                {isInboxLocation ? "收件箱" : location}
              </span>
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
  const handleEscape = (event: KeyboardEvent) => {
    if (
      busy ||
      event.isComposing ||
      event.keyCode === 229 ||
      (event.target instanceof Element &&
        event.target.closest("[data-editor-local-escape]"))
    )
      event.preventDefault();
  };
  return desktop ? (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        data-editor-layout="desktop"
        data-task-detail={detail}
        showCloseButton={!busy}
        className={cn(
          "task-editor-dialog flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden rounded-xl p-0",
          detail ? "sm:max-w-[864px]" : "sm:max-w-[680px]",
        )}
        onEscapeKeyDown={handleEscape}
        onPointerDownOutside={preventClose}
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={content}
        data-editor-layout="mobile"
        data-task-detail={detail}
        side="bottom"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        showCloseButton={!busy}
        className="mx-auto max-h-[calc(100dvh-0.75rem)] max-w-xl gap-0 overflow-hidden rounded-t-xl p-0"
        onEscapeKeyDown={handleEscape}
        onPointerDownOutside={preventClose}
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}
