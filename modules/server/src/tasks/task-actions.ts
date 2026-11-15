import type { createTaskService } from "../../../core/tasks/service.ts";
import type { createOrganizationService } from "../organization/organization-service.ts";
import type { createRecoveryService } from "../recovery/recovery.ts";
import type { TimeCoordinator } from "../time/time-coordinator.ts";
import { taskInput } from "../transport/validation.ts";

export function createTaskActions(
    service: ReturnType<typeof createTaskService>,
    organization: ReturnType<typeof createOrganizationService>,
    recovery: ReturnType<typeof createRecoveryService>,
    time?: {
        isEnabled: () => boolean;
        coordinator: TimeCoordinator;
    },
) {
    return async (input: Record<string, unknown>) => {
        if (typeof input.uuid !== "string") throw new Error("Task not found.");
        const idempotencyKey =
            typeof input.idempotencyKey === "string" &&
            input.idempotencyKey.trim().length > 0
                ? input.idempotencyKey.trim()
                : undefined;
        const useTime = Boolean(time?.isEnabled());

        const deleteTaskAndOrganizationLinks = async (uuid: string) => {
            await recovery.delete(uuid);
            const org = await organization.load();
            let rev = org.revision;
            if (org.subtasks) {
                const toDelete = Object.entries(org.subtasks).filter(
                    ([child, parent]) => child === uuid || parent === uuid,
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
            if (org.descriptions && org.descriptions[uuid]) {
                await organization.change({
                    revision: rev,
                    kind: "description",
                    action: "delete",
                    uuid,
                });
            }
        };

        switch (input.action) {
            case "edit":
                await service.editTask(input.uuid, taskInput(input.task));
                break;
            case "complete":
                if (useTime && time) {
                    return await time.coordinator.completeTask(input.uuid, {
                        idempotencyKey,
                    });
                }
                await service.completeTask(input.uuid);
                break;
            case "reopen":
                await service.reopenTask(input.uuid);
                break;
            case "stop":
                if (useTime && time) {
                    return await time.coordinator.stopTask(input.uuid, {
                        idempotencyKey,
                    });
                }
                await service.stopTask(input.uuid);
                break;
            case "start": {
                if (useTime && time) {
                    // Time mode removes hard energy-exhausted admission control while keeping
                    // integrity and coordinator checks inside timeCoordinator.startTask.
                    return await time.coordinator.startTask(input.uuid, {
                        idempotencyKey,
                    });
                }
                const current = await organization.load();
                if (current.timing?.available === false)
                    throw new Error(
                        "Timer history unavailable. Refresh before starting a task. Existing timers can still be stopped.",
                    );
                if (
                    current.timing?.hardEnergyLimit !== false &&
                    current.energy &&
                    current.energy.remaining !== null &&
                    current.energy.remaining <= 0
                )
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
                if (useTime && time) {
                    return await time.coordinator.deleteTask(
                        input.uuid,
                        () =>
                            deleteTaskAndOrganizationLinks(
                                input.uuid as string,
                            ),
                        { idempotencyKey },
                    );
                }
                await deleteTaskAndOrganizationLinks(input.uuid);
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
                await service.removeNote(
                    input.uuid,
                    input.entry,
                    input.description,
                );
                break;
            case "recurrence.edit":
                if (
                    typeof input.recur !== "string" ||
                    typeof input.until !== "string"
                )
                    throw new Error("Choose a valid repeat setting.");
                await service.updateRecurrence(
                    input.uuid,
                    input.recur,
                    input.until,
                );
                break;
            default:
                throw new Error("Unsupported task action.");
        }
        return { ok: true as const };
    };
}
