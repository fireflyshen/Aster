import type { SavedFilter, SavedTag } from "@core/workspace/organization";
import type { View } from "@shared/tasks";
import { useCallback, useRef, useState } from "react";

export type ActiveEntry = {
  kind: "filter" | "tag";
  item: SavedFilter | SavedTag;
};

const VALID_VIEWS: readonly View[] = [
  "today",
  "pending",
  "waiting",
  "completed",
];

function readStoredView(): View {
  if (typeof window === "undefined") return "today";
  try {
    const raw = window.localStorage.getItem("aster:view") as View | null;
    return raw && VALID_VIEWS.includes(raw) ? raw : "today";
  } catch {
    return "today";
  }
}

function readStoredLayout(): "list" | "board" {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem("aster:layout") === "board"
      ? "board"
      : "list";
  } catch {
    return "list";
  }
}

function readStoredNav(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem("aster:nav");
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {}
  return window.innerWidth >= 768;
}

/** Manages persisted view/layout/sidebar navigation, search state, and view switches. */
export function useWorkspaceNavigation() {
  const [navOpen, setNavOpen] = useState<boolean>(readStoredNav);
  const [view, setViewState] = useState<View>(readStoredView);
  const [layout, setLayoutState] = useState<"list" | "board">(readStoredLayout);
  const [currentProject, setCurrentProject] = useState("");
  const [organizationPage, setOrganizationPage] = useState(false);
  const [projectsPage, setProjectsPage] = useState(false);
  const [activeEntry, setActiveEntry] = useState<ActiveEntry | undefined>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const boardScroll = useRef(0);

  const setNavigation = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setNavOpen((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem("aster:nav", resolved ? "1" : "0");
        } catch {}
        return resolved;
      });
    },
    [],
  );

  const setView = useCallback((next: View) => {
    setViewState(next);
    try {
      window.localStorage.setItem("aster:view", next);
    } catch {}
  }, []);

  const setLayout = useCallback(
    (
      next: "list" | "board" | ((prev: "list" | "board") => "list" | "board"),
    ) => {
      setLayoutState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          window.localStorage.setItem("aster:layout", resolved);
        } catch {}
        return resolved;
      });
    },
    [],
  );

  const openTaskView = useCallback(() => {
    setOrganizationPage(false);
    setProjectsPage(false);
    setActiveEntry(undefined);
  }, []);

  const openEntry = useCallback(
    (entry: ActiveEntry) => {
      setOrganizationPage(false);
      setProjectsPage(false);
      setActiveEntry(entry);
      setCurrentProject("");
      setView("pending");
      setSearchOpen(false);
      setQuery("");
    },
    [setView],
  );

  const selectProject = useCallback(
    (name: string) => {
      openTaskView();
      setCurrentProject(name);
      setView("pending");
      setQuery("");
    },
    [openTaskView, setView],
  );

  const selectView = useCallback(
    (nextView: View) => {
      openTaskView();
      setView(nextView);
      setCurrentProject("");
      setQuery("");
    },
    [openTaskView, setView],
  );

  const openManagementPage = useCallback(
    (kind: "organization" | "projects", closeSearch = true) => {
      setProjectsPage(kind === "projects");
      setOrganizationPage(true);
      setActiveEntry(undefined);
      if (closeSearch) {
        setSearchOpen(false);
        setQuery("");
      }
      setCurrentProject("");
    },
    [],
  );

  const onProjectRemap = useCallback((updater: (current: string) => string) => {
    setCurrentProject((prev) => updater(prev));
  }, []);

  const scope =
    view === "completed" && !currentProject && !activeEntry && !organizationPage
      ? ("completed" as const)
      : ("pending" as const);

  const specialPage = Boolean(organizationPage || projectsPage || activeEntry);

  return {
    navOpen,
    setNavigation,
    view,
    setView,
    layout,
    setLayout,
    currentProject,
    setCurrentProject,
    organizationPage,
    setOrganizationPage,
    projectsPage,
    setProjectsPage,
    activeEntry,
    setActiveEntry,
    commandOpen,
    setCommandOpen,
    recoveryOpen,
    setRecoveryOpen,
    searchOpen,
    setSearchOpen,
    query,
    setQuery,
    viewMenuOpen,
    setViewMenuOpen,
    subModalOpen,
    setSubModalOpen,
    boardScroll,
    scope,
    specialPage,
    openEntry,
    selectProject,
    selectView,
    openManagementPage,
    onProjectRemap,
  };
}
