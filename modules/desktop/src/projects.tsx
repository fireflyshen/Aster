import { FocusProjects } from "./ui/focus-projects";
import { TaskListScreen } from "./ui/task-list";
import { useTaskService } from "./ui/use-task-service";
import { useWorkspace } from "./ui/use-workspace";

export default function ProjectsCommand() {
  const service = useTaskService();
  const workspace = useWorkspace(service.connection);

  return (
    <FocusProjects
      workspace={workspace.client}
      initial={workspace.data}
      workspaceError={workspace.error}
      isWorkspaceLoading={workspace.isLoading}
      service={service}
      onSaved={workspace.revalidate}
      renderProjectScreen={(projectName, onProjectMutated) => (
        <TaskListScreen
          initialFilter={`project:${projectName}`}
          onMutated={onProjectMutated ?? workspace.revalidate}
        />
      )}
      onOpenAllTasks={() => <TaskListScreen initialFilter="pending" />}
    />
  );
}
