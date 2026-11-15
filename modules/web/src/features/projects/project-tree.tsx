import { Button } from "@/components/ui/button";
import { formatDescriptionPreview } from "@core/tasks/description";
import {
    focusProject,
    inProject,
    projectStatus,
    type ProjectStatus,
} from "@core/workspace/focus";
import type { Organization } from "@core/workspace/organization";
import {
    projectPath,
    projectTaskCount,
    projectTree,
} from "@core/workspace/projects";
import { ChevronDown, ChevronRight, Target } from "lucide-react";
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
        const root = roots?.find((name) => inProject(row.name, name));
        const depth = row.depth - (root ? root.split(".").length - 1 : 0);
        const count = projectTaskCount(row.name, data.projectCounts);
        const isCollapsed = collapsed.has(row.name) && !matches;
        return (
            <div
                key={row.name}
                data-project-row
                data-project-nav={compact ? "" : undefined}
                data-selected={
                    compact && current === row.name ? "true" : undefined
                }
                className={`group/project flex min-w-0 items-center gap-0.5 ${
                    compact
                        ? "min-h-8 pr-1"
                        : "project-manager-row -mx-2.5 min-h-14 pr-2.5 md:-mx-3 md:pr-3"
                }`}
                style={{
                    paddingInlineStart:
                        (compact ? (anyHasChildren ? 4 : 0) : 10) +
                        Math.min(depth, compact ? 4 : 6) * (compact ? 12 : 16),
                }}
            >
                {anyHasChildren &&
                    (row.hasChildren ? (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-6 shrink-0 text-muted-foreground"
                            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${row.name}`}
                            aria-expanded={!isCollapsed}
                            disabled={!!matches}
                            title={
                                matches
                                    ? "Search expands matching branches"
                                    : undefined
                            }
                            onClick={() =>
                                setCollapsed((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(row.name))
                                        next.delete(row.name);
                                    else next.add(row.name);
                                    return next;
                                })
                            }
                        >
                            {isCollapsed ? (
                                <ChevronRight className="size-3.5" />
                            ) : (
                                <ChevronDown className="size-3.5" />
                            )}
                        </Button>
                    ) : (
                        <span className="w-6 shrink-0" />
                    ))}
                <Button
                    variant={compact ? "navigation" : "ghost"}
                    disabled={disabled}
                    aria-current={current === row.name ? "page" : undefined}
                    title={projectPath(row.name)}
                    onClick={() => onOpen(row.name)}
                    className={
                        compact
                            ? `min-w-0 flex-1 gap-2.5 text-left ${anyHasChildren ? "px-1.5 has-[>svg]:px-1.5" : "px-2.5 has-[>svg]:px-2.5"}`
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
                        {!compact &&
                            !record?.outcome &&
                            record?.description && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                    {formatDescriptionPreview(
                                        record.description,
                                    )}
                                </span>
                            )}
                        {depth > (compact ? 4 : 6) && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                                {projectPath(row.parent)}
                            </span>
                        )}
                    </span>
                    {compact && !!count && (
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                            {count}
                        </span>
                    )}
                </Button>
                {!compact && (
                    <div className="flex shrink-0 items-center gap-2">
                        {inherited && inherited.name !== row.name ? (
                            <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-block">
                                焦点中
                            </span>
                        ) : projectStatus(record) === "active" ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={disabled}
                                title="移至稍后"
                                onClick={() => onStatus(row.name, "later")}
                                className="h-6 gap-1 rounded-full border border-primary/25 bg-primary/8 px-2.5 text-[11px] font-medium text-foreground hover:bg-primary/15"
                            >
                                <Target className="size-3" strokeWidth={1.8} />
                                焦点
                            </Button>
                        ) : projectStatus(record) === "later" ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={disabled}
                                title="设为焦点项目"
                                onClick={() => onStatus(row.name, "active")}
                                className="h-6 gap-1 rounded-full border border-border/80 px-2.5 text-[11px] font-normal text-muted-foreground transition-opacity hover:border-border hover:bg-background hover:text-foreground md:opacity-0 md:group-hover/project:opacity-100 md:group-focus-within/project:opacity-100"
                            >
                                <Target className="size-3" strokeWidth={1.6} />
                                设为焦点
                            </Button>
                        ) : (
                            <span className="hidden text-xs capitalize text-muted-foreground sm:inline">
                                {projectStatus(record)}
                            </span>
                        )}
                        <span className="min-w-6 text-right text-xs tabular-nums text-muted-foreground">
                            {count || ""}
                        </span>
                    </div>
                )}
                <ProjectActions
                    name={row.name}
                    status={projectStatus(record)}
                    onStatus={
                        inherited && inherited.name !== row.name
                            ? undefined
                            : onStatus
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
