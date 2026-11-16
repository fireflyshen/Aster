import { Button } from "@/components/ui/button";
import { formatDescriptionPreview } from "@core/tasks/description";
import {
  focusProject,
  inProject,
  isHabitProject,
  projectStatus,
  type ProjectStatus,
} from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import {
  projectPath,
  projectTaskCount,
  projectTree,
} from "@core/workspace/projects";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Repeat2,
  Target,
} from "lucide-react";
import { useState } from "react";
import { ProjectActions } from "./project-actions";
import { ProjectIcon } from "./project-icon";

export function ProjectTree({
  names,
  data,
  matches,
  roots,
  current,
  compact = false,
  disabled,
  onOpen,
  onAddChild,
  onEdit,
  onDelete,
  onStatus,
}: {
  names: string[];
  data: Organization;
  matches?: ReadonlySet<string>;
  roots?: string[];
  current?: string;
  compact?: boolean;
  disabled: boolean;
  onOpen: (name: string) => void;
  onAddChild: (name: string) => void;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
  onStatus: (name: string, status: ProjectStatus) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const records = new Map(
    data.projects?.map((project) => [project.name, project]),
  );
  const rows = projectTree(names, collapsed, matches).filter(
    (row) => !roots || roots.some((root) => inProject(row.name, root)),
  );
  const anyHasChildren = rows.some((row) => row.hasChildren);

  return rows.map((row) => {
    const record = records.get(row.name);
    const inherited = focusProject(row.name, data.projects);
    const isHabit = isHabitProject(row.name, data.projects);
    const root = roots?.find((name) => inProject(row.name, name));
    const depth = row.depth - (root ? root.split(".").length - 1 : 0);
    const count = projectTaskCount(row.name, data.projectCounts);
    const isCollapsed = collapsed.has(row.name) && !matches;
    const toggleButton = row.hasChildren ? (
      <Button
        variant="ghost"
        size="icon-sm"
        className={
          compact
            ? "project-tree-toggle shrink-0 text-muted-foreground/75 hover:bg-navigation-hover hover:text-foreground"
            : "size-6 shrink-0 text-muted-foreground"
        }
        aria-label={`${isCollapsed ? "展开" : "收起"} ${row.name}`}
        aria-expanded={!isCollapsed}
        disabled={!!matches}
        title={matches ? "搜索时会展开匹配分支" : undefined}
        onClick={() =>
          setCollapsed((previous) => {
            const next = new Set(previous);
            if (next.has(row.name)) next.delete(row.name);
            else next.add(row.name);
            return next;
          })
        }
      >
        {compact ? (
          <ChevronDown
            className={`size-3.5 transition-transform duration-150 ${
              isCollapsed ? "-rotate-90" : ""
            }`}
          />
        ) : isCollapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
      </Button>
    ) : null;

    return (
      <div
        key={row.name}
        data-project-row
        data-project-nav={compact ? "" : undefined}
        data-selected={compact && current === row.name ? "true" : undefined}
        className={`group/project flex min-w-0 items-center gap-0.5 ${
          compact
            ? "min-h-8 pr-1"
            : "project-manager-row -mx-2.5 min-h-14 pr-2.5 md:-mx-3 md:pr-3"
        }`}
        style={{
          paddingInlineStart:
            (compact ? 0 : 10) +
            Math.min(depth, compact ? 4 : 6) * (compact ? 16 : 16),
        }}
      >
        {!compact &&
          anyHasChildren &&
          (toggleButton ?? <span className="w-6 shrink-0" />)}
        <Button
          variant={compact ? "navigation" : "ghost"}
          disabled={disabled}
          aria-current={current === row.name ? "page" : undefined}
          title={projectPath(row.name)}
          onClick={() => onOpen(row.name)}
          className={
            compact
              ? "min-w-0 flex-1 gap-2.5 text-left"
              : "h-auto min-h-14 min-w-0 flex-1 justify-start gap-2.5 px-1.5 py-2 text-left font-normal has-[>svg]:px-1.5"
          }
        >
          <ProjectIcon
            name={row.name}
            className={compact ? "size-[18px]" : "size-4"}
          />
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate ${compact ? "" : "font-medium text-foreground"}`}
            >
              {root === row.name && row.parent
                ? projectPath(row.name)
                : row.label}
            </span>
            {!compact && record?.outcome && (
              <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <Target className="size-3 shrink-0 opacity-70" />
                <span className="truncate">
                  {formatDescriptionPreview(record.outcome)}
                </span>
              </span>
            )}
            {!compact && !record?.outcome && record?.description && (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {formatDescriptionPreview(record.description)}
              </span>
            )}
            {depth > (compact ? 4 : 6) && (
              <span className="block truncate text-[11px] text-muted-foreground">
                {projectPath(row.parent)}
              </span>
            )}
          </span>
        </Button>
        {!compact && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="project-row-status">
              {projectStatus(record) === "completed" ? (
                <>
                  <Check />
                  已完成
                </>
              ) : isHabit ? (
                <>
                  <Repeat2 />
                  习惯
                </>
              ) : inherited || projectStatus(record) === "active" ? (
                <>
                  <Target />
                  {inherited && inherited.name !== row.name ? "焦点中" : "焦点"}
                </>
              ) : (
                <>
                  <Clock3 />
                  稍后
                </>
              )}
            </span>
            <span className="min-w-6 text-right text-xs tabular-nums text-muted-foreground">
              {count || ""}
            </span>
          </div>
        )}
        {compact && toggleButton}
        <ProjectActions
          compact={compact}
          count={count}
          name={row.name}
          status={projectStatus(record)}
          canFocus={!isHabit}
          onStatus={
            inherited && inherited.name !== row.name ? undefined : onStatus
          }
          disabled={disabled}
          onAddChild={onAddChild}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    );
  });
}
