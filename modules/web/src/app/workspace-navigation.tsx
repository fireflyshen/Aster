import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { type ReactNode } from "react";
import { useDesktop } from "@/lib/use-desktop";

export function WorkspaceNavigation({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const desktop = useDesktop();
  const contentClass =
    "flex flex-col overflow-y-auto bg-sidebar px-3 pb-3 [&>*]:shrink-0";
  if (desktop) {
    return (
      <aside
        id="workspace-navigation"
        aria-label="Workspace navigation"
        data-state={open ? "open" : "closed"}
        aria-hidden={!open}
        inert={!open}
        className={`workspace-sidebar fixed inset-y-0 left-0 z-30 w-(--sidebar-width) ${contentClass}`}
      >
        {children}
      </aside>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id="workspace-navigation"
        side="left"
        aria-describedby={undefined}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("sidebar-close")?.focus();
        }}
        className={`${contentClass} w-[280px] gap-0 border-0 pt-[env(safe-area-inset-top)] pb-[max(0.75rem,env(safe-area-inset-bottom))] data-[state=open]:duration-200 data-[state=closed]:duration-200`}
      >
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
