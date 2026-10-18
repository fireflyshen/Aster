import { useSyncExternalStore, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const desktopSnapshot = () => window.matchMedia("(min-width: 768px)").matches;
function subscribe(callback: () => void) {
  const media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function WorkspaceNavigation({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => false);
  const contentClass = "flex flex-col overflow-y-auto bg-sidebar px-3 py-3 [&>*]:shrink-0";
  if (desktop) {
    return (
      open && (
        <aside
          id="workspace-navigation"
          aria-label="Workspace navigation"
          className={`fixed inset-y-0 left-0 z-30 w-60 ${contentClass}`}
        >
          {children}
        </aside>
      )
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id="workspace-navigation"
        side="left"
        aria-describedby={undefined}
        showCloseButton={false}
        className={`${contentClass} w-60 gap-0 border-0 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] data-[state=open]:duration-150 data-[state=closed]:duration-150`}
      >
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
