import { FocusProjects } from "./ui/focus-projects";
import { TaskListScreen } from "./ui/task-list";
import { useTaskService } from "./hooks/use-task-service";
import { useWorkspace } from "./hooks/use-workspace";

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
            onOpenAllTasks={() => (
                <TaskListScreen initialFilter="filter:builtin:all" />
            )}
        />
    );
}
