import { useI18n } from "@/app/language";
import { FilterIcon, LabelIcon, OrganizationIcon } from "@/components/icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { ProjectIcon } from "@/features/projects/project-icon";
import {
  focusProject,
  isHabitProject,
  type ProjectStatus,
} from "@core/workspace/focus";
import {
  itemColor,
  type Organization,
  type SavedFilter,
  type SavedTag,
} from "@core/workspace/organization";
import { projectTaskCount } from "@core/workspace/projects";
import type { Task, View } from "@shared/tasks";
import {
  CalendarCheck2,
  CalendarDays,
  Columns3,
  DatabaseBackup,
  FolderPlus,
  Inbox,
  List,
  Pause,
  Pencil,
  Play,
  CircleCheck,
  PlayCircle,
  Plus,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { views } from "./workspace-sidebar";

const viewIcons: Record<View, React.ComponentType<{ className?: string }>> = {
  now: PlayCircle,
  focus: Target,
  pending: Inbox,
  today: CalendarDays,
  upcoming: CalendarDays,
};

export function CommandPalette({
  open,
  onOpenChange,
  tasks,
  projects,
  organization,
  currentProject,
  layout,
  onAddTask,
  onAddProject,
  onFocusPicker,
  onToggleLayout,
  onView,
  onProject,
  onEditProject,
  onProjectStatus,
  onEntry,
  onOrganization,
  onHabits,
  onTime,
  onAddHabit,
  onRecovery,
  onEditTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  projects: string[];
  organization: Organization;
  currentProject: string;
  layout: "list" | "board";
  onAddTask: () => void;
  onAddProject: () => void;
  onFocusPicker: () => void;
  onToggleLayout?: () => void;
  onView: (view: View) => void;
  onProject: (project: string) => void;
  onEditProject: (project: string) => void;
  onProjectStatus: (project: string, status: ProjectStatus) => void;
  onEntry: (entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) => void;
  onOrganization: () => void;
  onHabits: () => void;
  onTime: () => void;
  onAddHabit: () => void;
  onRecovery: () => void;
  onEditTask: (task: Task) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const allFilters = organization.filters;
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const pendingTasks = tasks.filter((task) => task.status !== "completed");
  const displayedTasks = search.trim()
    ? pendingTasks
    : pendingTasks.slice(0, 40);
  const currentInFocus = currentProject
    ? focusProject(currentProject, organization.projects)
    : undefined;
  const currentIsHabit = currentProject
    ? isHabitProject(currentProject, organization.projects)
    : false;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("快速查找")}
      description={t("搜索任务、项目和操作。")}
      showCloseButton={false}
      className="top-[max(4rem,14vh)] translate-y-0 rounded-xl border-border/80 shadow-modal sm:max-w-[540px]"
    >
      <CommandInput
        aria-label={t("快速查找")}
        placeholder={t("搜索…")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[min(420px,65dvh)] p-1.5">
        <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
          {t("无匹配")}
        </CommandEmpty>

        <CommandGroup heading={t("快捷操作")}>
          <CommandItem
            value={`Add task create new todo 添加任务 新建 ${t("添加任务")}`}
            onSelect={() => run(onAddTask)}
          >
            <Plus className="size-4" />
            <span>{t("添加任务")}</span>
            <CommandShortcut>Q</CommandShortcut>
          </CommandItem>
          <CommandItem
            value={`New project create folder 新建项目 ${t("新建项目")}`}
            onSelect={() => run(onAddProject)}
          >
            <FolderPlus className="size-4" />
            <span>{t("新建项目")}</span>
          </CommandItem>
          <CommandItem
            value={`New habit create habit 新建习惯 打卡 习惯 ${t("新建习惯")}`}
            onSelect={() => run(onAddHabit)}
          >
            <CalendarCheck2 className="size-4" />
            <span>{t("新建习惯")}</span>
          </CommandItem>
          <CommandItem
            value={`Choose Focus project activate goal 设为焦点项目 ${t("设为焦点项目")}`}
            onSelect={() => run(onFocusPicker)}
          >
            <Target className="size-4" />
            <span>{t("设为焦点项目")}</span>
          </CommandItem>
          {onToggleLayout && (
            <CommandItem
              value={`Switch to ${layout === "list" ? "Board" : "List"} view toggle layout 切换视图 看板 列表 ${t(layout === "list" ? "切换到看板" : "切换到列表")}`}
              onSelect={() => run(onToggleLayout)}
            >
              {layout === "list" ? (
                <Columns3 className="size-4" />
              ) : (
                <List className="size-4" />
              )}
              <span>{t(layout === "list" ? "切换到看板" : "切换到列表")}</span>
              <CommandShortcut>B</CommandShortcut>
            </CommandItem>
          )}
          {currentProject && (
            <>
              {!currentIsHabit && (
                <CommandItem
                  value={`${currentInFocus ? "Pause" : "Focus"} current project ${currentProject}`}
                  onSelect={() =>
                    run(() =>
                      onProjectStatus(
                        currentInFocus?.name || currentProject,
                        currentInFocus ? "later" : "active",
                      ),
                    )
                  }
                >
                  {currentInFocus ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  <span>{currentInFocus ? t("移至稍后") : t("加入焦点")}</span>
                </CommandItem>
              )}
              <CommandItem
                value={`Edit project 编辑项目 ${currentProject}`}
                onSelect={() => run(() => onEditProject(currentProject))}
              >
                <Pencil className="size-4" />
                <span>{t("编辑项目")}</span>
              </CommandItem>
            </>
          )}
        </CommandGroup>

        <CommandSeparator className="my-1" />

        <CommandGroup heading={t("视图")}>
          <CommandItem
            value={`Time ledger 时间账本 时间线 本周分布 成本报告 ${t("时间账本")}`}
            onSelect={() => run(onTime)}
          >
            <CalendarDays className="size-4" />
            <span>{t("时间账本")}</span>
          </CommandItem>
          {(Object.entries(views) as [View, string][]).map(([value, label]) => {
            const Icon = viewIcons[value];
            return (
              <CommandItem
                key={value}
                value={`Go to ${label} view ${value} ${t(label)}`}
                onSelect={() => run(() => onView(value))}
              >
                <Icon className="size-4" />
                <span>{t(label)}</span>
              </CommandItem>
            );
          })}
          <CommandItem
            value={`Go to Habits heatmap review 前往 习惯 热力图 打卡 ${t("习惯")}`}
            onSelect={() => run(onHabits)}
          >
            <CalendarCheck2 className="size-4" />
            <span>{t("习惯")}</span>
          </CommandItem>
          <CommandItem
            value={`Go to Filters and labels organization 过滤器 标签 ${t("过滤器 & 标签")}`}
            onSelect={() => run(onOrganization)}
          >
            <OrganizationIcon className="size-4" />
            <span>{t("过滤器 & 标签")}</span>
          </CommandItem>
          <CommandItem
            value={`Open Data and recovery backups restore 数据 恢复 ${t("数据与恢复")}`}
            onSelect={() => run(onRecovery)}
          >
            <DatabaseBackup className="size-4" />
            <span>{t("数据与恢复")}</span>
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <>
            <CommandSeparator className="my-1" />
            <CommandGroup heading={t("我的项目")}>
              {projects.map((name) => {
                const count = projectTaskCount(
                  name,
                  organization.projectCounts,
                );
                const inFocus = Boolean(
                  focusProject(name, organization.projects),
                );
                return (
                  <CommandItem
                    key={name}
                    value={`Project 项目 ${name} ${inFocus ? "focus" : "later"}`}
                    onSelect={() => run(() => onProject(name))}
                  >
                    <ProjectIcon name={name} className="size-4 shrink-0" />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {inFocus && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t("焦点")}
                        </span>
                      )}
                      {count > 0 && (
                        <span className="tabular-nums">{count}</span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {(allFilters.length > 0 || organization.tags.length > 0) && (
          <>
            <CommandSeparator className="my-1" />
            <CommandGroup heading={t("过滤器 & 标签")}>
              {allFilters.map((item) => (
                <CommandItem
                  key={`filter-${item.id}`}
                  value={`Filter 过滤器 ${item.name} ${item.expression}`}
                  onSelect={() => run(() => onEntry({ kind: "filter", item }))}
                >
                  <FilterIcon
                    className="size-4"
                    style={{ color: itemColor(item.color) }}
                  />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
              {organization.tags.map((item) => (
                <CommandItem
                  key={`tag-${item.id}`}
                  value={`Label tag 标签 @${item.name}`}
                  onSelect={() => run(() => onEntry({ kind: "tag", item }))}
                >
                  <LabelIcon
                    className="size-4"
                    style={{ color: itemColor(item.color) }}
                  />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {displayedTasks.length > 0 && (
          <>
            <CommandSeparator className="my-1" />
            <CommandGroup heading={t("任务")}>
              {displayedTasks.map((task) => (
                <CommandItem
                  key={task.uuid}
                  value={`Task 任务 ${task.description} ${task.project || ""} ${task.tags.join(" ")}`}
                  onSelect={() => run(() => onEditTask(task))}
                >
                  <CircleCheck className="size-4 text-muted-foreground/70" />
                  <span className="truncate">{task.description}</span>
                  {task.project && (
                    <span
                      className="ml-auto max-w-[40%] truncate text-xs text-muted-foreground"
                      title={task.project}
                    >
                      {task.project}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
