import { projectNames } from "@core/workspace/projects";
import { CommandPalette } from "../command-palette";
import {
  ProjectWorkspaceDialogs,
  type ProjectWorkspaceDialogsProps,
} from "./project-workspace-dialogs";
import {
  TaskWorkspaceDialogs,
  type TaskWorkspaceDialogsProps,
} from "./task-workspace-dialogs";
import type { Task, View } from "@shared/tasks";
import type { SavedFilter, SavedTag } from "@core/workspace/organization";

export type WorkspaceModalsProps = TaskWorkspaceDialogsProps &
  ProjectWorkspaceDialogsProps & {
    commandOpen: boolean;
    setCommandOpen: (open: boolean) => void;
    layout: "list" | "board";
    tasks: Task[];
    openQuickAdd: () => void;
    onToggleLayout: () => void;
    onSelectView: (view: View) => void;
    onSelectEntry: (entry: {
      kind: "filter" | "tag";
      item: SavedFilter | SavedTag;
    }) => void;
    onOpenOrganization: () => void;
    onEditProject: (name: string) => void;
    onLoadOrganization: () => Promise<unknown>;
  };

/** Consolidates command palette, toast notifications, quick add, and management dialogs. */
export function WorkspaceModals(props: WorkspaceModalsProps) {
  const {
    commandOpen,
    setCommandOpen,
    layout,
    currentProject,
    organizationPage,
    organization,
    filterProjects,
    tasks,
    openQuickAdd,
    setFocusPickerOpen,
    onToggleLayout,
    onSelectView,
    onSelectProject,
    onEditProject,
    onTransitionProject,
    onSelectEntry,
    onOpenOrganization,
    setRecoveryOpen,
    onOpenEditor,
  } = props;

  return (
    <>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        layout={layout}
        currentProject={organizationPage ? "" : currentProject}
        organization={organization}
        projects={projectNames(filterProjects)}
        tasks={tasks}
        onAddTask={openQuickAdd}
        onAddProject={() => onEditProject("")}
        onFocusPicker={() => setFocusPickerOpen(true)}
        onToggleLayout={onToggleLayout}
        onView={onSelectView}
        onProject={onSelectProject}
        onEditProject={onEditProject}
        onProjectStatus={onTransitionProject}
        onEntry={onSelectEntry}
        onOrganization={onOpenOrganization}
        onRecovery={() => setRecoveryOpen(true)}
        onEditTask={(task) => onOpenEditor(task)}
      />
      <TaskWorkspaceDialogs {...props} />
      <ProjectWorkspaceDialogs {...props} />
    </>
  );
}
