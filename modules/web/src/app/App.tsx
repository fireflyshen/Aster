import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationManager } from "@/features/organization/organization-manager";
import { FocusPicker } from "@/features/projects/focus-picker";
import { FocusOverview } from "@/features/projects/focus-overview";
import { ProjectEditor } from "@/features/projects/project-editor";
import {
  ProjectColorsProvider,
  ProjectIcon,
} from "@/features/projects/project-icon";
import { ProjectManager } from "@/features/projects/project-manager";
import { ProjectTransition } from "@/features/projects/project-transition";
import { QuickAdd } from "@/features/tasks/quick-add";
import { TaskEditor } from "@/features/tasks/task-editor";
import { RecoveryCenter } from "@/features/recovery/recovery-center";
import { SeriesEditor } from "@/features/tasks/series-editor";
import { TaskForm } from "@/features/tasks/task-form";
import { TaskRow } from "@/features/tasks/task-row";
import { TaskToast } from "@/features/tasks/task-toast";
import { api, RequestError } from "@/lib/api";
import { CommandPalette } from "./command-palette";
import { taskDate } from "@core/tasks/quick-task";
import {
  columnTasks,
  defaultBoard,
  taskColumnId,
  UNSECTIONED,
  unsectionedColumn,
  type BoardChange,
} from "@core/workspace/board";
import { liveEnergySummary } from "@core/workspace/energy";
import {
  FOCUS_LIMIT,
  focusProject,
  inProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import {
  type Organization,
  type OrganizationChange,
  type SavedFilter,
  type SavedTag,
} from "@core/workspace/organization";
import {
  projectLeaf,
  projectNames,
  projectParent,
  projectPath,
  remapProject,
} from "@core/workspace/projects";
import type { Task, TaskInput, View } from "@shared/tasks";
import { cn } from "cn";
import { format } from "date-fns";
import {
  Check,
  Columns3,
  Ellipsis,
  FileText,
  List,
  PanelLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ThemeSwitcher } from "./theme-switcher";
import { views, WorkspaceSidebar } from "./workspace-sidebar";

const TaskBoard = lazy(() =>
  import("@/features/tasks/task-board").then((module) => ({
    default: module.TaskBoard,
  })),
);

type TaskGroup = "overdue" | "today" | "pending" | "waiting" | "completed";
const blank: TaskInput = {
  description: "",
  project: "",
  due: "",
  tags: [],
  priority: "",
};
const day = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function taskGroup(task: Task): TaskGroup {
  if (task.status === "completed") return "completed";
  if (
    (task.wait && new Date(task.wait) > new Date()) ||
    task.status === "waiting"
  )
    return "waiting";
  if (task.due) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(task.due) < today) return "overdue";
    today.setDate(today.getDate() + 1);
    if (new Date(task.due) < today) return "today";
  }
  return "pending";
}

