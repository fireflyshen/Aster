import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { type ReactNode } from "react";
import { useWideWorkspace } from "@/lib/use-desktop";
import { useI18n } from "@/app/language";

export function WorkspaceNavigation({
  open,
  onOpenChange,
  children,
  showCounts = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  showCounts?: boolean;
}) {
  const { t } = useI18n();
  const desktop = useWideWorkspace();
  const contentClass =
    "flex flex-col overflow-y-auto bg-sidebar px-3 pb-3 [&>*]:shrink-0";
  if (desktop) {
    return (
      <aside
        data-show-counts={showCounts}
        id="workspace-navigation"
        aria-label={t("侧栏导航")}
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
        data-show-counts={showCounts}
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
        <SheetTitle className="sr-only">{t("侧栏导航")}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
