import { TaskForm } from "@/features/tasks/task-form";
import { TaskList } from "@/features/tasks/task-list";
import { OrganizationManager } from "@/features/organization/organization-manager";
import { QuickAdd } from "@/features/tasks/quick-add";
import { TaskEditor } from "@/features/tasks/task-editor";
import { TaskRow } from "@/features/tasks/task-row";
import { TaskToast } from "@/features/tasks/task-toast";
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { views, WorkspaceSidebar } from "./workspace-sidebar";
import { api, RequestError } from "@/lib/api";
import type { Task, TaskInput, View } from "@shared/tasks";
import { type Organization, type OrganizationChange, type SavedFilter, type SavedTag } from "@shared/organization";
import { taskDate } from "@/features/tasks/quick-task";
import { cn } from "cn";
import { Check, Ellipsis, PanelLeft, Plus, RotateCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

type TaskGroup = "overdue" | "today" | "pending" | "waiting" | "completed";
const blank: TaskInput = { description: "", project: "", due: "", tags: [], priority: "" };
const day = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function taskGroup(task: Task): TaskGroup {
  if (task.status === "completed") return "completed";
  if ((task.wait && new Date(task.wait) > new Date()) || task.status === "waiting") return "waiting";
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
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [organizationPage, setOrganizationPage] = useState(false);
  const [organization, setOrganization] = useState<Organization>({ revision: 0, filters: [], tags: [] });
  const [organizationError, setOrganizationError] = useState("");
  const [organizationReady, setOrganizationReady] = useState(false);
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [organizationBlocked, setOrganizationBlocked] = useState(false);
  const [activeEntry, setActiveEntry] = useState<{ kind: "filter" | "tag"; id: string }>();
  const activeItem =
    activeEntry?.kind === "filter"
      ? organization.filters.find((f) => f.id === activeEntry.id)
      : organization.tags.find((t) => t.id === activeEntry?.id);
  const nativeFilter = activeItem
    ? activeEntry?.kind === "filter"
      ? (activeItem as SavedFilter).expression
      : `status:pending +${activeItem.name}`
    : "";
  const [view, setView] = useState<View>("pending");
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
  const [editing, setEditing] = useState<Task>();
  const [draft, setDraft] = useState<TaskInput>(blank);
  const [tags, setTags] = useState("");
  const [due, setDue] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      if (ticket === organizationGeneration.current) setOrganizationError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);
  function openEntry(entry: { kind: "filter" | "tag"; item: SavedFilter | SavedTag }) {
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
  async function changeOrganization(change: OrganizationChange) {
    if (writeLock.current || organizationBlocked || needsCheck) return false;
    writeLock.current = true;
    setOrganizationSaving(true);
    setOrganizationError("");
    organizationGeneration.current++;
    try {
      const result = await api<Organization>("organization", change);
      setOrganization(result);
      await load();
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

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    if (previousScope.current !== scope) {
      setTasks([]);
      setLoaded(false);
    }
    try {
      const result = await api<{ tasks: Task[]; projects: string[] }>(`tasks?${scope}`);
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
  }, [scope]);
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
          target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]'))
      )
        return;
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        openQuickAdd();
      }
      if (event.key === "/") {
        event.preventDefault();
        setOrganizationPage(false);
        setSearchOpen(true);
        document.getElementById("task-search")?.focus();
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [open, quickOpen, confirmDelete, openQuickAdd]);

  async function mutate(route: string, data: unknown, origin?: "editor" | "quick") {
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
      if (!(await load())) {
        setNotice("Saved. Refresh to check your tasks.");
        setNeedsCheck(true);
      }
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.uncertain) {
        setNeedsCheck(true);
        setNotice(error.message);
      }
      (origin === "editor" ? setFormError : origin === "quick" ? setQuickError : setNotice)((error as Error).message);
      return false;
    } finally {
      writeLock.current = false;
      setBusy(false);
    }
  }
  async function toggleTask(task: Task, completed: boolean) {
    const current = document.getElementById(`complete-${task.uuid}`);
    const hadFocus = document.activeElement === current;
    const checkboxes = [...document.querySelectorAll<HTMLElement>('[data-task-row] [role="checkbox"]')];
    const index = checkboxes.findIndex((item) => item === current);
    const neighbor = checkboxes[index + 1] || checkboxes[index - 1];
    const saved = await mutate("action", { uuid: task.uuid, action: completed ? "reopen" : "complete" });
    if (hadFocus && (document.activeElement === document.body || document.activeElement === current)) {
      requestAnimationFrame(() => {
        const target = document.getElementById(saved ? neighbor?.id || "view-title" : current?.id || "view-title");
        if (target instanceof HTMLButtonElement && target.disabled) document.getElementById("view-title")?.focus();
        else target?.focus();
      });
    }
  }
  function openEditor(task?: Task, initial?: TaskInput) {
    if (busy || needsCheck) return;
    setEditing(task);
    setDraft(
      task
        ? { description: task.description, project: task.project || "", priority: task.priority || "", tags: task.tags }
        : initial || { ...blank },
    );
    setTags((task?.tags || initial?.tags)?.join(", ") || "");
    const date = task?.due || initial?.due;
    setDue(date ? day(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")) : "");
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
      editing?.due || draft.due?.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
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
    void mutate(editing ? "action" : "tasks", editing ? { uuid: editing.uuid, action: "edit", task } : task, "editor");
  }

  const filterProjects = [
    ...new Set([...projects, ...tasks.map((task) => task.project).filter((p): p is string => !!p)]),
  ];
  const currentProject = filterProjects.includes(project) ? project : "";
  const visible = tasks.filter((task) => {
    const group = taskGroup(task);
    return (
      (view !== "today" || ["overdue", "today"].includes(group)) &&
      (view !== "waiting" || group === "waiting") &&
      (!currentProject || task.project === currentProject) &&
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

  const inbox = view === "pending" && !currentProject && !query.trim() && !activeItem;
  const renderTask = (task: Task) => (
    <TaskRow
      key={task.uuid}
      task={task}
      showProject={!!query.trim() || !!activeItem}
      completed={task.status === "completed"}
      overdue={taskGroup(task) === "overdue"}
      disabled={busy || needsCheck || loading}
      onEdit={() => openEditor(task)}
      onComplete={() => void toggleTask(task, task.status === "completed")}
    />
  );

  return (
    <>
      <WorkspaceSidebar
        navOpen={navOpen}
        onOpenChange={setNavOpen}
        view={view}
        currentProject={currentProject}
        organizationPage={organizationPage}
        organization={organization}
        activeEntry={activeEntry}
        hasActiveItem={!!activeItem}
        projects={filterProjects}
        busy={busy}
        needsCheck={needsCheck}
        organizationSaving={organizationSaving}
        connectionLabel={connectionLabel}
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
          setOrganizationPage(true);
          setActiveEntry(undefined);
          setSearchOpen(false);
          setQuery("");
          setProject("");
        }}
      />
      <div className={cn("min-h-dvh transition-[margin] duration-150", navOpen && "md:ml-60")}>
        <header className="flex h-12 items-center justify-between px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={navOpen ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={navOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavOpen((value) => !value)}
            className="text-muted-foreground"
          >
            <PanelLeft className="size-[18px]" strokeWidth={1.5} />
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              id="search-toggle"
              aria-label={searchOpen || query ? "Close search" : "Open search"}
              aria-expanded={!!(searchOpen || query)}
              aria-controls="task-search"
              aria-keyshortcuts="/"
              onClick={() => {
                if (organizationPage) setOrganizationPage(false);
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
              <RotateCw className={cn("size-[17px]", loading && "animate-spin")} strokeWidth={1.5} />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[880px] px-6 pt-6 pb-24 md:pb-16">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1
              id="view-title"
              tabIndex={-1}
              className="min-w-0 truncate text-2xl leading-8 font-bold tracking-[-0.5px] outline-none"
            >
              {organizationPage ? "Filters & labels" : activeItem?.name || currentProject || views[view]}
            </h1>
            {!organizationPage && (
              <Popover open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="View options"
                    className="text-muted-foreground data-[state=open]:bg-accent"
                  >
                    <Ellipsis className="size-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1">
                  {(Object.entries(views) as [View, string][]).map(([key, label]) => (
                    <Button
                      key={key}
                      variant="navigation"
                      aria-current={view === key && !currentProject ? "page" : undefined}
                      className="h-8 text-xs"
                      onClick={() => {
                        openTaskView();
                        setView(key);
                        setViewMenuOpen(false);
                        setProject("");
                        setQuery("");
                      }}
                    >
                      <Check className={cn("size-3.5", (view !== key || currentProject) && "invisible")} />
                      {label}
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
          {organizationPage ? (
            <OrganizationManager
              data={organization}
              error={organizationError}
              busy={busy || organizationSaving}
              loading={!organizationReady && !organizationError}
              blocked={!organizationReady || organizationBlocked || needsCheck}
              onChange={changeOrganization}
              onOpen={openEntry}
              onReload={async () => {
                const result = await loadOrganization();
                if (result) await load();
                return result;
              }}
            />
          ) : (
            <>
              {activeEntry?.kind === "filter" && (activeItem as SavedFilter)?.description && (
                <p className="-mt-3 mb-6 text-sm leading-6 text-muted-foreground">
                  {(activeItem as SavedFilter).description}
                </p>
              )}
              {(searchOpen || query) && (
                <div className="mb-5 flex items-center gap-2">
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
                    value={currentProject ? `project:${currentProject}` : "all"}
                    onValueChange={(value) => setProject(value === "all" ? "" : value.slice(8))}
                  >
                    <SelectTrigger aria-label="Filter projects" className="w-28 shrink-0 shadow-none">
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
                  </AlertDescription>
                </Alert>
              )}
              <TaskList
                visible={visible}
                projects={filterProjects}
                loading={loading}
                loaded={loaded}
                inbox={inbox}
                disabled={busy || needsCheck}
                emptyTitle={emptyTitle}
                hasFilters={!!(query || currentProject)}
                renderTask={renderTask}
                onAdd={openQuickAdd}
                onOpenProject={(name) => {
                  setProject(name);
                  setView("pending");
                }}
                onClearFilters={() => {
                  setQuery("");
                  setProject("");
                }}
              />
            </>
          )}
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
            setProject("");
            setQuery("");
            setAddedProject(task.project || "");
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
        project={addedProject}
        onView={() => {
          openTaskView();
          setView("pending");
          setProject(addedProject);
          setQuery("");
          requestAnimationFrame(() => document.getElementById("view-title")?.focus());
        }}
      />

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
          projects={projects}
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
            <AlertDialogDescription>The task will be removed from this view.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (editing) void mutate("action", { uuid: editing.uuid, action: "delete" }, "editor");
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
