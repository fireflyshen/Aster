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
import { Spinner } from "@/components/ui/spinner";
import { FocusPicker } from "@/features/projects/focus-picker";
import { ProjectEditor } from "@/features/projects/project-editor";
import { ProjectTransition } from "@/features/projects/project-transition";
import { RecoveryCenter } from "@/features/recovery/recovery-center";
import { api } from "@/lib/api";
import type { ProjectStatus } from "@core/workspace/focus";
import type {
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import { projectNames } from "@core/workspace/projects";
import type { MutableRefObject } from "react";

export type ProjectWorkspaceDialogsProps = {
  organizationPage: boolean;
  organization: Organization;
  organizationError: string;
  organizationReady: boolean;
  organizationSaving: boolean;
  organizationBlocked: boolean;
  organizationGeneration: MutableRefObject<number>;
  filterProjects: string[];
  busy: boolean;
  needsCheck: boolean;
  notice: string;
  setNeedsCheck: (value: boolean) => void;
  writeLock: MutableRefObject<boolean>;
  recoveryOpen: boolean;
  setRecoveryOpen: (open: boolean) => void;
  editingProject?: string;
  setEditingProject: (name: string | undefined) => void;
  newProjectParent: string;
  focusPickerOpen: boolean;
  setFocusPickerOpen: (open: boolean) => void;
  transitionProject?: { name: string; status: ProjectStatus };
  setTransitionProject: (
    value: { name: string; status: ProjectStatus } | undefined,
  ) => void;
  deletingProject?: { name: string; revision: number };
  setDeletingProject: (
    value:
      | { name: string; revision: number }
      | ((
          current: { name: string; revision: number } | undefined,
        ) => { name: string; revision: number } | undefined)
      | undefined,
  ) => void;
  onSelectProject: (name: string) => void;
  onTransitionProject: (name: string, status: ProjectStatus) => void;
  onMutate: (
    route: string,
    data: unknown,
    origin?: "editor" | "quick" | "notes",
  ) => Promise<boolean>;
  onChangeOrganization: (change: OrganizationChange) => Promise<boolean>;
  onSetOrganization: React.Dispatch<React.SetStateAction<Organization>>;
  onSetOrganizationError: (err: string) => void;
  onSetOrganizationSaving: (saving: boolean) => void;
  onReloadAll: () => Promise<Organization | undefined>;
};

/** Renders project editor, focus picker, status transition, delete confirmation, and recovery dialogs. */
export function ProjectWorkspaceDialogs(props: ProjectWorkspaceDialogsProps) {
  const {
    organizationPage,
    organization,
    organizationError,
    organizationReady,
    organizationSaving,
    organizationBlocked,
    organizationGeneration,
    filterProjects,
    busy,
    needsCheck,
    notice,
    setNeedsCheck,
    writeLock,
    recoveryOpen,
    setRecoveryOpen,
    editingProject,
    setEditingProject,
    newProjectParent,
    focusPickerOpen,
    setFocusPickerOpen,
    transitionProject,
    setTransitionProject,
    deletingProject,
    setDeletingProject,
    onSelectProject,
    onTransitionProject,
    onMutate,
    onChangeOrganization,
    onSetOrganization,
    onSetOrganizationError,
    onSetOrganizationSaving,
    onReloadAll,
  } = props;

  const activeProjectMeta =
    editingProject !== undefined
      ? organization.projects?.find((item) => item.name === editingProject)
      : undefined;

  return (
    <>
      {editingProject !== undefined && (
        <ProjectEditor
          project={editingProject}
          projects={projectNames(filterProjects)}
          initialParent={newProjectParent || undefined}
          color={activeProjectMeta?.color}
          description={activeProjectMeta?.description || ""}
          outcome={activeProjectMeta?.outcome || ""}
          nextTask={activeProjectMeta?.nextTask || ""}
          revision={organization.revision}
          busy={organizationSaving}
          blocked={!organizationReady || organizationBlocked || needsCheck}
          error={organizationError}
          onClose={() => setEditingProject(undefined)}
          onReload={onReloadAll}
          onSave={async (
            name,
            description,
            revision,
            outcome,
            nextTask,
            color,
          ) => {
            const isNew = !editingProject;
            const saved = await onChangeOrganization({
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
            });
            if (saved && isNew && !organizationPage) {
              onSelectProject(name);
            }
            return saved;
          }}
        />
      )}

      {focusPickerOpen && !transitionProject && (
        <FocusPicker
          data={organization}
          busy={organizationSaving}
          error={organizationError}
          onClose={() => setFocusPickerOpen(false)}
          onChoose={(name) => onTransitionProject(name, "active")}
          onCreateAndFocus={async (name, outcome, replaceProject) => {
            if (writeLock.current || organizationBlocked || needsCheck) {
              return false;
            }
            writeLock.current = true;
            onSetOrganizationSaving(true);
            onSetOrganizationError("");
            organizationGeneration.current++;
            try {
              const created = await api<Organization>("organization", {
                kind: "project",
                action: "save",
                revision: organization.revision,
                item: {
                  name,
                  description: "",
                  outcome,
                  nextTask: "",
                },
              });
              const activated = await api<Organization>("organization", {
                kind: "project",
                action: "status",
                revision: created.revision,
                name,
                status: "active",
                outcome,
                ...(replaceProject ? { replaceProject } : {}),
              });
              onSetOrganization(activated);
              await onReloadAll();
              return true;
            } catch (error) {
              onSetOrganizationError((error as Error).message);
              return false;
            } finally {
              writeLock.current = false;
              onSetOrganizationSaving(false);
            }
          }}
        />
      )}

      {transitionProject && (
        <ProjectTransition
          key={`${transitionProject.name}:${transitionProject.status}`}
          project={
            organization.projects?.find(
              (item) => item.name === transitionProject.name,
            ) || {
              name: transitionProject.name,
              description: "",
            }
          }
          status={transitionProject.status}
          data={organization}
          busy={organizationSaving}
          blocked={!organizationReady || organizationBlocked || needsCheck}
          error={organizationError}
          onBack={
            focusPickerOpen ? () => setTransitionProject(undefined) : undefined
          }
          onClose={() => {
            setTransitionProject(undefined);
            setFocusPickerOpen(false);
          }}
          onSave={onChangeOrganization}
          onReload={onReloadAll}
        />
      )}

      <AlertDialog
        open={Boolean(deletingProject)}
        onOpenChange={(next) => {
          if (!next && !organizationSaving) setDeletingProject(undefined);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除项目“{deletingProject?.name}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该项目及其所有子项目将被移除，旗下任务将移动至“收件箱”，任务完成状态、标签和看板列结构均会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {organizationError && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center gap-2">
                <span>{organizationError}</span>
                <Button
                  variant="link"
                  disabled={organizationSaving}
                  className="h-auto p-0 text-current"
                  onClick={async () => {
                    const latest = await onReloadAll();
                    if (latest) {
                      setDeletingProject((current) =>
                        current
                          ? { ...current, revision: latest.revision }
                          : undefined,
                      );
                    }
                  }}
                >
                  重新加载并检查
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={organizationSaving}>
              取消
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
                if (deletingProject) {
                  void onChangeOrganization({
                    kind: "project",
                    action: "delete",
                    revision: deletingProject.revision,
                    originalName: deletingProject.name,
                    item: {
                      name: deletingProject.name,
                      description: "",
                    },
                  }).then((saved) => {
                    if (saved) setDeletingProject(undefined);
                  });
                }
              }}
            >
              {organizationSaving ? <Spinner /> : "删除项目"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {recoveryOpen && (
        <RecoveryCenter
          onClose={() => setRecoveryOpen(false)}
          onUnconfirmed={() => setNeedsCheck(true)}
          busy={busy}
          blocked={needsCheck}
          notice={notice}
          onRestore={(uuid) => onMutate("action", { uuid, action: "restore" })}
          onRefresh={onReloadAll}
        />
      )}
    </>
  );
}
