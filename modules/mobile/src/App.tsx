import { DatePicker } from "@/components/date-picker";
import { ProjectPicker } from "@/components/project-picker";
import { QuickAdd } from "@/components/quick-add";
import { TaskEditor } from "@/components/task-editor";
import { TaskRow } from "@/components/task-row";
import { TaskToast } from "@/components/task-toast";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, RequestError, type Task, type TaskInput, type View } from "@/lib/api";
import { taskDate } from "@/lib/quick-task";
import { cn } from "cn";
import {
  Asterisk,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock3,
  Ellipsis,
  Hash,
  Inbox,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

const views: Record<View, string> = { pending: "收件箱", today: "今天", waiting: "等待", completed: "已完成" };
const viewIcons = { pending: Inbox, today: CalendarDays, waiting: Clock3, completed: CircleCheck };
const groups = { overdue: "已逾期", today: "今天", pending: "接下来", waiting: "等待中", completed: "已完成" };
const blank: TaskInput = { description: "", project: "", due: "", tags: [], priority: "" };
const day = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function taskGroup(task: Task): keyof typeof groups {
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
  const writeLock = useRef(false);
  const previousScope = useRef("");
  const scope = view === "completed" ? "completed" : "pending";
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
      const result = await api<{ tasks: Task[]; projects: string[] }>(`tasks?scope=${scope}`);
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
      if (!document.hidden && !open && !quickOpen && !writeLock.current) void load();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load, open, quickOpen]);

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
      if (!(await load())) {
        setNotice("已保存，但列表刷新失败。请刷新检查。");
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
      setFormError("请填写任务描述");
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
      ? "没有匹配的任务"
      : view === "today"
        ? "今天，从容一点"
        : view === "completed"
          ? "还没有完成记录"
          : view === "waiting"
            ? "没有等待中的任务"
            : "留一点空白";
  const connectionLabel = loading
    ? "RN · 正在连接"
    : needsCheck
      ? "RN · 待核对"
      : connectionError
        ? "RN · 连接异常"
        : loaded
          ? "RN · 已连接"
          : "RN · 尚未连接";

  const inbox = view === "pending" && !currentProject && !query.trim();
  const renderTask = (task: Task) => (
    <TaskRow
      key={task.uuid}
      task={task}
      showProject={!!query.trim()}
      completed={task.status === "completed"}
      overdue={taskGroup(task) === "overdue"}
      disabled={busy || needsCheck || loading}
      onEdit={() => openEditor(task)}
      onComplete={() => void toggleTask(task, task.status === "completed")}
    />
  );

  return (
    <>
      {navOpen && (
        <Button
          variant="ghost"
          aria-label="关闭侧栏"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-20 h-full w-full rounded-none bg-black/10 hover:bg-black/10 md:hidden"
        />
      )}
      <aside
        aria-label="工作区导航"
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-60 flex-col overflow-y-auto bg-[#fcfaf8] px-3 py-3 [&>*]:shrink-0",
          navOpen ? "flex" : "hidden",
        )}
      >
        <div className="mb-5 flex h-8 items-center gap-2 px-2 text-sm font-semibold">
          <Asterisk className="size-5 text-primary" strokeWidth={1.6} />
          Aster
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="收起侧栏"
            className="ml-auto text-muted-foreground"
            onClick={() => setNavOpen(false)}
          >
            <PanelLeft className="size-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={openQuickAdd}
          disabled={busy || needsCheck}
          aria-keyshortcuts="Q"
          className="mb-3 h-9 w-full justify-start gap-2.5 px-2 font-medium text-primary"
        >
          <Plus className="size-5" />
          添加任务<kbd className="ml-auto font-sans text-xs text-muted-foreground">Q</kbd>
        </Button>
        <nav aria-label="任务视图" className="space-y-0.5">
          {(Object.entries(views) as [View, string][]).map(([value, label]) => {
            const Icon = viewIcons[value];
            return (
              <Button
                key={value}
                variant="ghost"
                disabled={busy}
                aria-current={view === value && !currentProject ? "page" : undefined}
                onClick={() => {
                  setView(value);
                  setProject("");
                  setQuery("");
                  if (innerWidth < 768) setNavOpen(false);
                }}
                className={cn(
                  "h-9 w-full justify-start gap-2.5 px-2 font-normal text-[#555]",
                  view === value && !currentProject && "bg-[#ffebe6] text-primary hover:bg-[#ffebe6]",
                )}
              >
                <Icon className="size-[18px]" />
                {label}
              </Button>
            );
          })}
        </nav>
        <p className="mt-7 mb-2 px-2 text-xs font-semibold text-[#777]">我的项目</p>
        <nav aria-label="项目" className="flex-1 space-y-0.5">
          {filterProjects.map((name) => (
            <Button
              key={name}
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setProject(name);
                setView("pending");
                setQuery("");
                if (innerWidth < 768) setNavOpen(false);
              }}
              className={cn(
                "h-9 w-full justify-start gap-2.5 px-2 font-normal text-[#666]",
                currentProject === name && "bg-[#ffebe6] text-primary",
              )}
            >
              <Hash className="size-[18px] text-[#999]" />
              <span className="truncate">{name}</span>
            </Button>
          ))}
        </nav>
        <p className="mt-6 px-2 pb-2 text-[11px] text-[#999]">{connectionLabel}</p>
      </aside>
      <div className={cn("min-h-dvh transition-[margin] duration-150", navOpen && "md:ml-60")}>
        <header className="flex h-12 items-center justify-between px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={navOpen ? "隐藏侧栏" : "显示侧栏"}
            onClick={() => setNavOpen((value) => !value)}
            className="text-[#777]"
          >
            <PanelLeft className="size-[18px]" strokeWidth={1.5} />
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="打开搜索"
              aria-keyshortcuts="/"
              onClick={() => {
                setSearchOpen((value) => !value);
              }}
              className="text-[#777]"
            >
              <Search className="size-[18px]" strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新任务"
              disabled={loading || busy}
              onClick={() => void load()}
              className="text-[#777]"
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
              {currentProject || views[view]}
            </h1>
            <Popover open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="视图选项" className="text-[#888]">
                  <Ellipsis className="size-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-1">
                {(Object.entries(views) as [View, string][]).map(([key, label]) => (
                  <Button
                    key={key}
                    variant="ghost"
                    className="h-8 w-full justify-start text-xs font-normal"
                    onClick={() => {
                      setView(key);
                      setViewMenuOpen(false);
                      setProject("");
                      setQuery("");
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
          {(searchOpen || query) && (
            <div className="mb-5 flex items-center gap-2">
              <InputGroup className="min-w-0 flex-1 shadow-none">
                <InputGroupAddon>
                  <Search className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  id="task-search"
                  aria-label="搜索任务"
                  placeholder="搜索"
                  inputMode="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="清除搜索"
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
                <SelectTrigger aria-label="筛选项目" className="w-28 shrink-0 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有项目</SelectItem>
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
                  onClick={() => void load()}
                  disabled={loading || busy}
                  className="h-auto p-0 text-current"
                >
                  {needsCheck ? "刷新检查" : "重新连接"}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <section aria-label="任务列表" aria-busy={loading}>
            {loading && !loaded && (
              <div className="flex h-12 items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-4" aria-label="正在连接 RN" />
                正在加载
              </div>
            )}
            {inbox ? (
              <>
                {visible.filter((task) => !task.project).map(renderTask)}
                <Button
                  variant="ghost"
                  disabled={busy || needsCheck}
                  onClick={openQuickAdd}
                  className="mt-1 h-8 justify-start gap-2.5 px-0 text-sm font-normal text-[#808080] hover:bg-transparent hover:text-primary has-[>svg]:px-0"
                >
                  <Plus className="size-[18px] text-primary" strokeWidth={1.5} />
                  添加任务
                </Button>
                <div className="mt-8 space-y-8">
                  {filterProjects.map((name) => {
                    const items = visible.filter((task) => task.project === name);
                    return (
                      <Collapsible key={name}>
                        <div className="flex items-center border-b border-[#f6f6f6]">
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              className="group relative h-10 min-w-0 flex-1 justify-start gap-1.5 rounded-none px-0 text-sm font-semibold hover:bg-transparent has-[>svg]:px-0"
                            >
                              <ChevronRight className="absolute -left-5 size-3 text-[#aaa] transition-transform group-data-[state=open]:rotate-90" />
                              <span className="truncate">{name}</span>
                              <span className="text-xs font-normal text-[#999]">{items.length}</span>
                            </Button>
                          </CollapsibleTrigger>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`项目选项：${name}`}
                                className="text-[#999]"
                              >
                                <Ellipsis className="size-[18px]" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-36 p-1">
                              <Button
                                variant="ghost"
                                className="h-8 w-full justify-start text-xs font-normal"
                                onClick={() => {
                                  setProject(name);
                                  setView("pending");
                                }}
                              >
                                打开项目
                              </Button>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <CollapsibleContent>
                          {items.map(renderTask)}
                          {!items.length && <p className="py-3 text-xs text-muted-foreground">没有任务</p>}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                {!visible.length && loaded && (
                  <Empty className="border-0 py-12">
                    <EmptyHeader>
                      <EmptyTitle className="text-sm font-normal">{emptyTitle}</EmptyTitle>
                    </EmptyHeader>
                    {(query || currentProject) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQuery("");
                          setProject("");
                        }}
                      >
                        清除筛选
                      </Button>
                    )}
                  </Empty>
                )}
                {(Object.keys(groups) as (keyof typeof groups)[]).map((group) => {
                  const items = visible.filter((task) => taskGroup(task) === group);
                  if (!items.length) return null;
                  return (
                    <div key={group}>
                      {view !== "pending" && (
                        <h2 className="mt-6 mb-2 border-b pb-2 text-sm font-semibold">{groups[group]}</h2>
                      )}
                      {items.map(renderTask)}
                    </div>
                  );
                })}
                <Button
                  variant="ghost"
                  onClick={openQuickAdd}
                  disabled={busy || needsCheck}
                  className="mt-2 h-8 gap-2.5 px-0 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-primary has-[>svg]:px-0"
                >
                  <Plus className="size-[18px] text-primary" strokeWidth={1.5} />
                  添加任务
                </Button>
              </>
            )}
          </section>
        </main>
        <Button
          onClick={openQuickAdd}
          disabled={busy || needsCheck}
          aria-label="快速添加任务"
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
          setView("pending");
          setProject(addedProject);
          setQuery("");
          requestAnimationFrame(() => document.getElementById("view-title")?.focus());
        }}
      />

      <TaskEditor
        open={open}
        busy={busy}
        title={editing ? "编辑任务" : "新任务"}
        onOpenChange={(value) => {
          if (!writeLock.current) setOpen(value);
        }}
      >
        <form
          noValidate
          onSubmit={submit}
          className="flex min-h-0 flex-col"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          <div data-editor-body className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-6">
            <Label htmlFor="description" className="sr-only">
              任务描述
            </Label>
            <Textarea
              id="description"
              placeholder="要做什么？"
              value={draft.description}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
                setFormError("");
              }}
              disabled={busy || needsCheck}
              required
              maxLength={2000}
              rows={3}
              aria-invalid={formError === "请填写任务描述"}
              aria-describedby={formError ? "editor-error" : undefined}
              className="min-h-28 resize-none md:text-base"
            />
            <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-5 border-t pt-5 min-[360px]:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="edit-project" className="text-xs leading-4 font-normal text-muted-foreground">
                  项目
                </Label>
                <ProjectPicker
                  value={draft.project || ""}
                  projects={projects}
                  onChange={(project) => {
                    setDraft({ ...draft, project });
                    setFormError("");
                  }}
                  disabled={busy || needsCheck}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="due" className="text-xs leading-4 font-normal text-muted-foreground">
                  截止日期
                </Label>
                <DatePicker
                  value={due}
                  onChange={(value) => {
                    setDue(value);
                    setFormError("");
                  }}
                  disabled={busy || needsCheck}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="tags" className="text-xs leading-4 font-normal text-muted-foreground">
                  标签
                </Label>
                <Input
                  id="tags"
                  placeholder="用逗号分隔"
                  value={tags}
                  disabled={busy || needsCheck}
                  onChange={(event) => {
                    setTags(event.target.value);
                    setFormError("");
                  }}
                  className="h-11 text-base md:text-base"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="priority" className="text-xs leading-4 font-normal text-muted-foreground">
                  优先级
                </Label>
                <Select
                  disabled={busy || needsCheck}
                  value={draft.priority || "none"}
                  onValueChange={(value) => {
                    setDraft({ ...draft, priority: value === "none" ? "" : value });
                    setFormError("");
                  }}
                >
                  <SelectTrigger id="priority" className="h-11 min-h-11 w-full text-base data-[size=default]:h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">无</SelectItem>
                    <SelectItem value="L">低</SelectItem>
                    <SelectItem value="M">中</SelectItem>
                    <SelectItem value="H">高</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!!editing?.annotations.length && (
              <p className="mt-5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {editing.annotations.map((note) => note.description).join("\n")}
              </p>
            )}
            {formError && (
              <Alert id="editor-error" variant="destructive" className="mt-5">
                <AlertDescription>
                  {formError}
                  {needsCheck && (
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => setOpen(false)}
                      className="h-auto p-0 text-current"
                    >
                      关闭并检查列表
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div
            data-editor-actions
            className="flex shrink-0 items-center justify-between gap-4 border-t px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:py-5"
          >
            {editing && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || needsCheck}
                onClick={() => setConfirmDelete(true)}
                className="h-11 px-0 text-xs text-destructive"
              >
                删除任务
              </Button>
            )}
            <Button type="submit" disabled={busy || needsCheck} className="ml-auto h-11 min-w-24">
              {busy ? <Spinner className="size-4" /> : "保存"}
            </Button>
          </div>
        </form>
      </TaskEditor>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个任务？</AlertDialogTitle>
            <AlertDialogDescription>删除后不再显示。需要时可以通过 Taskwarrior 恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (editing) void mutate("action", { uuid: editing.uuid, action: "delete" }, "editor");
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              删除任务
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
