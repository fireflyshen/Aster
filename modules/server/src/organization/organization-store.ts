import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BoardTask } from "../../core/workspace/board.ts";
import {
  applyEnergyElixir,
  calculateEnergy,
  type EnergyTaskLike,
  type TimewarriorInterval,
} from "../../core/workspace/energy.ts";
import type {
  Organization,
  OrganizationChange,
  SavedProject,
  SavedTag,
} from "../../core/workspace/organization.ts";
import { changeProjectFocus } from "./focus-changes.ts";
import {
  applyBoardChange,
  applyDescriptionChange,
  applyFilterOrTagChange,
  applySubtaskChange,
} from "./organization-item-changes.ts";
import { applyProjectSaveOrDeleteChange } from "./organization-project-changes.ts";
import { validateOrganizationData } from "./organization-validation.ts";

const empty = (): Organization => ({ revision: 0, filters: [], tags: [] });

/** Serialized file store for workspace organization metadata, board state, focus, and descriptions. */
export function createOrganizationStore(path: string) {
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Organization> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      return validateOrganizationData(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }

  async function persist(data: Organization) {
    data.revision++;
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, path);
    } catch (error) {
      throw Object.assign(error as Error, { outcome: "unknown" });
    }
  }

  function change(
    input: OrganizationChange,
    available: SavedTag[],
    effect: (oldTag: SavedTag, next?: SavedTag) => Promise<unknown>,
    boardContext?: {
      tasks: (BoardTask & EnergyTaskLike & { project?: string })[];
      intervals?: TimewarriorInterval[];
      projects?: string[];
      projectRecords?: SavedProject[];
      changeProject?: (oldName: string, newName?: string) => Promise<unknown>;
    },
  ) {
    const operation = queue
      .catch(() => undefined)
      .then(async () => {
        const data = await read();
        if (input.revision !== data.revision) {
          throw Object.assign(
            new Error(
              "Changed in another window. Reload before saving. Your draft is kept.",
            ),
            { status: 409 },
          );
        }

        if (input.kind === "energy" && input.action === "elixir") {
          const summary = calculateEnergy(
            boardContext?.tasks || [],
            boardContext?.intervals || [],
            data.energyState,
          );
          data.energyState = applyEnergyElixir(summary);
        } else if (input.kind === "board") {
          if (!boardContext) throw new Error("Board changes are unavailable.");
          applyBoardChange(data, input, boardContext.tasks);
        } else if (input.kind === "subtask") {
          applySubtaskChange(data, input);
        } else if (input.kind === "description") {
          applyDescriptionChange(data, input);
        } else if (input.kind === "project" && input.action === "status") {
          if (!boardContext?.projectRecords) {
            throw new Error("Project changes are unavailable.");
          }
          const records = boardContext.projectRecords.map((project) => ({
            ...project,
            ...data.projects?.find((saved) => saved.name === project.name),
          }));
          data.projects = changeProjectFocus(
            records,
            input,
            boardContext.tasks,
          );
        } else if (input.kind === "project") {
          await applyProjectSaveOrDeleteChange(data, input, boardContext);
        } else if (input.kind === "filter" || input.kind === "tag") {
          await applyFilterOrTagChange(data, input, available, effect);
        } else {
          throw new Error("Unsupported action");
        }

        await persist(data);
        return data;
      });
    queue = operation;
    return operation;
  }

  function restorePlacement(
    uuid: string,
    placement?: { columnId: string; beforeUuid: string | null },
  ) {
    const operation = queue
      .catch(() => undefined)
      .then(async () => {
        const data = await read();
        if (!placement || !data.board) return;
        const board = data.board;
        // A newer explicit placement wins. Deleted columns fall back to Unsectioned.
        if (!board.placements.some((item) => item.uuid === uuid)) {
          board.placements.push({
            uuid,
            columnId: board.columns.some((c) => c.id === placement.columnId)
              ? placement.columnId
              : "unsectioned",
          });
        }
        if (!board.order.includes(uuid)) {
          const at = placement.beforeUuid
            ? board.order.indexOf(placement.beforeUuid)
            : -1;
          board.order.splice(at < 0 ? board.order.length : at, 0, uuid);
        }
        await persist(data);
      });
    queue = operation;
    return operation;
  }

  return { read, change, restorePlacement };
}
