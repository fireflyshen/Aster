import { usePromise } from "@raycast/utils";
import { queryWorkspaceTasksWithCatalog } from "../../core/workspace/task-views.ts";
import { useTaskService } from "./hooks/use-task-service";
import { useWorkspace } from "./hooks/use-workspace";
import { TimeWorkspaceScreen } from "./ui/time-ledger";

export default function TimeAndCostCommand() {
    const service = useTaskService();
    const workspace = useWorkspace(service.connection);
    const { data, revalidate } = usePromise(
        () =>
            queryWorkspaceTasksWithCatalog(
                service,
                { scope: "all" },
                workspace.client,
            ),
        [],
        { onError: () => undefined },
    );

    const tasks = data?.tasks || [];
    const knownProjects = [
        ...new Set([
            ...(data?.projects || []),
            ...(workspace.data?.projects || []).map((p) => p.name),
        ]),
    ].sort();
    const knownTags = [
        ...new Set([
            ...(workspace.data?.tags || []).map((t) => t.name),
            ...tasks.flatMap((t) => t.tags),
        ]),
    ].sort();

    return (
        <TimeWorkspaceScreen
            workspace={workspace.client}
            knownProjects={knownProjects}
            knownTags={knownTags}
            tasks={tasks}
            onMutated={async () => {
                await Promise.all([workspace.revalidate(), revalidate()]);
            }}
        />
    );
}
