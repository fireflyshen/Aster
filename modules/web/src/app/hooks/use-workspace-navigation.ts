import type {
  SavedFilter,
  SavedTag,
  WorkspacePreferences,
} from "@core/workspace/organization";
import type { View } from "@shared/tasks";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsSection } from "../workspace-settings";
import { isDesktop, useDesktop } from "@/lib/use-desktop";

export type ActiveEntry = {
  kind: "filter" | "tag";
  item: SavedFilter | SavedTag;
};

export type CompleteBehavior = "hide" | "strikethrough";

export type TimePage = "today" | "weekly" | "reports" | "settings";

const VALID_VIEWS: readonly View[] = ["today", "pending", "focus", "upcoming"];

function validCompleteBehavior(
  value: string | null | undefined,
): CompleteBehavior {
  return value === "strikethrough" ? "strikethrough" : "hide";
}

function resetMobileScroll() {
  if (!isDesktop()) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

/** Manages server-persisted view/layout/sidebar navigation, search state, and view switches. */
export function useWorkspaceNavigation() {
  const desktop = useDesktop();
  const [desktopNavOpen, setNavOpen] = useState<boolean>(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navOpen = desktop ? desktopNavOpen : mobileNavOpen;
  const [view, setViewState] = useState<View>("today");
  const [layout, setLayoutState] = useState<"list" | "board">("list");
  const [completeBehavior, setCompleteBehaviorState] =
    useState<CompleteBehavior>("hide");
  const [currentProject, setCurrentProject] = useState("");
  const [organizationPage, setOrganizationPage] = useState(false);
  const [projectsPage, setProjectsPage] = useState(false);
  const [timePage, setTimePage] = useState<TimePage | null>(null);
  const [habitsPage, setHabitsPage] = useState(false);
  const [activeEntry, setActiveEntry] = useState<ActiveEntry | undefined>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const boardScroll = useRef(0);
  const persistRef = useRef<
    ((patch: WorkspacePreferences) => void) | undefined
  >(undefined);

  const syncFromPreferences = useCallback((prefs?: WorkspacePreferences) => {
    if (!prefs) return;
    if (prefs.navOpen !== undefined) setNavOpen(prefs.navOpen);
    if (prefs.view && VALID_VIEWS.includes(prefs.view)) {
      setViewState(prefs.view);
    }
    if (prefs.layout === "list" || prefs.layout === "board") {
      setLayoutState(prefs.layout);
    }
    if (prefs.completeBehavior !== undefined) {
      setCompleteBehaviorState(validCompleteBehavior(prefs.completeBehavior));
    }
  }, []);

  const bindPreferences = useCallback(
    (
      prefs: WorkspacePreferences | undefined,
      onUpdate: (patch: WorkspacePreferences) => void,
    ) => {
      persistRef.current = onUpdate;
      syncFromPreferences(prefs);
    },
    [syncFromPreferences],
  );

  const setNavigation = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      if (!desktop) {
        setMobileNavOpen(next);
        return;
      }
      setNavOpen((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        persistRef.current?.({ navOpen: resolved });
        return resolved;
      });
    },
    [desktop],
  );

  const setView = useCallback((next: View) => {
    setViewState(next);
    persistRef.current?.({ view: next });
  }, []);

  const setLayout = useCallback(
    (
      next: "list" | "board" | ((prev: "list" | "board") => "list" | "board"),
    ) => {
      setLayoutState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        persistRef.current?.({ layout: resolved });
        return resolved;
      });
    },
    [],
  );

  const openTaskView = useCallback(() => {
    resetMobileScroll();
    setOrganizationPage(false);
    setProjectsPage(false);
    setTimePage(null);
    setHabitsPage(false);
    setActiveEntry(undefined);
  }, []);

  const openEntry = useCallback(
    (entry: ActiveEntry) => {
      resetMobileScroll();
      setOrganizationPage(false);
      setProjectsPage(false);
      setTimePage(null);
      setHabitsPage(false);
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
      resetMobileScroll();
      setTimePage(null);
      setHabitsPage(false);
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

  const openTimePage = useCallback((page: TimePage) => {
    resetMobileScroll();
    setOrganizationPage(false);
    setProjectsPage(false);
    setHabitsPage(false);
    setActiveEntry(undefined);
    setCurrentProject("");
    setSearchOpen(false);
    setQuery("");
    setTimePage(page);
  }, []);

  const openHabitsPage = useCallback(() => {
    resetMobileScroll();
    setOrganizationPage(false);
    setProjectsPage(false);
    setTimePage(null);
    setActiveEntry(undefined);
    setCurrentProject("");
    setSearchOpen(false);
    setQuery("");
    setHabitsPage(true);
  }, []);

  const onProjectRemap = useCallback((updater: (current: string) => string) => {
    setCurrentProject((prev) => updater(prev));
  }, []);

  const setCompleteBehavior = useCallback((next: CompleteBehavior) => {
    setCompleteBehaviorState(next);
    persistRef.current?.({ completeBehavior: next });
  }, []);

  const scope =
    !organizationPage && activeEntry?.kind === "filter"
      ? `filter=${encodeURIComponent((activeEntry.item as SavedFilter).expression)}`
      : completeBehavior === "strikethrough"
        ? ("scope=all" as const)
        : ("scope=pending" as const);

  const specialPage = Boolean(
    organizationPage || projectsPage || activeEntry || timePage || habitsPage,
  );

  return {
    navOpen,
    setNavigation,
    view,
    setView,
    layout,
    setLayout,
    completeBehavior,
    setCompleteBehavior,
    currentProject,
    setCurrentProject,
    organizationPage,
    setOrganizationPage,
    projectsPage,
    setProjectsPage,
    timePage,
    setTimePage,
    habitsPage,
    setHabitsPage,
    activeEntry,
    setActiveEntry,
    commandOpen,
    setCommandOpen,
    settingsSection,
    setSettingsSection,
    openSettings: (section: SettingsSection = "theme") =>
      setSettingsSection(section),
    closeSettings: () => setSettingsSection(null),
    searchOpen,
    setSearchOpen,
    query,
    setQuery,
    viewMenuOpen,
    setViewMenuOpen,
    subModalOpen,
    setSubModalOpen,
    boardScroll,
    bindPreferences,
    scope,
    specialPage,
    openEntry,
    selectProject,
    selectView,
    openManagementPage,
    openTimePage,
    openHabitsPage,
    onProjectRemap,
  };
}
