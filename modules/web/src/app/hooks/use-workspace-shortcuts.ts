import type { View } from "@shared/tasks";
import { useEffect } from "react";

type WorkspaceShortcutParams = {
  open: boolean;
  commandOpen: boolean;
  quickOpen: boolean;
  organizationPage: boolean;
  busy: boolean;
  organizationSaving: boolean;
  view: View;
  searchOpen: boolean;
  query: string;
  setCommandOpen: (updater: (current: boolean) => boolean) => void;
  setLayout: (updater: (current: "list" | "board") => "list" | "board") => void;
  setNavOpen: (updater: (current: boolean) => boolean) => void;
  setOrganizationPage: (open: boolean) => void;
  setView: (view: View) => void;
  setSearchOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  openQuickAdd: () => void;
};

/** Global keyboard shortcuts for navigation, Quick Add, layout toggle, and command palette. */
export function useWorkspaceShortcuts({
  open,
  commandOpen,
  quickOpen,
  organizationPage,
  busy,
  organizationSaving,
  view,
  searchOpen,
  query,
  setCommandOpen,
  setLayout,
  setNavOpen,
  setOrganizationPage,
  setView,
  setSearchOpen,
  setQuery,
  openQuickAdd,
}: WorkspaceShortcutParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        if (!busy && !organizationSaving && !open && !quickOpen) {
          setCommandOpen((value) => !value);
        }
        return;
      }

      const target = event.target;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        open ||
        commandOpen ||
        quickOpen ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [data-state="open"][data-slot="select-content"], [data-state="open"][data-slot="popover-content"]',
        ) ||
        (target instanceof Element &&
          target.closest(
            'input, textarea, select, [contenteditable="true"], [role="combobox"]',
          ))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (
        (key === "j" || key === "k") &&
        !(target instanceof Element && target.closest("[data-task-row]"))
      ) {
        const firstRow = document.querySelector<HTMLElement>(
          "[data-task-row] [data-task-drag-surface]:not(:disabled)",
        );
        if (firstRow) {
          event.preventDefault();
          firstRow.focus();
          return;
        }
      }

      if (key === "q") {
        event.preventDefault();
        openQuickAdd();
      }

      if (key === "b" && !organizationPage && !busy && !organizationSaving) {
        event.preventDefault();
        setLayout((current) => {
          const next = current === "list" ? "board" : "list";
          try {
            localStorage.setItem("aster.task-layout", next);
          } catch {
            /* Layout still works without browser storage. */
          }
          return next;
        });
      }

      if (key === "m" && innerWidth >= 768) {
        event.preventDefault();
        setNavOpen((value) => !value);
        requestAnimationFrame(() =>
          document
            .getElementById("sidebar-toggle")
            ?.focus({ preventScroll: true }),
        );
      }

      if (event.key === "/") {
        event.preventDefault();
        setOrganizationPage(false);
        if (view === "focus" || view === "later") setView("pending");
        setSearchOpen(true);
        document.getElementById("task-search")?.focus();
      }

      if (event.key === "Escape" && (searchOpen || query)) {
        event.preventDefault();
        setQuery("");
        setSearchOpen(false);
        document.getElementById("search-toggle")?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    open,
    commandOpen,
    quickOpen,
    openQuickAdd,
    organizationPage,
    busy,
    organizationSaving,
    view,
    searchOpen,
    query,
    setCommandOpen,
    setLayout,
    setNavOpen,
    setOrganizationPage,
    setView,
    setSearchOpen,
    setQuery,
  ]);
}
