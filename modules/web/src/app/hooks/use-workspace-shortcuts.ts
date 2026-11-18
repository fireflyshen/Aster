import { useEffect } from "react";

type WorkspaceShortcutParams = {
  open: boolean;
  commandOpen: boolean;
  quickOpen: boolean;
  canChangeLayout: boolean;
  busy: boolean;
  organizationSaving: boolean;
  searchOpen: boolean;
  setCommandOpen: (updater: (current: boolean) => boolean) => void;
  setLayout: (updater: (current: "list" | "board") => "list" | "board") => void;
  setNavOpen: (updater: (current: boolean) => boolean) => void;
  openSearch: () => void;
  closeSearch: () => void;
  openQuickAdd: () => void;
};

/** Global keyboard shortcuts for navigation, Quick Add, layout toggle, and command palette. */
export function useWorkspaceShortcuts({
  open,
  commandOpen,
  quickOpen,
  canChangeLayout,
  busy,
  organizationSaving,
  searchOpen,
  setCommandOpen,
  setLayout,
  setNavOpen,
  openSearch,
  closeSearch,
  openQuickAdd,
}: WorkspaceShortcutParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat
      )
        return;
      const overlayOpen = document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-state="open"][data-slot="popover-content"]',
      );
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        if (
          !busy &&
          !organizationSaving &&
          !open &&
          !quickOpen &&
          (!overlayOpen || commandOpen)
        ) {
          event.preventDefault();
          setCommandOpen((value) => !value);
        }
        return;
      }

      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        open ||
        commandOpen ||
        quickOpen ||
        overlayOpen
      ) {
        return;
      }

      const target = event.target;
      const editable =
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="combobox"]',
        );
      if (
        event.key === "Escape" &&
        searchOpen &&
        (!editable || editable.id === "task-search")
      ) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (editable) return;

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

      if (key === "b" && canChangeLayout && !busy && !organizationSaving) {
        event.preventDefault();
        setLayout((current) => (current === "list" ? "board" : "list"));
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
        openSearch();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    open,
    commandOpen,
    quickOpen,
    openQuickAdd,
    canChangeLayout,
    busy,
    organizationSaving,
    searchOpen,
    setCommandOpen,
    setLayout,
    setNavOpen,
    openSearch,
    closeSearch,
  ]);
}
