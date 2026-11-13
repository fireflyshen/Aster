import { FilterIcon, LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ProjectTree } from "@/features/projects/project-tree";
import { formatDuration, type EnergySummary } from "@core/workspace/energy";
import type { ProjectStatus } from "@core/workspace/focus";
import {
  itemColor,
  type Organization,
  type SavedFilter,
  type SavedTag,
} from "@core/workspace/organization";
import { cn } from "cn";
import { ChevronRight, Plus, Zap } from "lucide-react";

/** Renders favorite filters and tags in the workspace sidebar. */
export function SidebarFavorites({
  organization,
  organizationPage,
  activeEntry,
  disabled,
  onEntry,
}: {
  organization: Organization;
  organizationPage: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  disabled: boolean;
  onEntry: (entry: {
    kind: "filter" | "tag";
    item: SavedFilter | SavedTag;
  }) => void;
}) {
  const hasFavorites =
    organization.filters.some((item) => item.favorite) ||
    organization.tags.some((item) => item.favorite);
  if (!hasFavorites) return null;

  return (
    <>
      <p className="mt-6 mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
        收藏
      </p>
      <nav aria-label="收藏" className="space-y-0.5">
        {organization.filters
          .filter((item) => item.favorite)
          .map((item) => (
            <Button
              key={item.id}
              variant="navigation"
              disabled={disabled}
              aria-current={
                !organizationPage && activeEntry?.id === item.id
                  ? "page"
                  : undefined
              }
              onClick={() => onEntry({ kind: "filter", item })}
            >
              <FilterIcon
                className="size-[18px]"
                style={{ color: itemColor(item.color) }}
              />
              <span className="truncate">{item.name}</span>
            </Button>
          ))}
        {organization.tags
          .filter((item) => item.favorite)
          .map((item) => (
            <Button
              key={item.id}
              variant="navigation"
              disabled={disabled}
              aria-current={
                !organizationPage && activeEntry?.id === item.id
                  ? "page"
                  : undefined
              }
              onClick={() => onEntry({ kind: "tag", item })}
            >
              <LabelIcon
                className="size-[18px]"
                style={{ color: itemColor(item.color) }}
              />
              <span className="truncate">{item.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {item.count || ""}
              </span>
            </Button>
          ))}
      </nav>
    </>
  );
}

/** Renders Active Focus projects and collapsible Later projects inside the sidebar. */
export function SidebarProjectsSection({
  organization,
  organizationPage,
  projectsPage,
  hasActiveItem,
  currentProject,
  activeRoots,
  laterProjects,
  laterCollapsed,
  disabled,
  onToggleLater,
  onProjects,
  onAddProject,
  onAddSubproject,
  onEditProject,
  onDeleteProject,
  onProjectStatus,
  onSelectProject,
}: {
  organization: Organization;
  organizationPage: boolean;
  projectsPage: boolean;
  hasActiveItem: boolean;
  currentProject: string;
  activeRoots: string[];
  laterProjects: string[];
  laterCollapsed: boolean;
  disabled: boolean;
  onToggleLater: () => void;
  onProjects: () => void;
  onAddProject: () => void;
  onAddSubproject: (name: string) => void;
  onEditProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onProjectStatus: (name: string, status: ProjectStatus) => void;
  onSelectProject: (name: string) => void;
}) {
  const current =
    !organizationPage && !hasActiveItem ? currentProject : undefined;

  return (
    <>
      <div className="mt-6 mb-1 flex items-center justify-between pl-0.5">
        <Button
          variant="ghost"
          onClick={onProjects}
          disabled={disabled}
          aria-label="管理项目"
          aria-current={organizationPage && projectsPage ? "page" : undefined}
          className="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-navigation-hover hover:text-foreground aria-[current=page]:bg-navigation-selected aria-[current=page]:text-foreground"
        >
          我的项目
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="添加项目"
          disabled={disabled}
          onClick={onAddProject}
          className="size-7 text-muted-foreground hover:bg-navigation-hover hover:text-foreground"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <nav aria-label="项目" className="flex-1 space-y-0.5">
        {activeRoots.length > 0 && (
          <ProjectTree
            names={activeRoots}
            data={organization}
            roots={activeRoots}
            compact
            current={current}
            disabled={disabled}
            onOpen={onSelectProject}
            onAddChild={onAddSubproject}
            onStatus={onProjectStatus}
            onEdit={onEditProject}
            onDelete={onDeleteProject}
          />
        )}
        {laterProjects.length > 0 && (
          <div className={activeRoots.length > 0 ? "pt-2" : ""}>
            {activeRoots.length > 0 && (
              <button
                type="button"
                aria-expanded={!laterCollapsed}
                onClick={onToggleLater}
                className="mb-0.5 flex h-6 w-full items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors select-none hover:bg-navigation-hover hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform duration-150",
                    !laterCollapsed && "rotate-90",
                  )}
                />
                稍后 · {laterProjects.length}
              </button>
            )}
            {(!laterCollapsed || activeRoots.length === 0) && (
              <ProjectTree
                names={laterProjects}
                data={organization}
                compact
                current={current}
                disabled={disabled}
                onOpen={onSelectProject}
                onAddChild={onAddSubproject}
                onStatus={onProjectStatus}
                onEdit={onEditProject}
                onDelete={onDeleteProject}
              />
            )}
          </div>
        )}
        {activeRoots.length === 0 && laterProjects.length === 0 && (
          <Button
            variant="navigation"
            disabled={disabled}
            onClick={onAddProject}
            className="h-8 text-xs text-muted-foreground"
          >
            <Plus className="size-3.5" />
            新建项目
          </Button>
        )}
      </nav>
    </>
  );
}

/** Renders sidebar timing status, daily energy gauge, and Elixir restore button. */
export function SidebarEnergyMeter({
  energy,
  timingUnavailable,
  disabled,
  busy,
  onRetryTiming,
  onElixir,
}: {
  energy?: EnergySummary;
  timingUnavailable?: boolean;
  disabled: boolean;
  busy: boolean;
  onRetryTiming?: () => void;
  onElixir?: () => void;
}) {
  return (
    <>
      {timingUnavailable && (
        <div
          role="status"
          className="mt-6 space-y-1 px-2.5 text-xs leading-5 text-muted-foreground"
        >
          <p>计时数据不可用</p>
          <p>暂时无法计算精力值。</p>
          <Button
            variant="link"
            size="sm"
            onClick={onRetryTiming}
            disabled={busy}
            className="h-7 px-0 text-xs"
          >
            重试
          </Button>
        </div>
      )}
      {energy && (
        <div className="mt-6 space-y-1.5 px-2.5" aria-label="每日精力">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground tabular-nums">
              <Zap
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.6}
              />
              {energy.remaining} / {energy.max}
            </span>
            <span className="tabular-nums">
              {formatDuration(energy.trackedSecondsToday)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="剩余每日精力"
            aria-valuemin={0}
            aria-valuemax={energy.max}
            aria-valuenow={energy.remaining}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                energy.remaining === 0
                  ? "bg-destructive"
                  : energy.remaining <= 25
                    ? "bg-foreground/50"
                    : "bg-foreground/80",
              )}
              style={{
                width: `${Math.min(100, Math.round((energy.remaining / Math.max(1, energy.max)) * 100))}%`,
              }}
            />
          </div>
          {energy.remaining <= 25 && onElixir && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onElixir}
              className="h-6 w-full justify-start px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground has-[>svg]:px-0"
            >
              <Plus className="size-3" />
              恢复 +30 精力
            </Button>
          )}
        </div>
      )}
    </>
  );
}