export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [layout, setLayout] = useState<"list" | "board">(() => {
    try {
      return localStorage.getItem("aster.task-layout") === "board"
        ? "board"
        : "list";
    } catch {
      return "list";
    }
  });
  const [boardMove, setBoardMove] = useState<{
    uuid: string;
    columnId: string;
    beforeUuid: string | null;
  }>();
  const boardScroll = useRef(0);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [organizationPage, setOrganizationPage] = useState(false);
  const [projectsPage, setProjectsPage] = useState(false);
  const [organization, setOrganization] = useState<Organization>({
    revision: 0,
    filters: [],
    tags: [],
  });
  const [organizationError, setOrganizationError] = useState("");
  const [organizationReady, setOrganizationReady] = useState(false);
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [organizationBlocked, setOrganizationBlocked] = useState(false);
  const [activeEntry, setActiveEntry] = useState<{
    kind: "filter" | "tag";
    id: string;
  }>();
  const activeItem =
    activeEntry?.kind === "filter"
      ? organization.filters.find((f) => f.id === activeEntry.id)
      : organization.tags.find((t) => t.id === activeEntry?.id);
  const nativeFilter = activeItem
    ? activeEntry?.kind === "filter"
      ? (activeItem as SavedFilter).expression
      : `status:pending +${activeItem.name}`
    : "";
  const [view, setView] = useState<View>("focus");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(
    () => new URLSearchParams(window.location.search).get("panel") === "data",
  );
  const [seriesUuid, setSeriesUuid] = useState("");
  const [open, setOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickProject, setQuickProject] = useState("");
  const [quickError, setQuickError] = useState("");
  const [toastOpen, setToastOpen] = useState(false);
  const [toastVersion, setToastVersion] = useState(0);
  const [addedProject, setAddedProject] = useState("");
  const [undoTask, setUndoTask] = useState<{
    task: Task;
    wasCompleted: boolean;
    wasStarted?: boolean;
    wasDeleted?: boolean;
    message?: string;
    board?: { columnId: string; beforeUuid: string | null };
  }>();
  const [completion, setCompletion] = useState<{
    uuid: string;
    checked: boolean;
    phase: "checking" | "leaving";
  }>();
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);
  const [transitionProject, setTransitionProject] = useState<{
    name: string;
    status: ProjectStatus;
  }>();
  const [editingProject, setEditingProject] = useState<string>();
  const [newProjectParent, setNewProjectParent] = useState("");
  const [editingHeaderOutcome, setEditingHeaderOutcome] = useState(false);
  const [headerOutcomeDraft, setHeaderOutcomeDraft] = useState("");
  const [editingHeaderDesc, setEditingHeaderDesc] = useState(false);
  const [headerDescDraft, setHeaderDescDraft] = useState("");
  const [deletingProject, setDeletingProject] = useState<{
    name: string;
    revision: number;
  }>();
  const [editing, setEditing] = useState<Task>();
  const [draft, setDraft] = useState<TaskInput>(blank);
  const [tags, setTags] = useState("");
  const [due, setDue] = useState("");
  const [formError, setFormError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const generation = useRef(0);
  const organizationGeneration = useRef(0);
  const writeLock = useRef(false);
  const previousScope = useRef("");
  const scope = nativeFilter
    ? `filter=${encodeURIComponent(nativeFilter)}`
    : `scope=${view === "completed" ? "completed" : "pending"}`;
  const loadOrganization = useCallback(async () => {
    const ticket = ++organizationGeneration.current;
    try {
      const result = await api<Organization>("organization");
      if (ticket !== organizationGeneration.current) return;
      setOrganization(result);
      setOrganizationReady(true);
      setOrganizationError("");
      setOrganizationBlocked(false);
      return result;
    } catch (error) {
      if (ticket === organizationGeneration.current)
        setOrganizationError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);
  const hasActiveTask =
    (organization.energy?.activeCount || 0) > 0 ||
    tasks.some((task) => !!task.start && task.status !== "completed");
  useEffect(() => {
    setNow(new Date());
    if (!hasActiveTask) return;
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, [hasActiveTask, organization.energy?.calculatedAt]);
  const energy = liveEnergySummary(organization.energy, now);
  function taskTrackedSeconds(task: Task): number | undefined {
    if (organization.timing?.available === false) return undefined;
    const key = task.uuid.toLowerCase();
    const base = organization.energy?.taskSeconds?.[key] ?? 0;
    if (!task.start || task.status === "completed") return base;
    const calculatedAt = organization.energy?.calculatedAt
      ? new Date(organization.energy.calculatedAt).getTime()
      : NaN;
    if (!Number.isNaN(calculatedAt) && now.getTime() > calculatedAt) {
      return base + Math.floor((now.getTime() - calculatedAt) / 1000);
    }
    return base;
  }
  function openEntry(entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) {
    setActiveEntry({ kind: entry.kind, id: entry.item.id });
    setOrganizationPage(false);
    setView("pending");
    setProject("");
    setQuery("");
    setSearchOpen(false);
    if (innerWidth < 768) setNavOpen(false);
  }
  function openTaskView() {
    setOrganizationPage(false);
    setActiveEntry(undefined);
  }
  function setNavigation(open: boolean) {
    setNavOpen(open);
    if (!open && innerWidth < 768)
      requestAnimationFrame(() =>
        document
          .getElementById("sidebar-mobile-toggle")
          ?.focus({ preventScroll: true }),
      );
  }
  async function changeOrganization(change: OrganizationChange) {
    if (writeLock.current || organizationBlocked || needsCheck) return false;
    writeLock.current = true;
    setOrganizationSaving(true);
    setOrganizationError("");
    organizationGeneration.current++;
    try {
      const result = await api<Organization>("organization", change);
      setOrganization(result);
      if (change.kind === "project" && change.action !== "status") {
        const original = change.originalName || change.item.name;
        setProject((name) =>
          inProject(name, original)
            ? change.action === "delete"
              ? ""
              : remapProject(name, original, change.item.name)
            : name,
        );
      }
      if (
        change.kind !== "board" &&
        change.kind !== "energy" &&
        !(await load())
      ) {
        setNeedsCheck(true);
        setNotice("Saved. Refresh to check your tasks.");
      }
      return true;
    } catch (error) {
      setOrganizationError((error as Error).message);
      if (error instanceof RequestError && error.uncertain) {
        setOrganizationBlocked(true);
        setNeedsCheck(true);
      }
      return false;
    } finally {
      writeLock.current = false;
      setOrganizationSaving(false);
    }
  }
  useLayoutEffect(() => {
    if (searchOpen) document.getElementById("task-search")?.focus();
  }, [searchOpen]);

  const load = useCallback(
    async (beforeApply?: (tasks: Task[]) => Promise<void>) => {
      const ticket = ++generation.current;
      setLoading(true);
      const layoutChange =
        ["scope=pending", "scope=board"].includes(previousScope.current) &&
        ["scope=pending", "scope=board"].includes(scope);
      if (previousScope.current !== scope && !layoutChange) {
        setTasks([]);
        setLoaded(false);
      }
      try {
        const result = await api<{ tasks: Task[]; projects: string[] }>(
          `tasks?${scope}`,
        );
        if (ticket !== generation.current) return false;
        if (beforeApply) await beforeApply(result.tasks);
        if (ticket !== generation.current) return false;
        setTasks(result.tasks);
        setProjects(result.projects);
        setLoaded(true);
        setConnectionError(false);
        setNeedsCheck(false);
        setNotice("");
        previousScope.current = scope;
        return true;
      } catch (error) {
        if (ticket === generation.current) {
          setConnectionError(true);
          setNotice((error as Error).message);
        }
        return false;
      } finally {
        if (ticket === generation.current) setLoading(false);
      }
    },
    [scope],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && !open && !quickOpen && !writeLock.current) {
        void load();
        void loadOrganization();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load, loadOrganization, open, quickOpen]);

  const openQuickAdd = useCallback(() => {
    if (writeLock.current || needsCheck || open) return;
    setQuickProject("");
    setQuickError("");
    setQuickOpen(true);
  }, [needsCheck, open]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
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
      )
        return;
      if (
        (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") &&
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
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        openQuickAdd();
      }
      if (
        event.key.toLowerCase() === "b" &&
        !organizationPage &&
        !busy &&
        !organizationSaving
      ) {
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
      if (event.key.toLowerCase() === "m" && innerWidth >= 768) {
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
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
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
  ]);

  async function mutate(
    route: string,
    data: unknown,
    origin?: "editor" | "quick" | "notes",
    beforeApply?: (tasks: Task[]) => Promise<void>,
  ) {
    if (writeLock.current || needsCheck) return false;
    writeLock.current = true;
    setBusy(true);
    setNotice("");
    setFormError("");
    setQuickError("");
    try {
      await api(route, data);
      if (origin === "editor") setOpen(false);
      if (origin === "quick") setQuickOpen(false);
      void loadOrganization();
      if (!(await load(beforeApply))) {
        setNotice("Saved. Refresh to check your tasks.");
        setNeedsCheck(true);
      }
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.uncertain) {
        setNeedsCheck(true);
        setNotice(error.message);
      }
      (origin === "editor" || origin === "notes"
        ? setFormError
        : origin === "quick"
          ? setQuickError
          : setNotice)((error as Error).message);
      return false;
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  async function toggleTask(task: Task, completed: boolean, offerUndo = true) {
    if (writeLock.current || needsCheck || organizationSaving) return;
    const started = performance.now();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setCompletion({
      uuid: task.uuid,
      checked: !completed,
      phase: "checking",
    });
    const current = document.getElementById(`complete-${task.uuid}`);
    const hadFocus = document.activeElement === current;
    const checkboxes = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-task-row] [role="checkbox"]',
      ),
    ];
    const index = checkboxes.findIndex((item) => item === current);
    const neighbor = checkboxes[index + 1] || checkboxes[index - 1];
    const saved = await mutate(
      "action",
      { uuid: task.uuid, action: completed ? "reopen" : "complete" },
      undefined,
      async (fresh) => {
        if (reducedMotion) return;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 320 - (performance.now() - started))),
        );
        const staysVisible = fresh.some(
          (item) =>
            item.uuid === task.uuid &&
            (view === "completed"
              ? item.status === "completed"
              : item.status !== "completed"),
        );
        if (!staysVisible) {
          setCompletion({
            uuid: task.uuid,
            checked: !completed,
            phase: "leaving",
          });
          await new Promise((resolve) => setTimeout(resolve, 210));
        }
      },
    );
    if (saved) {
      setTasks((prev) =>
        view === "completed"
          ? completed
            ? prev.filter((item) => item.uuid !== task.uuid)
            : prev.map((item) =>
                item.uuid === task.uuid
                  ? { ...item, status: "completed" }
                  : item,
              )
          : !completed
            ? prev.filter((item) => item.uuid !== task.uuid)
            : prev.map((item) =>
                item.uuid === task.uuid ? { ...item, status: "pending" } : item,
              ),
      );
    }
    setCompletion(undefined);
    if (saved && offerUndo) {
      setUndoTask({ task, wasCompleted: completed });
      setToastVersion((value) => value + 1);
      setToastOpen(true);
    }
    if (saved && !offerUndo)
      requestAnimationFrame(() => {
        document.getElementById(`complete-${task.uuid}`)?.focus();
      });
    if (
      hadFocus &&
      (document.activeElement === document.body ||
        document.activeElement === current)
    ) {
      requestAnimationFrame(() => {
        const target = saved
          ? document.getElementById(current?.id || "") ||
            document.getElementById(neighbor?.id || "view-title")
          : document.getElementById(current?.id || "view-title");
        if (target instanceof HTMLButtonElement && target.disabled)
          document.getElementById("view-title")?.focus();
        else target?.focus();
      });
    }
    return saved;
  }
  async function moveTask(
    task: Task,
    columnId: string,
    beforeUuid: string | null = null,
    offerUndo = true,
  ) {
    if (
      writeLock.current ||
      needsCheck ||
      loading ||
      organizationSaving ||
      organizationBlocked ||
      !organizationReady
    )
      return false;
    const board = organization.board || defaultBoard();
    const target =
      columnId === UNSECTIONED
        ? unsectionedColumn
        : board.columns.find((column) => column.id === columnId);
    if (!target) return false;
    const source = taskColumnId(task, board);
    const items = columnTasks(tasks, board, source);
    const index = items.findIndex((item) => item.uuid === task.uuid);
    const next = items[index + 1]?.uuid || null;
    if (
      source === columnId &&
      (beforeUuid === next || beforeUuid === task.uuid)
    )
      return true;
    setToastOpen(false);
    setUndoTask(undefined);
    setBoardMove({ uuid: task.uuid, columnId, beforeUuid });
    try {
      const saved = await changeOrganization({
        kind: "board",
        action: "task.move",
        revision: organization.revision,
        uuid: task.uuid,
        columnId,
        beforeUuid,
      });
      if (saved && offerUndo) {
        setUndoTask({
          task,
          wasCompleted: task.status === "completed",
          message: `Task moved to ${target.name}`,
          board: { columnId: source, beforeUuid: next },
        });
        setToastVersion((value) => value + 1);
        setToastOpen(true);
      }
      return saved;
    } finally {
      setBoardMove(undefined);
      requestAnimationFrame(() =>
        document
          .getElementById(`complete-${task.uuid}`)
          ?.focus({ preventScroll: true }),
      );
    }
  }
  function changeBoard(change: BoardChange) {
    setToastOpen(false);
    setUndoTask(undefined);
    return changeOrganization(change);
  }
  async function reloadBoard() {
    const result = await loadOrganization();
    if (result) await load();
    return result;
  }
  function openEditor(task?: Task, initial?: TaskInput) {
    if (busy || needsCheck) return;
    setSeriesUuid("");
    setEditing(task);
    setDraft(
      task
        ? {
            description: task.description,
            project: task.project || "",
            priority: task.priority || "",
            tags: task.tags,
            recur: task.recur,
            until: task.until ? taskDate(new Date(task.until)) : undefined,
            note: "",
          }
        : initial || { ...blank },
    );
    setTags((task?.tags || initial?.tags)?.join(", ") || "");
    const date = task?.due || initial?.due;
    setDue(
      date
        ? day(
            date.replace(
              /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
              "$1-$2-$3T$4:$5:$6Z",
            ),
          )
        : "",
    );
    setFormError("");
    setOpen(true);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (writeLock.current || needsCheck) return;
    if (!draft.description.trim()) {
      setFormError("Enter a task name.");
      document.getElementById("description")?.focus();
      return;
    }
    const existing =
      editing?.due ||
      draft.due?.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        "$1-$2-$3T$4:$5:$6Z",
      );
    const date = due
      ? existing && day(existing) === due
        ? new Date(existing)
        : new Date(`${due}T00:00:00`)
      : undefined;
    const task = {
      ...draft,
      description: draft.description.replace(/[\r\n]+/g, " ").trim(),
      due: date ? taskDate(date) : "",
      tags: tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    void mutate(
      editing ? "action" : "tasks",
      editing ? { uuid: editing.uuid, action: "edit", task } : task,
      "editor",
    );
  }

  const filterProjects = [
    ...new Set([
      ...projects,
      ...(organization.projects || []).map((p) => p.name),
      ...tasks.map((task) => task.project).filter((p): p is string => !!p),
    ]),
  ];
  const currentProject = filterProjects.includes(project) ? project : "";
  useEffect(() => {
    setEditingHeaderOutcome(false);
    setEditingHeaderDesc(false);
  }, [currentProject]);
  const specialPage =
    !organizationPage &&
    !activeItem &&
    !currentProject &&
    (view === "focus" || view === "later");
  const inbox =
    view === "pending" && !currentProject && !query.trim() && !activeItem;
  const viewCounts: Partial<Record<View, number>> = {
    pending: tasks.filter(
      (task) =>
        task.status !== "completed" &&
        !task.project &&
        taskGroup(task) !== "waiting",
    ).length,
    today: tasks.filter(
      (task) =>
        task.status !== "completed" &&
        ["overdue", "today"].includes(taskGroup(task)),
    ).length,
    waiting: tasks.filter((task) => taskGroup(task) === "waiting").length,
  };
  function withViewDefaults(input: TaskInput): TaskInput {
    const defaultTag =
      activeEntry?.kind === "tag" && activeItem ? activeItem.name : "";
    const mergedTags =
      defaultTag && !input.tags.includes(defaultTag)
        ? [...input.tags, defaultTag]
        : input.tags;
    return {
      ...input,
      project: input.project || currentProject,
      due: input.due || (view === "today" ? taskDate(new Date()) : ""),
      tags: mergedTags,
    };
  }
  async function createTaskInView(input: TaskInput, columnId?: string) {
    if (writeLock.current || needsCheck) return false;
    const knownUuids = new Set(tasks.map((item) => item.uuid));
    const prepared = withViewDefaults(input);
    const saved = await mutate(
      "tasks",
      prepared,
      undefined,
      columnId && columnId !== UNSECTIONED
        ? async (fresh) => {
            const created = fresh.find((item) => !knownUuids.has(item.uuid));
            if (!created) return;
            try {
              const latest = await api<Organization>("organization", {
                kind: "board",
                action: "task.move",
                revision: organization.revision,
                uuid: created.uuid,
                columnId,
                beforeUuid: null,
              });
              setOrganization(latest);
            } catch {
              /* Task is already saved; board placement will sync on next load. */
            }
          }
        : undefined,
    );
    return Boolean(saved);
  }
  const visible = tasks.filter((task) => {
    const isCompleting = completion?.uuid === task.uuid;
    if (
      view !== "completed" &&
      !activeItem &&
      task.status === "completed" &&
      !isCompleting
    ) {
      return false;
    }
    if (view === "completed" && task.status !== "completed" && !isCompleting) {
      return false;
    }
    const group =
      task.status === "completed" && view === "today"
        ? taskGroup({ ...task, status: "pending", wait: undefined })
        : taskGroup(task);
    return (
      (view !== "today" || ["overdue", "today"].includes(group)) &&
      (view !== "waiting" || group === "waiting") &&
      (!inbox || !task.project) &&
      (!currentProject || inProject(task.project, currentProject)) &&
      [task.description, task.project, ...task.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
    );
  });

  const subtasksMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    const taskByUuid = new Map(tasks.map((t) => [t.uuid, t]));
    const links = organization.subtasks || {};
    for (const [childUuid, parentUuid] of Object.entries(links)) {
      const child = taskByUuid.get(childUuid);
      const parent = taskByUuid.get(parentUuid);
      if (child && parent) {
        if (!map.has(parentUuid)) map.set(parentUuid, []);
        map.get(parentUuid)!.push(child);
      }
    }
    return map;
  }, [tasks, organization.subtasks]);

  const isSubtask = useCallback(
    (uuid: string) => {
      const parentUuid = organization.subtasks?.[uuid];
      if (!parentUuid) return false;
      return tasks.some((t) => t.uuid === parentUuid);
    },
    [tasks, organization.subtasks],
  );

  async function createSubtask(parentUuid: string, input: TaskInput) {
    if (writeLock.current || needsCheck) return false;
    const prepared = withViewDefaults(input);
    const saved = await mutate("tasks", {
      ...prepared,
      parentUuid,
    });
    return Boolean(saved);
  }

  async function unlinkSubtask(childUuid: string) {
    return changeOrganization({
      revision: organization.revision,
      kind: "subtask",
      action: "unlink",
      childUuid,
    });
  }

  const topLevelVisible = useMemo(() => {
    return visible.filter(
      (task) =>
        !isSubtask(task.uuid) ||
        (query.trim() &&
          !visible.some(
            (t) => t.uuid === organization.subtasks?.[task.uuid],
          )),
    );
  }, [visible, isSubtask, query, organization.subtasks]);

  const connectionLabel = loading
    ? "RN · Connecting"
    : needsCheck
      ? "RN · Check required"
      : connectionError
        ? "RN · Connection error"
        : loaded
          ? "RN · Connected"
          : "RN · Not connected";

  async function toggleStartTask(task: Task) {
    if (writeLock.current || needsCheck || loading || organizationSaving)
      return false;
    const started = !!task.start && task.status !== "completed";
    if (!started && organization.timing?.available === false) {
      setNotice(
        "Timer history unavailable. Refresh before starting a task. Existing timers can still be stopped.",
      );
      return false;
    }
    if (!started && energy && energy.remaining <= 0) {
      setNotice(
        `Daily energy exhausted (0/${energy.max}). Use an Elixir (+30) or rest until 06:00.`,
      );
      return false;
    }
    setToastOpen(false);
    setUndoTask(undefined);
    const saved = await mutate("action", {
      uuid: task.uuid,
      action: started ? "stop" : "start",
    });
    if (saved) {
      setUndoTask({
        task,
        wasCompleted: false,
        wasStarted: started,
        message: started ? "Task stopped" : "Task started (-5 energy)",
      });
      setToastVersion((value) => value + 1);
      setToastOpen(true);
    }
    return saved;
  }
  function restoreEnergy() {
    setToastOpen(false);
    setUndoTask(undefined);
    setNotice("");
    return changeOrganization({
      revision: organization.revision,
      kind: "energy",
      action: "elixir",
    });
  }
  async function rescheduleOverdueToToday(overdueTasks: Task[]) {
    if (writeLock.current || needsCheck || !overdueTasks.length) return;
    writeLock.current = true;
    setBusy(true);
    setNotice("");
    const todayDue = taskDate(new Date());
    try {
      for (const item of overdueTasks) {
        await api("action", {
          uuid: item.uuid,
          action: "edit",
          task: {
            description: item.description,
            project: item.project || "",
            priority: item.priority || "",
            tags: item.tags,
            recur: item.recur,
            until: item.until ? taskDate(new Date(item.until)) : undefined,
            due: todayDue,
            note: "",
          },
        });
      }
      void loadOrganization();
      if (!(await load())) {
        setNotice("Saved. Refresh to check your tasks.");
        setNeedsCheck(true);
      }
    } catch (error) {
      if (error instanceof RequestError && error.uncertain) {
        setNeedsCheck(true);
      }
      setNotice((error as Error).message);
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  const renderTask = (
    task: Task,
    extraActions?: ReactNode,
    variantOverride?: "list" | "card",
  ) => {
    const variant: "list" | "card" =
      variantOverride ??
      (!specialPage && layout === "board" ? "card" : "list");
    return (
      <TaskRow
        key={task.uuid}
        task={task}
        extraActions={extraActions}
        variant={variant}
        showProject={!currentProject && !specialPage}
        projects={filterProjects}
        availableLabels={organization.tags}
        completed={task.status === "completed"}
        overdue={taskGroup(task) === "overdue"}
        disabled={
          busy || organizationSaving || needsCheck || (loading && !loaded)
        }
        transition={completion?.uuid === task.uuid ? completion : undefined}
        trackedSeconds={taskTrackedSeconds(task)}
        timingUnavailable={organization.timing?.available === false}
        subtasks={subtasksMap.get(task.uuid) || []}
        isSubtask={isSubtask(task.uuid)}
        onAddSubtask={(subtaskInput) => createSubtask(task.uuid, subtaskInput)}
        onUnlinkSubtask={() => unlinkSubtask(task.uuid)}
        onToggleSubtask={(child, completed) => void toggleTask(child, completed)}
        onEditSubtask={(child) => openEditor(child)}
        renderSubtask={(child) => renderTask(child, undefined, variant)}
        onToggleStart={
        task.status !== "completed"
          ? () => void toggleStartTask(task)
          : undefined
      }
      onSaveInline={
        task.status !== "completed"
          ? (nextTask) =>
              mutate("action", {
                uuid: task.uuid,
                action: "edit",
                task: nextTask,
              })
          : undefined
      }
      onDueChange={
        task.status !== "completed"
          ? (nextDue) => {
              const date = nextDue
                ? new Date(`${nextDue}T00:00:00`)
                : undefined;
              void mutate("action", {
                uuid: task.uuid,
                action: "edit",
                task: {
                  description: task.description,
                  project: task.project || "",
                  priority: task.priority || "",
                  tags: task.tags,
                  recur: task.recur,
                  until: task.until
                    ? taskDate(new Date(task.until))
                    : undefined,
                  due: date ? taskDate(date) : "",
                  note: "",
                },
              });
            }
          : undefined
      }
      onPriorityChange={
        task.status !== "completed"
          ? (nextPriority) => {
              void mutate("action", {
                uuid: task.uuid,
                action: "edit",
                task: {
                  description: task.description,
                  project: task.project || "",
                  priority: nextPriority,
                  tags: task.tags,
                  recur: task.recur,
                  until: task.until
                    ? taskDate(new Date(task.until))
                    : undefined,
                  due: task.due
                    ? taskDate(
                        new Date(
                          task.due.replace(
                            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
                            "$1-$2-$3T$4:$5:$6Z",
                          ),
                        ),
                      )
                    : "",
                  note: "",
                },
              });
            }
          : undefined
      }
      onDelete={() => {
        void mutate("action", {
          uuid: task.uuid,
          action: "delete",
        }).then((saved) => {
          if (saved) {
            setUndoTask({
              task,
              wasCompleted: task.status === "completed",
              wasDeleted: true,
              message: "Task deleted",
            });
            setToastVersion((value) => value + 1);
            setToastOpen(true);
          }
        });
      }}
      onEdit={() => openEditor(task)}
      onComplete={() => void toggleTask(task, task.status === "completed")}
    />
  );
};

  const currentProjectRecord = organization.projects?.find(
    (item) => item.name === currentProject,
  );
  const projectDescription = currentProjectRecord?.description;
  const projectOutcome = currentProjectRecord?.outcome;
  function editProject(name: string) {
    setOrganizationError("");
    setNewProjectParent("");
    setEditingProject(name);
    if (innerWidth < 768) setNavOpen(false);
  }
  function addSubproject(parent: string) {
    editProject("");
    setNewProjectParent(parent);
  }
  function transition(name: string, status: ProjectStatus) {
    setOrganizationError("");
    if (innerWidth < 768) setNavOpen(false);
    if (status === "later") {
      void changeOrganization({
        revision: organization.revision,
        kind: "project",
        action: "status",
        name,
        status: "later",
      });
      return;
    }
    if (status === "active") {
      const record = organization.projects?.find((p) => p.name === name);
      const active = (organization.projects || []).filter(
        (item) => item.name !== name && projectStatus(item) === "active",
      );
      const overlaps = active.filter(
        (item) => inProject(item.name, name) || inProject(name, item.name),
      );
      if (
        record?.outcome?.trim() &&
        active.length < FOCUS_LIMIT &&
        overlaps.length === 0
      ) {
        void changeOrganization({
          revision: organization.revision,
          kind: "project",
          action: "status",
          name,
          status: "active",
          outcome: record.outcome,
        }).then((saved) => {
          if (saved) setFocusPickerOpen(false);
        });
        return;
      }
    }
    setTransitionProject({ name, status });
  }
  function deleteProject(name: string) {
    setOrganizationError("");
    setDeletingProject({ name, revision: organization.revision });
    if (innerWidth < 768) setNavOpen(false);
  }

  return (
    <ProjectColorsProvider projects={organization.projects || []}>
      <WorkspaceSidebar
        navOpen={navOpen}
        onOpenChange={setNavigation}
        view={view}
        currentProject={currentProject}
        organizationPage={organizationPage}
        projectsPage={projectsPage}
        organization={organization}
        activeEntry={activeEntry}
        hasActiveItem={!!activeItem}
        projects={filterProjects}
        viewCounts={viewCounts}
        busy={busy}
        needsCheck={needsCheck}
        organizationSaving={
          organizationSaving ||
          !organizationReady ||
          organizationBlocked ||
          needsCheck
        }
        onRecovery={() => setRecoveryOpen(true)}
        onAddSubproject={addSubproject}
        onAddProject={() => editProject("")}
        onEditProject={editProject}
        onDeleteProject={deleteProject}
        onProjectStatus={transition}
        onProjects={() => {
          setProjectsPage(true);
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setProject("");
        }}
        connectionLabel={connectionLabel}
        energy={energy}
        timingUnavailable={organization.timing?.available === false}
        onRetryTiming={() => void loadOrganization()}
        onElixir={() => void restoreEnergy()}
        onAdd={openQuickAdd}
        onEntry={openEntry}
        onView={(value) => {
          openTaskView();
          setView(value);
          setProject("");
          setQuery("");
        }}
        onProject={(name) => {
          openTaskView();
          setProject(name);
          setView("pending");
          setQuery("");
        }}
        onOrganization={() => {
          setProjectsPage(false);
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setProject("");
        }}
      />
      <div className="workspace-main min-h-dvh" data-sidebar-open={navOpen}>
        <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-md">
          <div className="workspace-frame flex h-12 items-center justify-between">
            <div className="flex items-center gap-2">
              {!navOpen && (
                <Button
                  id="sidebar-toggle"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show sidebar"
                  title="Show sidebar"
                  aria-expanded={false}
                  onClick={() => setNavigation(true)}
                  className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <PanelLeft className="size-[18px]" strokeWidth={1.6} />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Quick find (⌘K)"
                aria-keyshortcuts="Meta+K Control+K"
                disabled={busy || organizationSaving}
                onClick={() => setCommandOpen(true)}
                className="group/search hidden h-8 w-44 items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors hover:border-ring/40 hover:bg-muted/70 hover:text-foreground sm:inline-flex md:w-52"
              >
                <span className="flex items-center gap-2">
                  <Search className="size-3.5 text-muted-foreground/75 transition-colors group-hover/search:text-foreground" />
                  <span className="font-normal">Quick find</span>
                </span>
                <kbd className="rounded border border-border/70 bg-background/80 px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground/80 shadow-2xs">
                  ⌘K
                </kbd>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Quick add task (Q)"
                title="Quick add task (Q)"
                disabled={busy || needsCheck}
                onClick={openQuickAdd}
                className="size-8 text-primary hover:bg-accent"
              >
                <Plus className="size-5" strokeWidth={1.75} />
              </Button>
              <ThemeSwitcher />
              <Button
                variant="ghost"
                size="icon-sm"
                id="search-toggle"
                aria-label={
                  searchOpen || query ? "Close search" : "Open search"
                }
                aria-expanded={!!(searchOpen || query)}
                aria-controls="task-search"
                aria-keyshortcuts="/"
                onClick={() => {
                  if (organizationPage) setOrganizationPage(false);
                  if (view === "focus" || view === "later") setView("pending");
                  if (searchOpen || query) {
                    setSearchOpen(false);
                    setQuery("");
                  } else setSearchOpen(true);
                }}
                className="sm:hidden text-muted-foreground hover:text-foreground"
              >
                <Search className="size-[18px]" strokeWidth={1.5} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh tasks"
                disabled={loading || busy}
                onClick={() => {
                  void load();
                  void loadOrganization();
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCw
                  className={cn("size-[17px]", loading && "animate-spin")}
                  strokeWidth={1.5}
                />
              </Button>
            </div>
          </div>
        </header>
        <main
          className={cn(
            "workspace-frame min-w-0 pt-6 pb-24 md:pb-16",
            layout === "list" && "max-w-4xl",
          )}
        >
          <Tabs
            value={layout}
            onValueChange={(value) => {
              if (value !== "list" && value !== "board") return;
              setLayout(value);
              try {
                localStorage.setItem("aster.task-layout", value);
              } catch {
                /* Layout still works without browser storage. */
              }
            }}
            className="gap-0"
          >
            {currentProject && projectParent(currentProject) && (
              <nav
                aria-label="Project parents"
                className="mb-2 flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-muted-foreground"
              >
                {projectParent(currentProject)
                  .split(".")
                  .map((part, index, parts) => (
                    <Button
                      key={index}
                      variant="ghost"
                      className="h-6 shrink-0 px-1 text-xs font-normal"
                      onClick={() => {
                        setProject(parts.slice(0, index + 1).join("."));
                        setQuery("");
                      }}
                    >
                      {part}
                      <span aria-hidden className="ml-1 opacity-50">
                        /
                      </span>
                    </Button>
                  ))}
              </nav>
            )}
            <div
              data-workspace-heading
              className="mb-6 flex min-h-10 items-center justify-between gap-4"
            >
              <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-2.5">
                  {currentProject && !organizationPage && !activeItem && (
                    <ProjectIcon
                      name={currentProject}
                      className="size-5 shrink-0"
                    />
                  )}
                  <h1
                    title={
                      currentProject ? projectPath(currentProject) : undefined
                    }
                    id="view-title"
                    tabIndex={-1}
                    className="min-w-0 truncate text-2xl leading-8 font-bold tracking-[-0.5px] outline-none"
                  >
                    {organizationPage
                      ? projectsPage
                        ? "Projects"
                        : "Filters & labels"
                      : activeItem?.name ||
                        (currentProject
                          ? projectLeaf(currentProject)
                          : views[view])}
                  </h1>
                  {view === "today" && !currentProject && !organizationPage && !activeItem && (
                    <span className="text-xs font-semibold text-muted-foreground/80 tabular-nums">
                      {viewCounts?.today ?? 0}
                    </span>
                  )}
                  {view === "pending" && !currentProject && !organizationPage && !activeItem && (
                    <span className="text-xs font-semibold text-muted-foreground/80 tabular-nums">
                      {viewCounts?.pending ?? 0}
                    </span>
                  )}
                  {currentProject && !organizationPage && !activeItem && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={busy || organizationSaving}
                      onClick={() =>
                        transition(
                          focusProject(currentProject, organization.projects)
                            ?.name || currentProject,
                          focusProject(currentProject, organization.projects)
                            ? "later"
                            : "active",
                        )
                      }
                      className={cn(
                        "h-6 shrink-0 gap-1 rounded-full border px-2.5 text-[11px] font-medium",
                        focusProject(currentProject, organization.projects)
                          ? "border-primary/25 bg-primary/8 text-foreground hover:bg-primary/14"
                          : "border-border text-muted-foreground hover:bg-(--row-hover) hover:text-foreground",
                      )}
                    >
                      {focusProject(currentProject, organization.projects) ? (
                        <>
                          <Target className="size-3" strokeWidth={1.8} />
                          Focus
                        </>
                      ) : (
                        "Later"
                      )}
                    </Button>
                  )}
                </div>
                {view === "today" && !currentProject && !organizationPage && !activeItem && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {format(now, "EEE, MMM d")}
                  </p>
                )}
              </div>
              {!organizationPage && !specialPage && (
                <div className="flex shrink-0 items-center gap-2">
                  <TabsList
                    aria-label="Task layout"
                    className="h-8 group-data-[orientation=horizontal]/tabs:h-8"
                  >
                    <TabsTrigger
                      value="list"
                      aria-label="List view"
                      aria-keyshortcuts="B"
                      disabled={busy || organizationSaving}
                      className="gap-1.5 px-2 text-xs"
                    >
                      <List className="size-3.5" />
                      <span className="hidden sm:inline">List</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="board"
                      aria-label="Board view"
                      aria-keyshortcuts="B"
                      disabled={busy || organizationSaving}
                      className="gap-1.5 px-2 text-xs"
                    >
                      <Columns3 className="size-3.5" />
                      <span className="hidden sm:inline">Board</span>
                    </TabsTrigger>
                  </TabsList>
                  <Popover open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || organizationSaving}
                        aria-label="View options"
                        className="text-muted-foreground data-[state=open]:bg-accent"
                      >
                        <Ellipsis className="size-5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-44 p-1">
                      {currentProject && !activeItem && (
                        <>
                          <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={busy || organizationSaving}
                            onClick={() => {
                              setViewMenuOpen(false);
                              transition(
                                focusProject(
                                  currentProject,
                                  organization.projects,
                                )?.name || currentProject,
                                focusProject(
                                  currentProject,
                                  organization.projects,
                                )
                                  ? "later"
                                  : "active",
                              );
                            }}
                          >
                            {focusProject(
                              currentProject,
                              organization.projects,
                            ) ? (
                              <>
                                <Pause className="size-3.5" />
                                Pause project
                              </>
                            ) : (
                              <>
                                <Play className="size-3.5" />
                                Add to Focus
                              </>
                            )}
                          </Button>
                          <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={busy || organizationSaving}
                            onClick={() => {
                              setViewMenuOpen(false);
                              transition(
                                focusProject(
                                  currentProject,
                                  organization.projects,
                                )?.name || currentProject,
                                "completed",
                              );
                            }}
                          >
                            <Check className="size-3.5" />
                            Complete project
                          </Button>
                          <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            onClick={() => {
                              setViewMenuOpen(false);
                              addSubproject(currentProject);
                            }}
                          >
                            <Plus className="size-3.5" />
                            Add subproject
                          </Button>
                          <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            onClick={() => {
                              setViewMenuOpen(false);
                              setHeaderDescDraft(projectDescription || "");
                              setEditingHeaderDesc(true);
                            }}
                          >
                            <FileText className="size-3.5" />
                            {projectDescription
                              ? "Edit description"
                              : "Add description"}
                          </Button>
                          <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            onClick={() => {
                              setViewMenuOpen(false);
                              setHeaderOutcomeDraft(projectOutcome || "");
                              setEditingHeaderOutcome(true);
                            }}
                          >
                            <Target className="size-3.5" />
                            {projectOutcome
                              ? "Edit finish line"
                              : "Set finish line"}
                          </Button>
                          <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            onClick={() => {
                              setViewMenuOpen(false);
                              editProject(currentProject);
                            }}
                          >
                            <Pencil className="size-3.5" />
                            Edit project
                          </Button>
                          <Button
                            variant="navigation"
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            className="h-8 text-xs text-destructive"
                            onClick={() => {
                              setViewMenuOpen(false);
                              deleteProject(currentProject);
                            }}
                          >
                            <Trash2 className="size-3.5" />
                            Delete project
                          </Button>
                        </>
                      )}
                      {activeItem && (
                        <Button
                          variant="navigation"
                          className="h-8 text-xs"
                          onClick={() => {
                            setViewMenuOpen(false);
                            setProjectsPage(false);
                            setOrganizationPage(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                          Manage{" "}
                          {activeEntry?.kind === "filter"
                            ? "filters"
                            : "labels"}
                        </Button>
                      )}
                      {!currentProject &&
                        !activeItem &&
                        (Object.entries(views) as [View, string][]).map(
                          ([key, label]) => (
                            <Button
                              key={key}
                              variant="navigation"
                              aria-current={
                                view === key && !currentProject
                                  ? "page"
                                  : undefined
                              }
                              className="h-8 text-xs"
                              onClick={() => {
                                openTaskView();
                                setView(key);
                                setViewMenuOpen(false);
                                setProject("");
                                setQuery("");
                              }}
                            >
                              <Check
                                className={cn(
                                  "size-3.5",
                                  (view !== key || currentProject) &&
                                    "invisible",
                                )}
                              />
                              {label}
                            </Button>
                          ),
                        )}
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
            {specialPage && view === "focus" ? (
              <FocusOverview
                data={organization}
                tasks={tasks}
                loading={!organizationReady || (loading && !loaded)}
                disabled={
                  busy ||
                  organizationSaving ||
                  !organizationReady ||
                  organizationBlocked ||
                  needsCheck
                }
                error={organizationError || notice}
                onChooseProject={() => setFocusPickerOpen(true)}
                onPause={(name) => transition(name, "later")}
                onComplete={(name) => transition(name, "completed")}
                onOpen={(name) => {
                  openTaskView();
                  setView("pending");
                  setProject(name);
                  setQuery("");
                }}
                onEdit={editProject}
                onSelectNext={(projectName, taskUuid) => {
                  const current = organization.projects?.find(
                    (item) => item.name === projectName,
                  );
                  void changeOrganization({
                    kind: "project",
                    action: "save",
                    revision: organization.revision,
                    originalName: projectName,
                    item: {
                      name: projectName,
                      description: current?.description || "",
                      outcome: current?.outcome,
                      nextTask: taskUuid,
                      color: current?.color,
                    },
                  });
                }}
                onUpdateOutcome={(projectName, outcome) => {
                  const current = organization.projects?.find(
                    (item) => item.name === projectName,
                  );
                  return changeOrganization({
                    kind: "project",
                    action: "save",
                    revision: organization.revision,
                    originalName: projectName,
                    item: {
                      name: projectName,
                      description: current?.description || "",
                      outcome,
                      nextTask: current?.nextTask || "",
                      color: current?.color,
                    },
                  });
                }}
                onAddTask={(name, initial) => {
                  if (writeLock.current || needsCheck || open) return;
                  if (initial) {
                    openEditor(undefined, {
                      ...initial,
                      project: initial.project || name,
                    });
                    return;
                  }
                  setQuickProject(name);
                  setQuickError("");
                  setQuickOpen(true);
                }}
                onCreateTask={async (task, projectName) => {
                  if (writeLock.current || needsCheck) return false;
                  const result = await mutate("tasks", {
                    ...task,
                    project: task.project || projectName,
                  });
                  return Boolean(result);
                }}
                renderTask={renderTask}
              />
            ) : specialPage && view === "later" ? (
              <ProjectManager
                mode="later"
                data={organization}
                projects={filterProjects}
                loading={!organizationReady}
                disabled={
                  busy ||
                  organizationSaving ||
                  !organizationReady ||
                  organizationBlocked ||
                  needsCheck
                }
                error={organizationError}
                onAdd={() => editProject("")}
                onAddChild={addSubproject}
                onEdit={editProject}
                onDelete={deleteProject}
                onStatus={transition}
                onOpen={(name) => {
                  openTaskView();
                  setProject(name);
                  setView("pending");
                  setQuery("");
                }}
                onReload={() => {
                  void loadOrganization();
                  void load();
                }}
              />
            ) : organizationPage ? (
              projectsPage ? (
                <ProjectManager
                  data={organization}
                  onStatus={transition}
                  projects={filterProjects}
                  loading={!organizationReady}
                  disabled={
                    busy ||
                    organizationSaving ||
                    !organizationReady ||
                    organizationBlocked ||
                    needsCheck
                  }
                  error={organizationError}
                  onAdd={() => editProject("")}
                  onAddChild={addSubproject}
                  onEdit={editProject}
                  onDelete={deleteProject}
                  onOpen={(name) => {
                    openTaskView();
                    setProject(name);
                    setView("pending");
                    setQuery("");
                  }}
                  onReload={() => {
                    void loadOrganization();
                    void load();
                  }}
                />
              ) : (
                <OrganizationManager
                  data={organization}
                  error={organizationError}
                  busy={busy || organizationSaving}
                  loading={!organizationReady && !organizationError}
                  blocked={
                    !organizationReady || organizationBlocked || needsCheck
                  }
                  onChange={changeOrganization}
                  onOpen={openEntry}
                  onReload={async () => {
                    const result = await loadOrganization();
                    if (result) await load();
                    return result;
                  }}
                />
              )
            ) : (
              <>
                {!!currentProject && !activeItem && (
                  <div className="-mt-3 mb-6 space-y-1.5">
                    {/* Finish Line / Target */}
                    {(projectOutcome ||
                      focusProject(currentProject, organization.projects) ||
                      editingHeaderOutcome) &&
                      (editingHeaderOutcome ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const next = headerOutcomeDraft.trim();
                            setEditingHeaderOutcome(false);
                            if (next === (projectOutcome || "").trim()) return;
                            if (
                              focusProject(
                                currentProject,
                                organization.projects,
                              ) &&
                              !next
                            )
                              return;
                            void changeOrganization({
                              kind: "project",
                              action: "save",
                              revision: organization.revision,
                              originalName: currentProject,
                              item: {
                                name: currentProject,
                                description: projectDescription || "",
                                outcome: next,
                                nextTask: currentProjectRecord?.nextTask || "",
                                color: currentProjectRecord?.color,
                              },
                            });
                          }}
                          className="flex items-center gap-2 rounded-lg border border-border/80 bg-background px-2.5 py-1 shadow-2xs focus-within:border-primary/60"
                        >
                          <Target
                            className="size-3.5 shrink-0 text-muted-foreground"
                            strokeWidth={1.8}
                          />
                          <input
                            type="text"
                            autoFocus
                            value={headerOutcomeDraft}
                            maxLength={500}
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            placeholder="What result makes this project complete?"
                            onChange={(event) =>
                              setHeaderOutcomeDraft(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setEditingHeaderOutcome(false);
                              }
                            }}
                            className="min-w-0 flex-1 bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                          />
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditingHeaderOutcome(false)}
                              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </Button>
                            <Button type="submit" size="xs" className="h-6 px-2.5 text-xs">
                              Save
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="group/target -ml-2.5 flex items-start gap-1.5 rounded-lg px-2.5 py-0.5 text-sm leading-6 text-foreground/85 transition-colors hover:bg-(--row-hover)">
                          <Target
                            className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                            strokeWidth={1.8}
                          />
                          <div
                            onClick={() => {
                              setHeaderOutcomeDraft(projectOutcome || "");
                              setEditingHeaderOutcome(true);
                            }}
                            className="min-w-0 flex-1 cursor-pointer transition-colors hover:text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap select-text"
                          >
                            {projectOutcome || (
                              <span className="italic text-muted-foreground/60">
                                Set finish line
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={
                              busy || organizationSaving || !organizationReady
                            }
                            onClick={() => {
                              setHeaderOutcomeDraft(projectOutcome || "");
                              setEditingHeaderOutcome(true);
                            }}
                            className="size-6 shrink-0 opacity-0 transition-opacity group-hover/target:opacity-100 hover:bg-muted"
                            aria-label="Edit finish line"
                            title="Edit finish line"
                          >
                            <Pencil className="size-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}

                    {/* Project Description */}
                    {editingHeaderDesc ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const next = headerDescDraft.trim();
                          setEditingHeaderDesc(false);
                          if (next === (projectDescription || "").trim())
                            return;
                          void changeOrganization({
                            kind: "project",
                            action: "save",
                            revision: organization.revision,
                            originalName: currentProject,
                            item: {
                              name: currentProject,
                              description: next,
                              outcome: projectOutcome,
                              nextTask: currentProjectRecord?.nextTask || "",
                              color: currentProjectRecord?.color,
                            },
                          });
                        }}
                        className="space-y-1.5 rounded-lg border border-border/80 bg-background p-2.5 shadow-2xs focus-within:border-primary/60"
                      >
                        <textarea
                          autoFocus
                          rows={3}
                          ref={(el) => {
                            if (el) {
                              el.style.height = "auto";
                              el.style.height = `${Math.max(72, el.scrollHeight)}px`;
                            }
                          }}
                          value={headerDescDraft}
                          maxLength={2000}
                          disabled={
                            busy || organizationSaving || !organizationReady
                          }
                          placeholder="Add project notes, background or description…"
                          onInput={(event) => {
                            const el = event.currentTarget;
                            el.style.height = "auto";
                            el.style.height = `${Math.max(72, el.scrollHeight)}px`;
                          }}
                          onChange={(event) =>
                            setHeaderDescDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setEditingHeaderDesc(false);
                            } else if (
                              event.key === "Enter" &&
                              (event.metaKey || event.ctrlKey)
                            ) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                          className="w-full resize-y bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
                        />
                        <div className="flex items-center justify-between pt-0.5">
                          <span className="text-[11px] text-muted-foreground/60">
                            ⌘ Enter to save · Esc to cancel
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditingHeaderDesc(false)}
                              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </Button>
                            <Button type="submit" size="xs" className="h-6 px-2.5 text-xs">
                              Save
                            </Button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <div className="group/desc -ml-2.5 flex items-start gap-2 rounded-lg px-2.5 py-0.5 transition-colors hover:bg-(--row-hover)">
                        <div
                          onClick={() => {
                            setHeaderDescDraft(projectDescription || "");
                            setEditingHeaderDesc(true);
                          }}
                          className="min-w-0 flex-1 cursor-pointer text-sm leading-relaxed text-muted-foreground transition-colors hover:text-foreground/90 [overflow-wrap:anywhere] whitespace-pre-wrap select-text"
                        >
                          {projectDescription || (
                            <span className="italic text-muted-foreground/60">
                              + Add project notes or description…
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={
                            busy || organizationSaving || !organizationReady
                          }
                          onClick={() => {
                            setHeaderDescDraft(projectDescription || "");
                            setEditingHeaderDesc(true);
                          }}
                          className="size-6 shrink-0 opacity-0 transition-opacity group-hover/desc:opacity-100 hover:bg-muted"
                          aria-label="Edit description"
                          title="Edit description"
                        >
                          <Pencil className="size-3 text-muted-foreground" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {activeEntry?.kind === "filter" &&
                  (activeItem as SavedFilter)?.description && (
                    <p className="-mt-3 mb-6 text-sm leading-6 text-muted-foreground">
                      {(activeItem as SavedFilter).description}
                    </p>
                  )}
                {(searchOpen || query) && (
                  <div className="mb-6 flex items-center gap-2">
                    <InputGroup className="min-w-0 flex-1 shadow-none">
                      <InputGroupAddon>
                        <Search className="size-4" />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="task-search"
                        aria-label="Search tasks"
                        placeholder="Search"
                        inputMode="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setQuery("");
                            setSearchOpen(false);
                            document.getElementById("search-toggle")?.focus();
                          }
                        }}
                      />
                      {query && (
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            aria-label="Clear search"
                            size="icon-sm"
                            onClick={() => {
                              setQuery("");
                              document.getElementById("task-search")?.focus();
                            }}
                          >
                            <X />
                          </InputGroupButton>
                        </InputGroupAddon>
                      )}
                    </InputGroup>
                    <Select
                      value={
                        currentProject ? `project:${currentProject}` : "all"
                      }
                      onValueChange={(value) =>
                        setProject(value === "all" ? "" : value.slice(8))
                      }
                    >
                      <SelectTrigger
                        aria-label="Filter projects"
                        className="h-9 w-32 shrink-0 shadow-none data-[size=default]:h-9"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All projects</SelectItem>
                        {filterProjects.map((name) => (
                          <SelectItem key={name} value={`project:${name}`}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {notice && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                      {notice}
                      {energy &&
                      energy.remaining <= 0 &&
                      /energy exhausted/i.test(notice) ? (
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => void restoreEnergy()}
                          disabled={loading || busy || organizationSaving}
                          className="h-auto p-0 text-current"
                        >
                          Restore +30 energy
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => {
                            void load();
                            void loadOrganization();
                          }}
                          disabled={loading || busy}
                          className="h-auto p-0 text-current"
                        >
                          {needsCheck ? "Refresh and check" : "Reconnect"}
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                <TabsContent value="list" className="mt-0 min-w-0">
                  <Suspense
                    fallback={
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner className="size-4" />
                        Loading groups…
                      </div>
                    }
                  >
                    <TaskBoard
                      layout="list"
                      initialScrollLeft={boardScroll.current}
                      onScrollPositionChange={(position) => {
                        boardScroll.current = position;
                      }}
                      tasks={topLevelVisible}
                      board={organization.board || defaultBoard()}
                      revision={organization.revision}
                      saving={organizationSaving}
                      blocked={
                        organizationBlocked || needsCheck || !organizationReady
                      }
                      error={organizationError}
                      onChange={changeBoard}
                      onReload={reloadBoard}
                      onClearError={() => setOrganizationError("")}
                      loading={loading}
                      loaded={loaded}
                      disabled={
                        busy ||
                        needsCheck ||
                        organizationSaving ||
                        loading ||
                        organizationBlocked ||
                        !organizationReady
                      }
                      moving={boardMove}
                      renderTask={renderTask}
                      onMove={moveTask}
                      onCreateTask={createTaskInView}
                      projects={filterProjects}
                      availableLabels={organization.tags}
                      project={currentProject}
                      defaultProject={currentProject}
                      defaultDue={view === "today" ? taskDate(new Date()) : ""}
                      todaySplit={
                        view === "today" && !query.trim() && !activeItem
                      }
                      onRescheduleOverdue={rescheduleOverdueToToday}
                      onAdd={(initial) =>
                        initial
                          ? openEditor(undefined, withViewDefaults(initial))
                          : openQuickAdd()
                      }
                      canAddTask={view !== "completed"}
                      canAddSection={
                        !!currentProject || (!specialPage && view === "pending")
                      }
                      hasSearch={!!query.trim()}
                      onClearSearch={() => {
                        setQuery("");
                        setSearchOpen(false);
                      }}
                    />
                  </Suspense>
                </TabsContent>
                <TabsContent value="board" className="mt-0 min-w-0">
                  <Suspense
                    fallback={
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner className="size-4" />
                        Loading board…
                      </div>
                    }
                  >
                    <TaskBoard
                      initialScrollLeft={boardScroll.current}
                      onScrollPositionChange={(position) => {
                        boardScroll.current = position;
                      }}
                      tasks={topLevelVisible}
                      board={organization.board || defaultBoard()}
                      revision={organization.revision}
                      saving={organizationSaving}
                      blocked={
                        organizationBlocked || needsCheck || !organizationReady
                      }
                      error={organizationError}
                      onChange={changeBoard}
                      onReload={reloadBoard}
                      onClearError={() => setOrganizationError("")}
                      loading={loading}
                      loaded={loaded}
                      disabled={
                        busy ||
                        needsCheck ||
                        organizationSaving ||
                        loading ||
                        organizationBlocked ||
                        !organizationReady
                      }
                      moving={boardMove}
                      renderTask={renderTask}
                      onMove={moveTask}
                      onCreateTask={createTaskInView}
                      projects={filterProjects}
                      availableLabels={organization.tags}
                      project={currentProject}
                      defaultProject={currentProject}
                      defaultDue={view === "today" ? taskDate(new Date()) : ""}
                      onAdd={(initial) =>
                        initial
                          ? openEditor(undefined, withViewDefaults(initial))
                          : openQuickAdd()
                      }
                      canAddTask={view !== "completed"}
                      canAddSection={
                        !!currentProject || (!specialPage && view === "pending")
                      }
                      hasSearch={!!query.trim()}
                      onClearSearch={() => {
                        setQuery("");
                        setSearchOpen(false);
                      }}
                    />
                  </Suspense>
                </TabsContent>
              </>
            )}
          </Tabs>
        </main>
        <Button
          onClick={openQuickAdd}
          disabled={busy || needsCheck}
          aria-label="Quick add task"
          className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] size-12 rounded-full p-0 shadow-lg md:hidden"
        >
          <Plus className="size-6" strokeWidth={1.8} />
        </Button>
      </div>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        tasks={tasks}
        projects={filterProjects}
        organization={organization}
        currentProject={currentProject}
        layout={layout}
        onAddTask={openQuickAdd}
        onAddProject={() => editProject("")}
        onFocusPicker={() => {
          setOrganizationError("");
          setFocusPickerOpen(true);
        }}
        onToggleLayout={() => {
          setLayout((current) => {
            const next = current === "list" ? "board" : "list";
            try {
              localStorage.setItem("aster.task-layout", next);
            } catch {
              /* Layout still works without browser storage. */
            }
            return next;
          });
        }}
        onView={(value) => {
          openTaskView();
          setView(value);
          setProject("");
          setQuery("");
        }}
        onProject={(name) => {
          openTaskView();
          setProject(name);
          setView("pending");
          setQuery("");
        }}
        onEditProject={editProject}
        onProjectStatus={transition}
        onEntry={openEntry}
        onOrganization={() => {
          setProjectsPage(false);
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setProject("");
        }}
        onRecovery={() => setRecoveryOpen(true)}
        onEditTask={(task) => openEditor(task)}
      />

      <QuickAdd
        open={quickOpen}
        projects={filterProjects}
        availableLabels={organization.tags}
        defaultProject={quickProject || currentProject}
        busy={busy}
        blocked={needsCheck}
        error={quickError}
        onClearError={() => setQuickError("")}
        onCheck={() => {
          setQuickOpen(false);
          setQuickProject("");
        }}
        onOpenChange={(value) => {
          if (!writeLock.current) {
            setQuickOpen(value);
            if (!value) setQuickProject("");
          }
        }}
        onAdd={async (task) => {
          const prepared = withViewDefaults(task);
          const saved = await mutate("tasks", prepared, "quick");
          if (saved) {
            setQuickProject("");
            setAddedProject(prepared.project || "");
            setUndoTask(undefined);
            setToastVersion((value) => value + 1);
            setToastOpen(true);
          }
          return saved;
        }}
        onEdit={(task) => {
          setQuickOpen(false);
          setQuickProject("");
          openEditor(undefined, withViewDefaults(task));
        }}
      />

      <TaskToast
        key={toastVersion}
        open={toastOpen}
        onOpenChange={setToastOpen}
        message={
          undoTask ? (
            undoTask.message ? (
              undoTask.message
            ) : undoTask.wasCompleted ? (
              "Task reopened"
            ) : (
              "Task completed"
            )
          ) : (
            <>
              Task added to{" "}
              <span className="underline underline-offset-2">
                {addedProject || "Inbox"}
              </span>
            </>
          )
        }
        actionLabel={undoTask ? "Undo" : "Open"}
        actionDescription={undoTask ? "Undo task change" : "View task location"}
        disabled={busy || needsCheck || organizationSaving || loading}
        onAction={() => {
          if (undoTask) {
            setToastOpen(false);
            if (undoTask.wasDeleted)
              void mutate("action", {
                uuid: undoTask.task.uuid,
                action: "restore",
              });
            else if (undoTask.board)
              void moveTask(
                undoTask.task,
                undoTask.board.columnId,
                undoTask.board.beforeUuid,
                false,
              );
            else if (undoTask.wasStarted !== undefined)
              void mutate("action", {
                uuid: undoTask.task.uuid,
                action: undoTask.wasStarted ? "start" : "stop",
              });
            else void toggleTask(undoTask.task, !undoTask.wasCompleted, false);
            return;
          }
          openTaskView();
          setView("pending");
          setProject(addedProject);
          setQuery("");
          requestAnimationFrame(() =>
            document.getElementById("view-title")?.focus(),
          );
        }}
      />

      {editingProject !== undefined && (
        <ProjectEditor
          project={editingProject}
          projects={projectNames(filterProjects)}
          initialParent={newProjectParent || undefined}
          color={
            organization.projects?.find((item) => item.name === editingProject)
              ?.color
          }
          description={
            organization.projects?.find((item) => item.name === editingProject)
              ?.description || ""
          }
          outcome={
            organization.projects?.find((item) => item.name === editingProject)
              ?.outcome || ""
          }
          nextTask={
            organization.projects?.find((item) => item.name === editingProject)
              ?.nextTask || ""
          }
          revision={organization.revision}
          busy={organizationSaving}
          blocked={!organizationReady || organizationBlocked || needsCheck}
          error={organizationError}
          onClose={() => setEditingProject(undefined)}
          onReload={async () => {
            const latest = await loadOrganization();
            if (latest) await load();
            return latest;
          }}
          onSave={async (
            name,
            description,
            revision,
            outcome,
            nextTask,
            color,
          ) => {
            const isNew = !editingProject;
            const saved = await changeOrganization({
              kind: "project",
              action: "save",
              revision,
              originalName: editingProject,
              item: {
                name,
                description,
                outcome,
                nextTask,
                color,
              },
            });
            if (saved && isNew && !organizationPage) {
              openTaskView();
              setView("pending");
              setProject(name);
              setQuery("");
            }
            return saved;
          }}
        />
      )}
      {focusPickerOpen && !transitionProject && (
        <FocusPicker
          data={organization}
          busy={organizationSaving}
          error={organizationError}
          onClose={() => setFocusPickerOpen(false)}
          onChoose={(name) => transition(name, "active")}
          onCreateAndFocus={async (name, outcome, replaceProject) => {
            if (writeLock.current || organizationBlocked || needsCheck)
              return false;
            writeLock.current = true;
            setOrganizationSaving(true);
            setOrganizationError("");
            organizationGeneration.current++;
            try {
              const created = await api<Organization>("organization", {
                kind: "project",
                action: "save",
                revision: organization.revision,
                item: {
                  name,
                  description: "",
                  outcome,
                  nextTask: "",
                },
              });
              const activated = await api<Organization>("organization", {
                kind: "project",
                action: "status",
                revision: created.revision,
                name,
                status: "active",
                outcome,
                ...(replaceProject ? { replaceProject } : {}),
              });
              setOrganization(activated);
              await load();
              return true;
            } catch (error) {
              setOrganizationError((error as Error).message);
              return false;
            } finally {
              writeLock.current = false;
              setOrganizationSaving(false);
            }
          }}
        />
      )}
      {transitionProject && (
        <ProjectTransition
          key={`${transitionProject.name}:${transitionProject.status}`}
          project={
            organization.projects?.find(
              (p) => p.name === transitionProject.name,
            ) || {
              name: transitionProject.name,
              description: "",
            }
          }
          status={transitionProject.status}
          data={organization}
          busy={organizationSaving}
          blocked={!organizationReady || organizationBlocked || needsCheck}
          error={organizationError}
          onBack={
            focusPickerOpen ? () => setTransitionProject(undefined) : undefined
          }
          onClose={() => {
            setTransitionProject(undefined);
            setFocusPickerOpen(false);
          }}
          onSave={changeOrganization}
          onReload={async () => {
            const result = await loadOrganization();
            if (result) await load();
            return result;
          }}
        />
      )}
      <AlertDialog
        open={!!deletingProject}
        onOpenChange={(next) => {
          if (!next && !organizationSaving) setDeletingProject(undefined);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete project “{deletingProject?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This project and all its subprojects will be removed. Their tasks
              will move to Inbox. Their completion status, labels, and board
              columns will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {organizationError && (
            <Alert variant="destructive">
              <AlertDescription>
                {organizationError}
                <Button
                  variant="link"
                  disabled={organizationSaving}
                  className="h-auto p-0 text-current"
                  onClick={async () => {
                    const latest = await loadOrganization();
                    if (latest) await load();
                    if (latest)
                      setDeletingProject(
                        (current) =>
                          current && {
                            ...current,
                            revision: latest.revision,
                          },
                      );
                  }}
                >
                  Reload and review
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={organizationSaving}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                organizationSaving ||
                !organizationReady ||
                organizationBlocked ||
                needsCheck
              }
              onClick={(event) => {
                event.preventDefault();
                if (deletingProject)
                  void changeOrganization({
                    kind: "project",
                    action: "delete",
                    revision: deletingProject.revision,
                    originalName: deletingProject.name,
                    item: {
                      name: deletingProject.name,
                      description: "",
                    },
                  }).then((saved) => {
                    if (saved) setDeletingProject(undefined);
                  });
              }}
            >
              {organizationSaving ? <Spinner /> : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TaskEditor
        open={open}
        busy={busy}
        title={
          seriesUuid
            ? "Edit repeating series"
            : editing
              ? "Edit task"
              : "Add task"
        }
        onOpenChange={(value) => {
          if (!writeLock.current) {
            setOpen(value);
            if (!value) setSeriesUuid("");
          }
        }}
      >
        {seriesUuid ? (
          <SeriesEditor
            key={seriesUuid}
            uuid={seriesUuid}
            busy={busy}
            blocked={needsCheck}
            notice={notice}
            onClose={() => setSeriesUuid("")}
            onSave={(recur, until) =>
              mutate("action", {
                uuid: seriesUuid,
                action: "recurrence.edit",
                recur,
                until,
              })
            }
            onStop={() =>
              mutate("action", {
                uuid: seriesUuid,
                action: "delete",
              })
            }
          />
        ) : (
          <TaskForm
            draft={draft}
            projects={filterProjects}
            due={due}
            tags={tags}
            availableLabels={organization.tags}
            formError={formError}
            editing={editing}
            busy={busy}
            needsCheck={needsCheck}
            subtasks={editing ? subtasksMap.get(editing.uuid) || [] : []}
            onAddSubtask={
              editing
                ? (input) => createSubtask(editing.uuid, input)
                : undefined
            }
            onToggleSubtask={(child, completed) =>
              void toggleTask(child, completed)
            }
            onDeleteSubtask={(childUuid) =>
              void mutate("action", { uuid: childUuid, action: "delete" })
            }
            onUnlinkSubtask={(childUuid) => void unlinkSubtask(childUuid)}
            onDraftChange={setDraft}
            onDueChange={setDue}
            onTagsChange={setTags}
            onClearError={() => setFormError("")}
            onCheck={() => setOpen(false)}
            onEditSeries={setSeriesUuid}
            onRemoveNote={async (entry, description) => {
              if (!editing) return false;
              const saved = await mutate(
                "action",
                {
                  uuid: editing.uuid,
                  action: "note.remove",
                  entry,
                  description,
                },
                "notes",
              );
              if (saved)
                setEditing({
                  ...editing,
                  annotations: editing.annotations.filter(
                    (note) =>
                      !(
                        note.entry === entry && note.description === description
                      ),
                  ),
                });
              return saved;
            }}
            onDelete={() => {
              if (!editing) return;
              const target = editing;
              void mutate(
                "action",
                {
                  uuid: target.uuid,
                  action: "delete",
                },
                "editor",
              ).then((saved) => {
                if (saved) {
                  setUndoTask({
                    task: target,
                    wasCompleted: target.status === "completed",
                    wasDeleted: true,
                    message: "Task deleted",
                  });
                  setToastVersion((value) => value + 1);
                  setToastOpen(true);
                }
              });
            }}
            onSubmit={submit}
          />
        )}
      </TaskEditor>
      {recoveryOpen && (
        <RecoveryCenter
          onClose={() => setRecoveryOpen(false)}
          onUnconfirmed={() => setNeedsCheck(true)}
          busy={busy}
          blocked={needsCheck}
          notice={notice}
          onRestore={(uuid) => mutate("action", { uuid, action: "restore" })}
          onRefresh={async () => {
            await loadOrganization();
            await load();
          }}
        />
      )}
    </ProjectColorsProvider>
  );
}
