import type { createTaskService } from "../../../core/tasks/service.ts";
import { isHabitTask } from "../../../core/tasks/state.ts";
import type { HabitStore } from "../habits/habit-store.ts";
import type { createOrganizationService } from "../organization/organization-service.ts";
import type { createRecoveryService } from "../recovery/recovery.ts";
import type { TimeCoordinator } from "../time/time-coordinator.ts";
import { taskInput } from "../transport/validation.ts";
import type { StateActionMeta, TaskStateManager } from "./state-changes.ts";

export function createTaskActions(
  service: ReturnType<typeof createTaskService>,
  organization: ReturnType<typeof createOrganizationService>,
  recovery: ReturnType<typeof createRecoveryService>,
  time?: {
    isEnabled: () => boolean;
    coordinator: TimeCoordinator;
  },
  habitStore?: HabitStore,
  stateManager?: TaskStateManager,
) {
  return async (input: Record<string, unknown>, meta: StateActionMeta = {}) => {
    if (typeof input.uuid !== "string") throw new Error("Task not found.");
    const idempotencyKey =
      typeof input.idempotencyKey === "string" &&
      input.idempotencyKey.trim().length > 0
        ? input.idempotencyKey.trim()
        : undefined;
    const useTime = Boolean(time?.isEnabled());

    const deleteTaskAndOrganizationLinks = async (uuid: string) => {
      const recordDelete = stateManager
        ? await stateManager.prepareDelete(uuid, meta)
        : async () => undefined;
      await recovery.delete(uuid);
      await recordDelete();
      habitStore?.deleteHabitIfExists(uuid);
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
      case "state.set":
        if (!stateManager) {
          throw new Error("State manager unavailable.");
        }
        return await stateManager.setState(
          {
            uuid: input.uuid,
            state: input.state,
            waitReason: input.waitReason,
            checkDate: input.checkDate,
            scheduled: input.scheduled,
            replaceUuid: input.replaceUuid,
            idempotencyKey,
            reason: typeof input.reason === "string" ? input.reason : undefined,
          },
          meta,
        );
      case "schedule":
        if (!stateManager) {
          throw new Error("State manager unavailable.");
        }
        return await stateManager.scheduleTask(
          {
            uuid: input.uuid,
            scheduled: input.scheduled ?? "",
          },
          meta,
        );
      case "depends":
        if (!stateManager) {
          throw new Error("State manager unavailable.");
        }
        return await stateManager.updateDepends({
          uuid: input.uuid,
          add: input.add,
          remove: input.remove,
        });
      case "edit":
        await service.editTask(input.uuid, taskInput(input.task));
        break;
      case "complete": {
        if (useTime && time) {
          return await time.coordinator.completeTask(input.uuid, {
            idempotencyKey,
            source:
              meta.source === "auto" || meta.source === "migration"
                ? undefined
                : meta.source,
            actor: meta.actor,
          });
        }
        const recordComplete = stateManager
          ? await stateManager.prepareComplete(input.uuid, meta)
          : async () => undefined;
        await service.completeTask(input.uuid);
        await recordComplete();
        break;
      }
      case "reopen":
        await service.reopenTask(input.uuid);
        if (stateManager) {
          await stateManager.finalizeReopen(input.uuid, meta);
        }
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
            source:
              meta.source === "auto" || meta.source === "migration"
                ? undefined
                : meta.source,
            actor: meta.actor,
          });
        }
        if (stateManager) {
          await stateManager.ensureStartReady(input.uuid, meta);
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
      case "wait": {
        if (
          typeof input.wait !== "string" ||
          (input.wait && !/^\d{8}T\d{6}Z$/.test(input.wait))
        )
          throw new Error("Choose a valid waiting date.");
        if (stateManager) {
          const [tasks, org] = await Promise.all([
            service.loadTasks("pending"),
            organization.snapshot(),
          ]);
          const task = tasks.find((t) => t.uuid === input.uuid);
          const habitUuids = habitStore?.getHabitTaskUuids();
          if (
            task &&
            !org.subtasks?.[task.uuid] &&
            !isHabitTask(task, org, habitUuids) &&
            (task.state === "planned" || !task.state)
          ) {
            await stateManager.scheduleTask(
              { uuid: input.uuid, scheduled: input.wait },
              meta,
            );
            return {
              ok: true as const,
              deprecated: true,
              warning:
                "wait 对普通任务已弃用，已自动转换为 scheduled；请改用 task_schedule 或 task_state_set。",
            };
          }
        }
        await service.setTaskWait(input.uuid, input.wait);
        break;
      }
      case "delete": {
        if (useTime && time) {
          return await time.coordinator.deleteTask(
            input.uuid,
            () => deleteTaskAndOrganizationLinks(input.uuid as string),
            { idempotencyKey },
          );
        }
        await deleteTaskAndOrganizationLinks(input.uuid);
        break;
      }
      case "restore":
        await recovery.restore(input.uuid);
        if (stateManager) {
          await stateManager.finalizeRestore(input.uuid, meta);
        }
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
