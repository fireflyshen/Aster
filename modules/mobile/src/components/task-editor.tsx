import { useSyncExternalStore, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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
      <Header className="shrink-0 px-6 pt-6 pr-16 pb-5 text-left">
        <Title className="text-base leading-6 font-medium">{title}</Title>
        <Description className="sr-only">填写任务及可选属性，保存到 RN。</Description>
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
        className="flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]"
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
