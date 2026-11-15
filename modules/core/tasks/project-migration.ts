import { TaskExecutionError } from "../connection/errors.ts";
import { serializeWrite } from "../connection/execute.ts";
import type { Connection } from "../connection/settings.ts";
import { inProject } from "../workspace/focus.ts";
import {
  projectNames,
  remapProject,
  validateProjectName,
} from "../workspace/projects.ts";
import { parseTaskwarriorTasks } from "./model.ts";
import { READ_OVERRIDES, type TaskRunner } from "./service-runner.ts";

/** Renames or removes a Taskwarrior project branch deepest-first after checking collisions. */
export function remapProjectBranch(
  connection: Connection,
  runner: TaskRunner,
  oldName: string,
  newName?: string,
) {
  validateProjectName(oldName);
  if (newName !== undefined) {
    validateProjectName(newName);
    if (newName !== oldName && inProject(newName, oldName))
      throw new Error("A project cannot be moved inside itself.");
  }

  return serializeWrite(connection, async () => {
    if (newName === oldName) return;
    const tasks = parseTaskwarriorTasks(
      await runner.run(["status.not:deleted", "export", ...READ_OVERRIDES]),
    );
    const paths = [
      ...new Set(
        tasks
          .filter((task) => inProject(task.project, oldName))
          .map((task) => task.project!),
      ),
    ];

    if (newName !== undefined) {
      const outside = new Set(
        projectNames(
          tasks.flatMap((task) =>
            task.project && !inProject(task.project, oldName)
              ? [task.project]
              : [],
          ),
        ).map((name) => name.toLocaleLowerCase()),
      );
      for (const path of [oldName, ...paths]) {
        const target = remapProject(path, oldName, newName);
        validateProjectName(target);
        if (outside.has(target.toLocaleLowerCase()))
          throw new Error(
            "This project name already exists. Reload before moving.",
          );
      }
    }

    // Process exact paths deepest first; preserve each descendant's suffix and task state.
    paths.sort((a, b) => b.length - a.length);
    for (const path of paths) {
      try {
        await runner.run(
          [
            "status.not:deleted",
            `project.is:${path}`,
            "modify",
            `project:${newName === undefined ? "" : remapProject(path, oldName, newName)}`,
            "rc.confirmation=off",
            "rc.recurrence.confirmation=no",
            "rc.bulk=0",
          ],
          true,
        );
      } catch (error) {
        throw new TaskExecutionError(
          "Project update unconfirmed. Some tasks may have moved. Reload and check the branch before submitting again.",
          "unknown",
          error,
        );
      }
    }
  });
}
