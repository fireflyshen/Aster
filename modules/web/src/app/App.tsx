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
import { FocusOverview } from "@/features/projects/focus-overview";
import { ProjectEditor } from "@/features/projects/project-editor";
import { ProjectColorsProvider } from "@/features/projects/project-icon";
import { ProjectManager } from "@/features/projects/project-manager";
import { ProjectTransition } from "@/features/projects/project-transition";
import { QuickAdd } from "@/features/tasks/quick-add";
import { TaskEditor } from "@/features/tasks/task-editor";
import { TaskForm } from "@/features/tasks/task-form";
import { TaskList } from "@/features/tasks/task-list";
import { TaskRow } from "@/features/tasks/task-row";
import { TaskToast } from "@/features/tasks/task-toast";
import { api, RequestError } from "@/lib/api";
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
    focusProject,
    inProject,
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
import {
    Check,
    Columns3,
    Ellipsis,
    List,
    PanelLeft,
    Pencil,
    Plus,
    RotateCw,
    Search,
    Trash2,
    X,
} from "lucide-react";
import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type FormEvent,
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
    const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
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
    const [open, setOpen] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [quickError, setQuickError] = useState("");
    const [toastOpen, setToastOpen] = useState(false);
    const [toastVersion, setToastVersion] = useState(0);
    const [addedProject, setAddedProject] = useState("");
    const [undoTask, setUndoTask] = useState<{
        task: Task;
        wasCompleted: boolean;
        wasStarted?: boolean;
        message?: string;
        board?: { columnId: string; beforeUuid: string | null };
    }>();
    const [completion, setCompletion] = useState<{
        uuid: string;
        checked: boolean;
        phase: "checking" | "leaving";
    }>();
    const [transitionProject, setTransitionProject] = useState<{
        name: string;
        status: ProjectStatus;
    }>();
    const [editingProject, setEditingProject] = useState<string>();
    const [newProjectParent, setNewProjectParent] = useState("");
    const [deletingProject, setDeletingProject] = useState<{
        name: string;
        revision: number;
    }>();
    const [editing, setEditing] = useState<Task>();
    const [draft, setDraft] = useState<TaskInput>(blank);
    const [tags, setTags] = useState("");
    const [due, setDue] = useState("");
    const [formError, setFormError] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [now, setNow] = useState(() => new Date());
    const generation = useRef(0);
    const organizationGeneration = useRef(0);
    const writeLock = useRef(false);
    const previousScope = useRef("");
    const scope = nativeFilter
        ? `filter=${encodeURIComponent(nativeFilter)}`
        : `scope=${view === "completed" ? "completed" : layout === "board" ? "board" : "pending"}`;
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
    function taskTrackedSeconds(task: Task): number {
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
        if (writeLock.current || organizationBlocked || needsCheck)
            return false;
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
                setExpandedProjects((names) =>
                    names.flatMap((name) =>
                        !inProject(name, original)
                            ? [name]
                            : change.action === "delete"
                              ? []
                              : [
                                    remapProject(
                                        name,
                                        original,
                                        change.item.name,
                                    ),
                                ],
                    ),
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
                ["scope=pending", "scope=board"].includes(
                    previousScope.current,
                ) && ["scope=pending", "scope=board"].includes(scope);
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
        setQuickError("");
        setQuickOpen(true);
    }, [needsCheck, open]);
    useEffect(() => {
        const shortcuts = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                event.defaultPrevented ||
                event.isComposing ||
                event.repeat ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                open ||
                quickOpen ||
                confirmDelete ||
                document.querySelector(
                    '[role="dialog"], [role="alertdialog"], [data-state="open"][data-slot="select-content"]',
                ) ||
                (target instanceof Element &&
                    target.closest(
                        'input, textarea, select, [contenteditable="true"], [role="combobox"]',
                    ))
            )
                return;
            if (event.key.toLowerCase() === "q") {
                event.preventDefault();
                openQuickAdd();
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
                setView("pending");
                setSearchOpen(true);
                document.getElementById("task-search")?.focus();
            }
        };
        window.addEventListener("keydown", shortcuts);
        return () => window.removeEventListener("keydown", shortcuts);
    }, [open, quickOpen, confirmDelete, openQuickAdd]);

    async function mutate(
        route: string,
        data: unknown,
        origin?: "editor" | "quick",
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
            (origin === "editor"
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
    async function toggleTask(
        task: Task,
        completed: boolean,
        offerUndo = true,
    ) {
        if (writeLock.current || needsCheck || loading || organizationSaving)
            return;
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
                    setTimeout(
                        resolve,
                        Math.max(0, 300 - (performance.now() - started)),
                    ),
                );
                if (!fresh.some((item) => item.uuid === task.uuid)) {
                    setCompletion({
                        uuid: task.uuid,
                        checked: !completed,
                        phase: "leaving",
                    });
                    await new Promise((resolve) => setTimeout(resolve, 210));
                }
            },
        );
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
        setEditing(task);
        setDraft(
            task
                ? {
                      description: task.description,
                      project: task.project || "",
                      priority: task.priority || "",
                      tags: task.tags,
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
            ...tasks
                .map((task) => task.project)
                .filter((p): p is string => !!p),
        ]),
    ];
    const currentProject = filterProjects.includes(project) ? project : "";
    const specialPage =
        !organizationPage &&
        !activeItem &&
        !currentProject &&
        (view === "focus" || view === "later");
    const visible = tasks.filter((task) => {
        if (
            layout === "list" &&
            view !== "completed" &&
            !nativeFilter &&
            task.status === "completed"
        )
            return false;
        const group =
            layout === "board" &&
            task.status === "completed" &&
            view === "today"
                ? taskGroup({ ...task, status: "pending", wait: undefined })
                : taskGroup(task);
        return (
            (view !== "today" || ["overdue", "today"].includes(group)) &&
            (view !== "waiting" || group === "waiting") &&
            (!currentProject || inProject(task.project, currentProject)) &&
            [task.description, task.project, ...task.tags]
                .join(" ")
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase())
        );
    });
    const emptyTitle =
        query.trim() || currentProject
            ? "No results"
            : activeItem
              ? "No results"
              : view === "today"
                ? "No tasks"
                : view === "completed"
                  ? "No completed tasks"
                  : view === "waiting"
                    ? "No waiting tasks"
                    : "No tasks";
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
    const inbox =
        view === "pending" && !currentProject && !query.trim() && !activeItem;
    const renderTask = (task: Task) => (
        <TaskRow
            key={task.uuid}
            task={task}
            variant={!specialPage && layout === "board" ? "card" : "list"}
            showProject={
                !specialPage && layout === "board"
                    ? !currentProject
                    : !!query.trim() || !!activeItem
            }
            completed={task.status === "completed"}
            overdue={taskGroup(task) === "overdue"}
            disabled={busy || organizationSaving || needsCheck || loading}
            transition={completion?.uuid === task.uuid ? completion : undefined}
            trackedSeconds={taskTrackedSeconds(task)}
            onToggleStart={
                task.status !== "completed"
                    ? () => void toggleStartTask(task)
                    : undefined
            }
            onEdit={() => openEditor(task)}
            onComplete={() =>
                void toggleTask(task, task.status === "completed")
            }
        />
    );

    const projectDescription = organization.projects?.find(
        (item) => item.name === currentProject,
    )?.description;
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
        setTransitionProject({ name, status });
        if (innerWidth < 768) setNavOpen(false);
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
                busy={busy}
                needsCheck={needsCheck}
                organizationSaving={
                    organizationSaving ||
                    !organizationReady ||
                    organizationBlocked ||
                    needsCheck
                }
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
            <Button
                id="sidebar-toggle"
                variant="ghost"
                size="icon-sm"
                aria-label={navOpen ? "Hide sidebar" : "Show sidebar"}
                aria-expanded={navOpen}
                aria-controls="workspace-navigation"
                aria-keyshortcuts="M"
                data-sidebar-open={navOpen}
                onClick={() => setNavigation(!navOpen)}
                className="workspace-sidebar-toggle hidden text-muted-foreground md:inline-flex"
            >
                <PanelLeft className="size-[18px]" strokeWidth={1.5} />
            </Button>
            <div
                className="workspace-main min-h-dvh"
                data-sidebar-open={navOpen}
            >
                <header className="workspace-frame flex h-12 items-center justify-between">
                    <div className="size-8 shrink-0">
                        <Button
                            id="sidebar-mobile-toggle"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Show sidebar"
                            aria-expanded={navOpen}
                            aria-controls="workspace-navigation"
                            onClick={() => setNavigation(true)}
                            className={cn(
                                "text-muted-foreground md:hidden",
                                navOpen && "invisible",
                            )}
                        >
                            <PanelLeft
                                className="size-[18px]"
                                strokeWidth={1.5}
                            />
                        </Button>
                    </div>
                    <div className="flex items-center gap-1">
                        <ThemeSwitcher />
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            id="search-toggle"
                            aria-label={
                                searchOpen || query
                                    ? "Close search"
                                    : "Open search"
                            }
                            aria-expanded={!!(searchOpen || query)}
                            aria-controls="task-search"
                            aria-keyshortcuts="/"
                            onClick={() => {
                                if (organizationPage)
                                    setOrganizationPage(false);
                                if (view === "focus" || view === "later")
                                    setView("pending");
                                if (searchOpen || query) {
                                    setSearchOpen(false);
                                    setQuery("");
                                } else setSearchOpen(true);
                            }}
                            className="text-muted-foreground"
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
                            className="text-muted-foreground"
                        >
                            <RotateCw
                                className={cn(
                                    "size-[17px]",
                                    loading && "animate-spin",
                                )}
                                strokeWidth={1.5}
                            />
                        </Button>
                    </div>
                </header>
                <main className="workspace-frame min-w-0 pt-6 pb-24 md:pb-16">
                    <Tabs
                        value={layout}
                        onValueChange={(value) => {
                            if (value !== "list" && value !== "board") return;
                            setLayout(value);
                            try {
                                localStorage.setItem(
                                    "aster.task-layout",
                                    value,
                                );
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
                                                setProject(
                                                    parts
                                                        .slice(0, index + 1)
                                                        .join("."),
                                                );
                                                setQuery("");
                                            }}
                                        >
                                            {part}
                                            <span
                                                aria-hidden
                                                className="ml-1 opacity-50"
                                            >
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
                            <h1
                                title={
                                    currentProject
                                        ? projectPath(currentProject)
                                        : undefined
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
                            {!organizationPage && !specialPage && (
                                <div className="flex shrink-0 items-center gap-2">
                                    <TabsList
                                        aria-label="Task layout"
                                        className="h-8 group-data-[orientation=horizontal]/tabs:h-8"
                                    >
                                        <TabsTrigger
                                            value="list"
                                            aria-label="List view"
                                            disabled={
                                                busy || organizationSaving
                                            }
                                            className="gap-1.5 px-2 text-xs"
                                        >
                                            <List className="size-3.5" />
                                            <span className="hidden sm:inline">
                                                List
                                            </span>
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="board"
                                            aria-label="Board view"
                                            disabled={
                                                busy || organizationSaving
                                            }
                                            className="gap-1.5 px-2 text-xs"
                                        >
                                            <Columns3 className="size-3.5" />
                                            <span className="hidden sm:inline">
                                                Board
                                            </span>
                                        </TabsTrigger>
                                    </TabsList>
                                    <Popover
                                        open={viewMenuOpen}
                                        onOpenChange={setViewMenuOpen}
                                    >
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                disabled={
                                                    busy || organizationSaving
                                                }
                                                aria-label="View options"
                                                className="text-muted-foreground data-[state=open]:bg-accent"
                                            >
                                                <Ellipsis className="size-5" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            align="end"
                                            className="w-40 p-1"
                                        >
                                            {currentProject && !activeItem && (
                                                <>
                                                    <Button
                                                        variant="navigation"
                                                        disabled={
                                                            busy ||
                                                            organizationSaving
                                                        }
                                                        onClick={() => {
                                                            setViewMenuOpen(
                                                                false,
                                                            );
                                                            transition(
                                                                focusProject(
                                                                    currentProject,
                                                                    organization.projects,
                                                                )?.name ||
                                                                    currentProject,
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
                                                        )
                                                            ? "Pause project"
                                                            : "Activate project"}
                                                    </Button>
                                                    <Button
                                                        variant="navigation"
                                                        disabled={
                                                            busy ||
                                                            organizationSaving
                                                        }
                                                        onClick={() => {
                                                            setViewMenuOpen(
                                                                false,
                                                            );
                                                            transition(
                                                                focusProject(
                                                                    currentProject,
                                                                    organization.projects,
                                                                )?.name ||
                                                                    currentProject,
                                                                "completed",
                                                            );
                                                        }}
                                                    >
                                                        Complete project
                                                    </Button>
                                                </>
                                            )}
                                            {currentProject && !activeItem && (
                                                <Button
                                                    variant="navigation"
                                                    disabled={
                                                        busy ||
                                                        organizationSaving ||
                                                        !organizationReady
                                                    }
                                                    onClick={() => {
                                                        setViewMenuOpen(false);
                                                        addSubproject(
                                                            currentProject,
                                                        );
                                                    }}
                                                >
                                                    <Plus className="size-3.5" />
                                                    Add subproject
                                                </Button>
                                            )}
                                            {currentProject && !activeItem && (
                                                <Button
                                                    variant="navigation"
                                                    disabled={
                                                        busy ||
                                                        organizationSaving ||
                                                        !organizationReady
                                                    }
                                                    onClick={() => {
                                                        setViewMenuOpen(false);
                                                        editProject(
                                                            currentProject,
                                                        );
                                                    }}
                                                >
                                                    <Pencil className="size-3.5" />
                                                    Edit project
                                                </Button>
                                            )}
                                            {currentProject && !activeItem && (
                                                <Button
                                                    variant="navigation"
                                                    disabled={
                                                        busy ||
                                                        organizationSaving ||
                                                        !organizationReady
                                                    }
                                                    className="text-destructive"
                                                    onClick={() => {
                                                        setViewMenuOpen(false);
                                                        deleteProject(
                                                            currentProject,
                                                        );
                                                    }}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                    Delete project
                                                </Button>
                                            )}
                                            {activeItem && (
                                                <Button
                                                    variant="navigation"
                                                    onClick={() => {
                                                        setViewMenuOpen(false);
                                                        setProjectsPage(false);
                                                        setOrganizationPage(
                                                            true,
                                                        );
                                                    }}
                                                >
                                                    <Pencil className="size-3.5" />
                                                    Manage{" "}
                                                    {activeEntry?.kind ===
                                                    "filter"
                                                        ? "filters"
                                                        : "labels"}
                                                </Button>
                                            )}
                                            {(
                                                Object.entries(views) as [
                                                    View,
                                                    string,
                                                ][]
                                            ).map(([key, label]) => (
                                                <Button
                                                    key={key}
                                                    variant="navigation"
                                                    aria-current={
                                                        view === key &&
                                                        !currentProject
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
                                                            (view !== key ||
                                                                currentProject) &&
                                                                "invisible",
                                                        )}
                                                    />
                                                    {label}
                                                </Button>
                                            ))}
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            )}
                        </div>
                        {specialPage && view === "focus" ? (
                            <FocusOverview
                                data={organization}
                                tasks={tasks}
                                loading={
                                    !organizationReady || (loading && !loaded)
                                }
                                disabled={
                                    busy ||
                                    organizationSaving ||
                                    !organizationReady ||
                                    organizationBlocked ||
                                    needsCheck
                                }
                                error={organizationError || notice}
                                onLater={() => setView("later")}
                                onOpen={(name) => {
                                    openTaskView();
                                    setView("pending");
                                    setProject(name);
                                    setQuery("");
                                }}
                                onEdit={editProject}
                                onAddTask={(name) => {
                                    openTaskView();
                                    setView("pending");
                                    setProject(name);
                                    setQuickError("");
                                    setQuickOpen(true);
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
                                    loading={
                                        !organizationReady && !organizationError
                                    }
                                    blocked={
                                        !organizationReady ||
                                        organizationBlocked ||
                                        needsCheck
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
                                    <Button
                                        variant="ghost"
                                        disabled={
                                            busy ||
                                            organizationSaving ||
                                            !organizationReady
                                        }
                                        onClick={() =>
                                            editProject(currentProject)
                                        }
                                        className="group -mt-3 mb-6 h-auto min-h-8 max-w-full justify-start gap-2 px-0 py-1 text-left text-sm leading-6 font-normal whitespace-pre-wrap text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-100 has-[>svg]:px-0"
                                    >
                                        <span className="min-w-0 [overflow-wrap:anywhere]">
                                            {projectDescription ||
                                                "Add description"}
                                        </span>
                                        <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                                    </Button>
                                )}
                                {activeEntry?.kind === "filter" &&
                                    (activeItem as SavedFilter)
                                        ?.description && (
                                        <p className="-mt-3 mb-6 text-sm leading-6 text-muted-foreground">
                                            {
                                                (activeItem as SavedFilter)
                                                    .description
                                            }
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
                                                onChange={(e) =>
                                                    setQuery(e.target.value)
                                                }
                                                onKeyDown={(event) => {
                                                    if (
                                                        event.key === "Escape"
                                                    ) {
                                                        event.preventDefault();
                                                        setQuery("");
                                                        setSearchOpen(false);
                                                        document
                                                            .getElementById(
                                                                "search-toggle",
                                                            )
                                                            ?.focus();
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
                                                            document
                                                                .getElementById(
                                                                    "task-search",
                                                                )
                                                                ?.focus();
                                                        }}
                                                    >
                                                        <X />
                                                    </InputGroupButton>
                                                </InputGroupAddon>
                                            )}
                                        </InputGroup>
                                        <Select
                                            value={
                                                currentProject
                                                    ? `project:${currentProject}`
                                                    : "all"
                                            }
                                            onValueChange={(value) =>
                                                setProject(
                                                    value === "all"
                                                        ? ""
                                                        : value.slice(8),
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                aria-label="Filter projects"
                                                className="h-9 w-32 shrink-0 shadow-none data-[size=default]:h-9"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    All projects
                                                </SelectItem>
                                                {filterProjects.map((name) => (
                                                    <SelectItem
                                                        key={name}
                                                        value={`project:${name}`}
                                                    >
                                                        {name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                {notice && (
                                    <Alert
                                        variant="destructive"
                                        className="mb-4"
                                    >
                                        <AlertDescription>
                                            {notice}
                                            {energy &&
                                            energy.remaining <= 0 &&
                                            /energy exhausted/i.test(notice) ? (
                                                <Button
                                                    type="button"
                                                    variant="link"
                                                    onClick={() =>
                                                        void restoreEnergy()
                                                    }
                                                    disabled={
                                                        loading ||
                                                        busy ||
                                                        organizationSaving
                                                    }
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
                                                    {needsCheck
                                                        ? "Refresh and check"
                                                        : "Reconnect"}
                                                </Button>
                                            )}
                                        </AlertDescription>
                                    </Alert>
                                )}
                                <TabsContent
                                    value="list"
                                    className="mt-0 min-w-0"
                                >
                                    <TaskList
                                        visible={visible}
                                        projects={inbox ? [] : filterProjects}
                                        loading={loading}
                                        loaded={loaded}
                                        inbox={inbox}
                                        disabled={busy || needsCheck}
                                        emptyTitle={emptyTitle}
                                        hasFilters={!!(query || currentProject)}
                                        renderTask={renderTask}
                                        onAdd={openQuickAdd}
                                        onEditProject={editProject}
                                        onDeleteProject={deleteProject}
                                        expandedProjects={expandedProjects}
                                        onProjectExpand={(name, expanded) =>
                                            setExpandedProjects((current) =>
                                                expanded
                                                    ? [
                                                          ...new Set([
                                                              ...current,
                                                              name,
                                                          ]),
                                                      ]
                                                    : current.filter(
                                                          (item) =>
                                                              item !== name,
                                                      ),
                                            )
                                        }
                                        onOpenProject={(name) => {
                                            setProject(name);
                                            setView("pending");
                                        }}
                                        onClearFilters={() => {
                                            setQuery("");
                                            setProject("");
                                        }}
                                    />
                                </TabsContent>
                                <TabsContent
                                    value="board"
                                    className="mt-0 min-w-0"
                                >
                                    <Suspense
                                        fallback={
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Spinner className="size-4" />
                                                Loading board…
                                            </div>
                                        }
                                    >
                                        <TaskBoard
                                            initialScrollLeft={
                                                boardScroll.current
                                            }
                                            onScrollPositionChange={(
                                                position,
                                            ) => {
                                                boardScroll.current = position;
                                            }}
                                            tasks={visible}
                                            board={
                                                organization.board ||
                                                defaultBoard()
                                            }
                                            revision={organization.revision}
                                            saving={organizationSaving}
                                            blocked={
                                                organizationBlocked ||
                                                needsCheck ||
                                                !organizationReady
                                            }
                                            error={organizationError}
                                            onChange={changeBoard}
                                            onReload={reloadBoard}
                                            onClearError={() =>
                                                setOrganizationError("")
                                            }
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
                                            onAdd={openQuickAdd}
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

            <QuickAdd
                open={quickOpen}
                projects={filterProjects}
                defaultProject={currentProject}
                busy={busy}
                blocked={needsCheck}
                error={quickError}
                onClearError={() => setQuickError("")}
                onCheck={() => setQuickOpen(false)}
                onOpenChange={(value) => {
                    if (!writeLock.current) setQuickOpen(value);
                }}
                onAdd={async (task) => {
                    const saved = await mutate("tasks", task, "quick");
                    if (saved) {
                        openTaskView();
                        setView("pending");
                        setProject(
                            currentProject && task.project === currentProject
                                ? currentProject
                                : "",
                        );
                        setQuery("");
                        setAddedProject(task.project || "");
                        setUndoTask(undefined);
                        setToastVersion((value) => value + 1);
                        setToastOpen(true);
                    }
                    return saved;
                }}
                onEdit={(task) => {
                    setQuickOpen(false);
                    openEditor(undefined, task);
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
                actionDescription={
                    undoTask ? "Undo task change" : "View task location"
                }
                disabled={busy || needsCheck || organizationSaving || loading}
                onAction={() => {
                    if (undoTask) {
                        setToastOpen(false);
                        if (undoTask.board)
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
                        else
                            void toggleTask(
                                undoTask.task,
                                !undoTask.wasCompleted,
                                false,
                            );
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
                        organization.projects?.find(
                            (item) => item.name === editingProject,
                        )?.color
                    }
                    description={
                        organization.projects?.find(
                            (item) => item.name === editingProject,
                        )?.description || ""
                    }
                    outcome={
                        organization.projects?.find(
                            (item) => item.name === editingProject,
                        )?.outcome || ""
                    }
                    nextTask={
                        organization.projects?.find(
                            (item) => item.name === editingProject,
                        )?.nextTask || ""
                    }
                    revision={organization.revision}
                    busy={organizationSaving}
                    blocked={
                        !organizationReady || organizationBlocked || needsCheck
                    }
                    error={organizationError}
                    onClose={() => setEditingProject(undefined)}
                    onReload={async () => {
                        const latest = await loadOrganization();
                        if (latest) await load();
                        return latest;
                    }}
                    onSave={(
                        name,
                        description,
                        revision,
                        outcome,
                        nextTask,
                        color,
                    ) =>
                        changeOrganization({
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
                        })
                    }
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
                    blocked={
                        !organizationReady || organizationBlocked || needsCheck
                    }
                    error={organizationError}
                    onClose={() => setTransitionProject(undefined)}
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
                    if (!next && !organizationSaving)
                        setDeletingProject(undefined);
                }}
            >
                <AlertDialogContent className="max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete project “{deletingProject?.name}”?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This project and all its subprojects will be
                            removed. Their tasks will move to Inbox. Their
                            completion status, labels, and board columns will be
                            kept.
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
                                                        revision:
                                                            latest.revision,
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
                                        if (saved)
                                            setDeletingProject(undefined);
                                    });
                            }}
                        >
                            {organizationSaving ? (
                                <Spinner />
                            ) : (
                                "Delete project"
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <TaskEditor
                open={open}
                busy={busy}
                title={editing ? "Edit task" : "Add task"}
                onOpenChange={(value) => {
                    if (!writeLock.current) setOpen(value);
                }}
            >
                <TaskForm
                    draft={draft}
                    projects={filterProjects}
                    due={due}
                    tags={tags}
                    formError={formError}
                    editing={editing}
                    busy={busy}
                    needsCheck={needsCheck}
                    onDraftChange={setDraft}
                    onDueChange={setDue}
                    onTagsChange={setTags}
                    onClearError={() => setFormError("")}
                    onCheck={() => setOpen(false)}
                    onDelete={() => setConfirmDelete(true)}
                    onSubmit={submit}
                />
            </TaskEditor>
            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent className="max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The task will be removed from this view.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (editing)
                                    void mutate(
                                        "action",
                                        {
                                            uuid: editing.uuid,
                                            action: "delete",
                                        },
                                        "editor",
                                    );
                            }}
                            className="bg-destructive text-white hover:bg-destructive/90"
                        >
                            Delete task
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ProjectColorsProvider>
    );
}
