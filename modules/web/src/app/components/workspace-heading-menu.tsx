import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import type { ProjectStatus } from "@core/workspace/focus";
import type {
    SavedFilter,
    SavedProject,
    SavedTag,
} from "@core/workspace/organization";
import type { View } from "@shared/tasks";
import { cn } from "cn";
import {
    Check,
    Ellipsis,
    FileText,
    Pause,
    Pencil,
    Play,
    Plus,
    Target,
    Trash2,
} from "lucide-react";
import type { CompleteBehavior } from "../hooks/use-workspace-navigation";
import { views } from "../workspace-sidebar";

type WorkspaceHeadingMenuProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    view: View;
    completeBehavior?: CompleteBehavior;
    onCompleteBehaviorChange?: (next: CompleteBehavior) => void;
    currentProject: string;
    organizationReady: boolean;
    disabled: boolean;
    activeEntry?: { kind: "filter" | "tag"; id: string };
    activeItem?: SavedFilter | SavedTag;
    currentProjectFocus?: SavedProject;
    projectOutcome?: string;
    projectDescription?: string;
    onSelectView: (view: View) => void;
    onTransitionProject: (name: string, status: ProjectStatus) => void;
    onAddSubproject: (parent: string) => void;
    onStartEditDesc: () => void;
    onStartEditOutcome: () => void;
    onEditProject: (name: string) => void;
    onDeleteProject: (name: string) => void;
    onManageOrganization: () => void;
};

/** Context menu popover for the active view, project, or saved filter/tag heading. */
export function WorkspaceHeadingMenu({
    open,
    onOpenChange,
    view,
    completeBehavior = "hide",
    onCompleteBehaviorChange,
    currentProject,
    organizationReady,
    disabled,
    activeEntry,
    activeItem,
    currentProjectFocus,
    projectOutcome,
    projectDescription,
    onSelectView,
    onTransitionProject,
    onAddSubproject,
    onStartEditDesc,
    onStartEditOutcome,
    onEditProject,
    onDeleteProject,
    onManageOrganization,
}: WorkspaceHeadingMenuProps) {
    const metaDisabled = disabled || !organizationReady;

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label="视图选项"
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
                            disabled={disabled}
                            onClick={() => {
                                onOpenChange(false);
                                onTransitionProject(
                                    currentProjectFocus?.name || currentProject,
                                    currentProjectFocus ? "later" : "active",
                                );
                            }}
                        >
                            {currentProjectFocus ? (
                                <>
                                    <Pause className="size-3.5" />
                                    移至稍后
                                </>
                            ) : (
                                <>
                                    <Play className="size-3.5" />
                                    加入焦点
                                </>
                            )}
                        </Button>
                        <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={disabled}
                            onClick={() => {
                                onOpenChange(false);
                                onTransitionProject(
                                    currentProjectFocus?.name || currentProject,
                                    "completed",
                                );
                            }}
                        >
                            <Check className="size-3.5" />
                            完成项目
                        </Button>
                        <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={metaDisabled}
                            onClick={() => {
                                onOpenChange(false);
                                onAddSubproject(currentProject);
                            }}
                        >
                            <Plus className="size-3.5" />
                            添加子项目
                        </Button>
                        <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={metaDisabled}
                            onClick={() => {
                                onOpenChange(false);
                                onStartEditDesc();
                            }}
                        >
                            <FileText className="size-3.5" />
                            {projectDescription ? "编辑描述" : "添加描述"}
                        </Button>
                        <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={metaDisabled}
                            onClick={() => {
                                onOpenChange(false);
                                onStartEditOutcome();
                            }}
                        >
                            <Target className="size-3.5" />
                            {projectOutcome ? "编辑目标" : "设定目标"}
                        </Button>
                        <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            disabled={metaDisabled}
                            onClick={() => {
                                onOpenChange(false);
                                onEditProject(currentProject);
                            }}
                        >
                            <Pencil className="size-3.5" />
                            编辑项目
                        </Button>
                        <Button
                            variant="navigation"
                            disabled={metaDisabled}
                            className="h-8 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                                onOpenChange(false);
                                onDeleteProject(currentProject);
                            }}
                        >
                            <Trash2 className="size-3.5" />
                            删除项目
                        </Button>
                    </>
                )}

                {activeItem && (
                    <Button
                        variant="navigation"
                        className="h-8 text-xs"
                        onClick={() => {
                            onOpenChange(false);
                            onManageOrganization();
                        }}
                    >
                        <Pencil className="size-3.5" />
                        管理{activeEntry?.kind === "filter" ? "过滤器" : "标签"}
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
                                    onOpenChange(false);
                                    onSelectView(key);
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
                {onCompleteBehaviorChange && (
                    <>
                        <div className="my-1 border-t border-border/60" />
                        <Button
                            variant="navigation"
                            className="h-8 text-xs"
                            onClick={() => {
                                onCompleteBehaviorChange(
                                    completeBehavior === "strikethrough"
                                        ? "hide"
                                        : "strikethrough",
                                );
                                onOpenChange(false);
                            }}
                        >
                            <Check
                                className={cn(
                                    "size-3.5",
                                    completeBehavior !== "strikethrough" &&
                                        "invisible",
                                )}
                            />
                            完成后保留删除线
                        </Button>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
