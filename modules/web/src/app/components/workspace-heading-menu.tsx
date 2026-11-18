import { useI18n } from "@/app/language";
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

type WorkspaceHeadingMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProject: string;
  organizationReady: boolean;
  disabled: boolean;
  activeEntry?: { kind: "filter" | "tag"; id: string };
  activeItem?: SavedFilter | SavedTag;
  currentProjectFocus?: SavedProject;
  currentProjectIsHabit?: boolean;
  projectOutcome?: string;
  projectDescription?: string;
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
  currentProject,
  organizationReady,
  disabled,
  activeEntry,
  activeItem,
  currentProjectFocus,
  currentProjectIsHabit = false,
  projectOutcome,
  projectDescription,
  onTransitionProject,
  onAddSubproject,
  onStartEditDesc,
  onStartEditOutcome,
  onEditProject,
  onDeleteProject,
  onManageOrganization,
}: WorkspaceHeadingMenuProps) {
  const { t } = useI18n();
  const metaDisabled = disabled || !organizationReady;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={currentProject ? t("项目选项") : t("视图选项")}
          className="text-muted-foreground data-[state=open]:bg-accent"
        >
          <Ellipsis className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {currentProject && !activeItem && (
          <>
            {!currentProjectIsHabit && (
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
                    {t("移至稍后")}
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" />
                    {t("加入焦点")}
                  </>
                )}
              </Button>
            )}
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
              {t("完成项目")}
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
              {t("添加子项目")}
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
              {projectDescription ? t("编辑描述") : t("添加描述")}
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
              {projectOutcome ? t("编辑目标") : t("设定目标")}
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
              {t("编辑项目")}
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
              {t("删除项目")}
            </Button>
          </>
        )}

        {activeItem && (
          <>
            {"expression" in activeItem && (
              <p className="mx-1 border-b border-border px-2 py-2 text-xs wrap-anywhere text-muted-foreground">
                {activeItem.expression}
              </p>
            )}
            <Button
              variant="navigation"
              className="h-8 text-xs"
              onClick={() => {
                onOpenChange(false);
                onManageOrganization();
              }}
            >
              <Pencil className="size-3.5" />
              {t("管理")}
              {activeEntry?.kind === "filter" ? t("过滤器") : t("标签")}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
