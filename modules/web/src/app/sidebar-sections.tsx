import { FilterIcon, LabelIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useBuiltinFilterPrefs } from "@/features/organization/builtin-filter-prefs";
import { RowMenu } from "@/features/organization/organization-row";
import type { OrganizationEntry } from "@/features/organization/organization-types";
import { ProjectTree } from "@/features/projects/project-tree";
import { formatDuration, type EnergySummary } from "@core/workspace/energy";
import type { TimerSnapshot } from "@core/time/model";
import type { snapshotLiveStatus } from "@core/time/snapshot";
import type { ProjectStatus } from "@core/workspace/focus";
import {
  itemColor,
  type Organization,
  type OrganizationChange,
  type SavedFilter,
  type SavedTag,
  type WorkspaceTiming,
} from "@core/workspace/organization";
import { cn } from "cn";
import { Clock3, Plus, RefreshCw, Zap } from "lucide-react";

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Renders favorite filters and tags in the workspace sidebar. */
export function SidebarFavorites({
  organization,
  organizationPage,
  activeEntry,
  disabled,
  onEntry,
  onEditEntry,
  onChange,
}: {
  organization: Organization;
  organizationPage: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  disabled: boolean;
  onEntry: (entry: OrganizationEntry) => void;
  onEditEntry: (entry: OrganizationEntry) => void;
  onChange: (change: OrganizationChange) => Promise<boolean>;
}) {
  const { builtinFilters, toggleFavorite } = useBuiltinFilterPrefs(
    organization,
    onChange,
  );
  const entries: OrganizationEntry[] = [
    ...[...organization.filters, ...builtinFilters]
      .filter((item) => item.favorite)
      .map((item) => ({ kind: "filter" as const, item })),
    ...organization.tags
      .filter((item) => item.favorite)
      .map((item) => ({ kind: "tag" as const, item })),
  ];
  if (!entries.length) return null;
  return (
    <>
      <p className="mt-6 mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
        收藏
      </p>
      <nav aria-label="收藏" className="space-y-0.5">
        {entries.map((entry) => {
          const { item, kind } = entry;
          const Icon = kind === "filter" ? FilterIcon : LabelIcon;
          const isBuiltin = kind === "filter" && item.id.startsWith("builtin:");
          return (
            <div
              key={`${kind}:${item.id}`}
              className="sidebar-favorite-row"
              data-selected={
                !organizationPage && activeEntry?.id === item.id
                  ? "true"
                  : undefined
              }
            >
              <Button
                variant="navigation"
                disabled={disabled}
                aria-current={
                  !organizationPage && activeEntry?.id === item.id
                    ? "page"
                    : undefined
                }
                onClick={() => onEntry(entry)}
                className="min-w-0 flex-1"
              >
                <Icon
                  className="size-5"
                  style={{ color: itemColor(item.color) }}
                />
                <span className="truncate">{item.name}</span>
              </Button>
              <RowMenu
                entry={entry}
                disabled={disabled}
                isBuiltin={isBuiltin}
                isHidden={false}
                compact
                count={kind === "tag" ? (item as SavedTag).count : undefined}
                onEdit={isBuiltin ? undefined : () => onEditEntry(entry)}
                onFavorite={() => {
                  void (isBuiltin
                    ? toggleFavorite(item.id)
                    : onChange({
                        revision: organization.revision,
                        action: "save",
                        kind,
                        item: { ...item, favorite: false },
                      } as OrganizationChange));
                }}
              />
            </div>
          );
        })}
      </nav>
    </>
  );
}

