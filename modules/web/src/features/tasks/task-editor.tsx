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
import { useSyncExternalStore, type ReactNode } from "react";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: string;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => false);
  const Header = desktop ? DialogHeader : SheetHeader;
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const body = (
    <>
      <Header className="shrink-0 border-b border-border/70 px-5 py-3.5 pr-12 text-left">
        <Title className="text-xs font-medium tracking-wide text-muted-foreground">
          {title}
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
        showCloseButton={!busy}
        className="flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[540px]"
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
