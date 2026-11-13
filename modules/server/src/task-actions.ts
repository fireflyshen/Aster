import type { createTaskService } from "../../core/tasks/service.ts";
import type { createOrganizationService } from "./organization-service.ts";
import type { createRecoveryService } from "./recovery.ts";
import { taskInput } from "./validation.ts";

export function createTaskActions(
  service: ReturnType<typeof createTaskService>,
  organization: ReturnType<typeof createOrganizationService>,
  recovery: ReturnType<typeof createRecoveryService>,
) {
  return async (input: Record<string, unknown>) => {
    if (typeof input.uuid !== "string") throw new Error("Task not found.");
    switch (input.action) {
      case "edit":
        await service.editTask(input.uuid, taskInput(input.task));
        break;
      case "complete":
        await service.completeTask(input.uuid);
        break;
      case "reopen":
        await service.reopenTask(input.uuid);
        break;
      case "stop":
        await service.stopTask(input.uuid);
        break;
      case "start": {
        const current = await organization.load();
        if (current.timing?.available === false)
          throw new Error(
            "Timer history unavailable. Refresh before starting a task. Existing timers can still be stopped.",
          );
        if (current.energy && current.energy.remaining <= 0)
          throw new Error(
            `Daily energy exhausted (0/${current.energy.max}). Use an Elixir (+30) or rest until 06:00.`,
          );
        await service.startTask(input.uuid);
        break;
      }
      case "wait":
        if (
          typeof input.wait !== "string" ||
          (input.wait && !/^\d{8}T\d{6}Z$/.test(input.wait))
        )
          throw new Error("Choose a valid waiting date.");
        await service.setTaskWait(input.uuid, input.wait);
        break;
      case "delete": {
        await recovery.delete(input.uuid);
        const org = await organization.load();
        let rev = org.revision;
        if (org.subtasks) {
          const toDelete = Object.entries(org.subtasks).filter(
            ([child, parent]) => child === input.uuid || parent === input.uuid,
          );
          if (toDelete.length > 0) {
            for (const [child] of toDelete) {
              const updated = await organization.change({
                revision: rev,
                kind: "subtask",
                action: "unlink",
                childUuid: child,
              });
              rev = updated.revision;
            }
          }
        }
        if (org.descriptions && org.descriptions[input.uuid]) {
          await organization.change({
            revision: rev,
            kind: "description",
            action: "delete",
            uuid: input.uuid,
          });
        }
        break;
      }
      case "restore":
        await recovery.restore(input.uuid);
        break;
      case "note.remove":
        if (
          typeof input.entry !== "string" ||
          typeof input.description !== "string"
        )
          throw new Error("Choose a valid note.");
        await service.removeNote(input.uuid, input.entry, input.description);
        break;
      case "recurrence.edit":
        if (typeof input.recur !== "string" || typeof input.until !== "string")
          throw new Error("Choose a valid repeat setting.");
        await service.updateRecurrence(input.uuid, input.recur, input.until);
        break;
      default:
        throw new Error("Unsupported task action.");
    }
    return { ok: true as const };
  };
}