/** Renders all active and later projects uniformly inside the sidebar. */
export function SidebarProjectsSection({
  organization,
  organizationPage,
  projectsPage,
  hasActiveItem,
  currentProject,
  projects,
  disabled,
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
  projects: string[];
  disabled: boolean;
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
        {projects.length > 0 ? (
          <ProjectTree
            names={projects}
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
        ) : (
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
  timing,
  timerSnapshot,
  timerLiveStatus,
  activeActivitySeconds,
  timingUnavailable,
  disabled,
  busy,
  onRetryTiming,
  onElixir,
}: {
  energy?: EnergySummary;
  timing?: WorkspaceTiming;
  timerSnapshot?: TimerSnapshot;
  timerLiveStatus?: ReturnType<typeof snapshotLiveStatus>;
  activeActivitySeconds?: number;
  timingUnavailable?: boolean;
  disabled: boolean;
  busy: boolean;
  onRetryTiming?: () => void;
  onElixir?: () => void;
}) {
  const isTimeMode =
    timing?.backend === "time" || timerSnapshot?.backend === "time";
  const hardEnergyLimit = !isTimeMode && timing?.hardEnergyLimit !== false;
  const activeActivity = timerSnapshot?.activeActivity ?? null;
  const periodLabel =
    energy?.periodLabel ||
    (energy?.resetHour !== undefined
      ? `${String(energy.resetHour).padStart(2, "0")}:00 周期`
      : undefined);
  const autoStopMs = activeActivity?.autoStopAt
    ? Date.parse(activeActivity.autoStopAt)
    : Number.NaN;
  const hasAutoStop = Number.isFinite(autoStopMs);
  const remainingAutoStopSec = hasAutoStop
    ? Math.max(0, Math.ceil((autoStopMs - Date.now()) / 1000))
    : undefined;
  const autoStopClockLabel = hasAutoStop
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(autoStopMs))
    : undefined;

  return (
    <>
      {isTimeMode && timerSnapshot && timerSnapshot.state !== "ready" && (
        <div
          role="status"
          className="mt-6 space-y-1 px-2.5 text-xs leading-5 text-muted-foreground"
        >
          <p className="font-medium text-foreground">
            {timerSnapshot.state === "pending_reconcile"
              ? "计时待核对"
              : timerSnapshot.state === "restoring"
                ? "时间账本恢复中"
                : "计时数据不可用"}
          </p>
          <p>
            {timerSnapshot.state === "pending_reconcile"
              ? "存在未确认的计时操作，请刷新核对状态。"
              : timerSnapshot.state === "restoring"
                ? "正在恢复时间数据，已停止计时外推。"
                : "暂时无法读取时间状态。"}
          </p>
          {onRetryTiming && (
            <Button
              variant="link"
              size="sm"
              onClick={onRetryTiming}
              disabled={busy}
              className="h-7 px-0 text-xs"
            >
              刷新核对
            </Button>
          )}
        </div>
      )}
      {isTimeMode && activeActivity && (
        <div
          className="mt-6 space-y-1.5 rounded-md border border-border/70 bg-muted/35 px-2.5 py-2 text-xs"
          aria-label="当前计时活动"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
              <Clock3
                className="size-3.5 shrink-0 text-primary"
                strokeWidth={1.6}
              />
              <span className="truncate">
                {activeActivity.title ||
                  activeActivity.categoryId ||
                  "当前活动"}
              </span>
            </span>
            <span className="shrink-0 font-medium text-foreground tabular-nums">
              {activeActivitySeconds !== undefined
                ? formatClock(activeActivitySeconds)
                : "—"}
            </span>
          </div>
          {hasAutoStop && remainingAutoStopSec !== undefined && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
              <span>
                {remainingAutoStopSec <= 0
                  ? "已到停止时刻"
                  : `剩余 ${Math.max(1, Math.ceil(remainingAutoStopSec / 60))} 分钟`}
              </span>
              <span>{autoStopClockLabel} 停止</span>
            </div>
          )}
          {(timerLiveStatus?.stateLabel === "stale" ||
            (timerLiveStatus?.stateLabel === "review_required" &&
              !hasAutoStop)) && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {timerLiveStatus.stateLabel === "review_required"
                  ? "超长运行待确认"
                  : "连接已过期 · 已停止外推"}
              </span>
              {onRetryTiming && (
                <button
                  type="button"
                  onClick={onRetryTiming}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-foreground hover:underline"
                >
                  <RefreshCw className="size-3" />
                  刷新
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {!isTimeMode && timingUnavailable && (
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
              {energy.remaining === null
                ? `— / ${energy.max}`
                : `${energy.remaining} / ${energy.max}`}
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
            aria-valuenow={energy.remaining ?? undefined}
            aria-valuetext={
              energy.remaining === null
                ? "暂不估算剩余精力"
                : `${energy.remaining} / ${energy.max}`
            }
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                energy.remaining === null
                  ? "bg-muted-foreground/30"
                  : energy.remaining === 0 && hardEnergyLimit
                    ? "bg-destructive"
                    : energy.remaining <= 25
                      ? "bg-primary/55"
                      : "bg-primary",
              )}
              style={{
                width:
                  energy.remaining === null
                    ? "0%"
                    : `${Math.min(100, Math.round((energy.remaining / Math.max(1, energy.max)) * 100))}%`,
              }}
            />
          </div>
          {(periodLabel || energy.remaining === null) && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {energy.remaining === null
                ? energy.incompleteReason ||
                  "切换周期历史不完整，暂不估算剩余精力"
                : `${periodLabel}${!hardEnergyLimit ? " · 仅展示" : ""}`}
            </p>
          )}
          {hardEnergyLimit &&
            energy.remaining !== null &&
            energy.remaining <= 25 &&
            onElixir && (
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
