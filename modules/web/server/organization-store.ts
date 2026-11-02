import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { filterArguments, tagName } from "../../../src/core/tasks/filter.ts";
import { type BoardTask } from "../../../src/core/workspace/board.ts";
import {
    colors,
    type Organization,
    type OrganizationChange,
    type SavedFilter,
    type SavedProject,
    type SavedTag,
} from "../../../src/core/workspace/organization.ts";
import {
    FOCUS_LIMIT,
    inProject,
    projectStatus,
} from "../../../src/core/workspace/focus.ts";
import {
    applyEnergyElixir,
    calculateEnergy,
    type EnergyTaskLike,
    type TimewarriorInterval,
} from "../../../src/core/workspace/energy.ts";
import {
    projectNames,
    remapProject,
    validateProjectName,
} from "../../../src/core/workspace/projects.ts";
import { changeProjectFocus, validateGoal } from "./focus-changes.ts";
import { changeBoardState } from "./board-changes.ts";

const empty = (): Organization => ({ revision: 0, filters: [], tags: [] });
export function createOrganizationStore(path: string) {
    let queue: Promise<unknown> = Promise.resolve();
    async function read(): Promise<Organization> {
        try {
            const data = JSON.parse(await readFile(path, "utf8"));
            if (
                !Number.isInteger(data.revision) ||
                !Array.isArray(data.filters) ||
                !Array.isArray(data.tags) ||
                (data.projects !== undefined &&
                    !Array.isArray(data.projects)) ||
                (data.energyState !== undefined &&
                    (!data.energyState ||
                        typeof data.energyState.day !== "string" ||
                        !Number.isInteger(data.energyState.bonus) ||
                        !Number.isInteger(data.energyState.elixirCount))) ||
                (data.board !== undefined &&
                    (!data.board ||
                        !Array.isArray(data.board.columns) ||
                        !Array.isArray(data.board.placements) ||
                        !Array.isArray(data.board.order) ||
                        data.board.columns.some(
                            (column: { id: string; name: string }) =>
                                !column ||
                                typeof column.id !== "string" ||
                                !column.id ||
                                column.id === "unsectioned" ||
                                typeof column.name !== "string",
                        ) ||
                        new Set(
                            data.board.columns.map(
                                (column: { id: string }) => column.id,
                            ),
                        ).size !== data.board.columns.length ||
                        data.board.placements.some(
                            (item: { uuid: string; columnId: string }) =>
                                !item ||
                                typeof item.uuid !== "string" ||
                                typeof item.columnId !== "string",
                        ) ||
                        data.board.order.some(
                            (uuid: unknown) => typeof uuid !== "string",
                        )))
            )
                throw new Error(
                    "The filters and labels file is invalid. Check the data file.",
                );
            if (data.board)
                data.board.columns = data.board.columns.map(
                    ({ id, name }: { id: string; name: string }) => ({
                        id,
                        name,
                    }),
                );
            return data;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return empty();
            throw error;
        }
    }
    async function persist(data: Organization) {
        data.revision++;
        await mkdir(dirname(path), { recursive: true });
        const temporary = path + "." + randomUUID() + ".tmp";
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
            changeProject?: (
                oldName: string,
                newName?: string,
            ) => Promise<unknown>;
        },
    ) {
        const operation = queue
            .catch(() => undefined)
            .then(async () => {
                const data = await read();
                if (input.revision !== data.revision)
                    throw Object.assign(
                        new Error(
                            "Changed in another window. Reload before saving. Your draft is kept.",
                        ),
                        {
                            status: 409,
                        },
                    );
                if (input.kind === "energy" && input.action === "elixir") {
                    const summary = calculateEnergy(
                        boardContext?.tasks || [],
                        boardContext?.intervals || [],
                        data.energyState,
                    );
                    data.energyState = applyEnergyElixir(summary);
                    await persist(data);
                    return data;
                }
                if (input.kind === "board") {
                    if (!boardContext)
                        throw new Error("Board changes are unavailable.");
                    const board = changeBoardState(
                        data.board,
                        input,
                        boardContext.tasks,
                    );
                    data.board = board;
                    await persist(data);
                    return data;
                }
                if (input.kind === "project" && input.action === "status") {
                    if (!boardContext?.projectRecords)
                        throw new Error("Project changes are unavailable.");
                    // Use the queued revision's metadata, with native discoveries defaulting to Later.
                    const records = boardContext.projectRecords.map(
                        (project) => ({
                            ...project,
                            ...data.projects?.find(
                                (saved) => saved.name === project.name,
                            ),
                        }),
                    );
                    data.projects = changeProjectFocus(
                        records,
                        input,
                        boardContext.tasks,
                    );
                    await persist(data);
                    return data;
                }
                if (input.kind === "project") {
                    const item = input.item as SavedProject | undefined;
                    if (
                        !["save", "delete"].includes(input.action) ||
                        !item ||
                        typeof item.name !== "string" ||
                        !item.name.trim() ||
                        item.name.length > 200 ||
                        /[\0\r\n]/.test(item.name)
                    )
                        throw new Error("Choose a valid project.");
                    if (
                        typeof item.description !== "string" ||
                        item.description.length > 2000 ||
                        item.description.includes("\0")
                    )
                        throw new Error(
                            "Description must be 2,000 characters or fewer.",
                        );
                    const name = item.name.trim();
                    validateProjectName(name);
                    const original = input.originalName ?? name;
                    if (typeof original !== "string")
                        throw new Error("Choose a valid project.");
                    if (original) validateProjectName(original);
                    const records = new Map(
                        (boardContext?.projectRecords || []).map((project) => [
                            project.name,
                            project,
                        ]),
                    );
                    for (const project of data.projects || [])
                        records.set(project.name, project);
                    const names = projectNames([
                        ...(boardContext?.projects || []),
                        ...records.keys(),
                    ]);
                    const originalRecord = records.get(original);
                    if (
                        item.status !== undefined &&
                        item.status !== originalRecord?.status
                    )
                        throw new Error(
                            "Use the project status action to activate, pause, or complete a project.",
                        );
                    const next: SavedProject = {
                        ...originalRecord,
                        name,
                        description: item.description.trim(),
                    };
                    if (item.color !== undefined) {
                        if (!colors.some((color) => color.id === item.color))
                            throw new Error("Choose a valid project color.");
                        next.color = item.color;
                    }
                    if (item.outcome !== undefined) next.outcome = item.outcome;
                    if (item.nextTask !== undefined)
                        next.nextTask = item.nextTask;
                    if (
                        (input.action === "delete" || input.originalName) &&
                        !names.includes(original)
                    )
                        throw new Error(
                            "This project no longer exists. Reload to continue.",
                        );
                    const renaming =
                        !!original &&
                        original !== name &&
                        input.action === "save";
                    if (renaming && inProject(name, original))
                        throw new Error(
                            "A project cannot be moved inside itself.",
                        );
                    const outside = new Set(
                        names
                            .filter(
                                (path) =>
                                    !original || !inProject(path, original),
                            )
                            .map((path) => path.toLocaleLowerCase()),
                    );
                    if (input.action === "save") {
                        const targets = renaming
                            ? names
                                  .filter((path) => inProject(path, original))
                                  .map((path) =>
                                      remapProject(path, original, name),
                                  )
                            : [name];
                        for (const target of targets) {
                            validateProjectName(target);
                            if (outside.has(target.toLocaleLowerCase()))
                                throw new Error(
                                    "This project name already exists.",
                                );
                        }
                    }
                    const removing = input.action === "delete";
                    const affected = (path: string | undefined) =>
                        !!original && inProject(path, original);
                    const tasks = (boardContext?.tasks || []).map((task) =>
                        affected(task.project)
                            ? {
                                  ...task,
                                  project: removing
                                      ? undefined
                                      : remapProject(
                                            task.project!,
                                            original,
                                            name,
                                        ),
                              }
                            : task,
                    );
                    if (!removing)
                        validateGoal(
                            {
                                ...next,
                                nextTask:
                                    next.nextTask === originalRecord?.nextTask
                                        ? ""
                                        : next.nextTask,
                            },
                            tasks,
                        );
                    let projects = [...records.values()].flatMap((project) => {
                        if (affected(project.name))
                            return removing
                                ? []
                                : [
                                      {
                                          ...project,
                                          name: remapProject(
                                              project.name,
                                              original,
                                              name,
                                          ),
                                      },
                                  ];
                        return [project];
                    });
                    if (!removing)
                        projects = [
                            ...projects.filter(
                                (project) => project.name !== name,
                            ),
                            next,
                        ];
                    // Keep goal references valid when a selected task leaves its ancestor project.
                    projects = projects.map((project) => {
                        const previousTask = boardContext?.tasks.find(
                            (task) => task.uuid === project.nextTask,
                        );
                        const moved =
                            previousTask &&
                            affected(previousTask.project) &&
                            tasks.find(
                                (task) => task.uuid === previousTask.uuid,
                            );
                        return moved && !inProject(moved.project, project.name)
                            ? { ...project, nextTask: "" }
                            : project;
                    });
                    const active = projects.filter(
                        (project) => projectStatus(project) === "active",
                    );
                    if (
                        active.length > FOCUS_LIMIT ||
                        active.some((project, index) =>
                            active
                                .slice(index + 1)
                                .some(
                                    (other) =>
                                        inProject(project.name, other.name) ||
                                        inProject(other.name, project.name),
                                ),
                        )
                    )
                        throw new Error(
                            "A parent or child project is already active. Pause one before moving this branch.",
                        );
                    // Prepare every reference before touching native data; UUID-based board placement remains unchanged.
                    const filters = renaming
                        ? data.filters.map((filter) => {
                              const tokens = filterArguments(
                                  filter.expression,
                              ).map((token) => {
                                  const match =
                                      /^(project(?:\.(?:is|equals|not|isnt))?):(.*)$/.exec(
                                          token,
                                      );
                                  return match && affected(match[2])
                                      ? match[1] +
                                            ":" +
                                            remapProject(
                                                match[2],
                                                original,
                                                name,
                                            )
                                      : token;
                              });
                              const expression = tokens
                                  .map((token) =>
                                      /\s/.test(token)
                                          ? JSON.stringify(token)
                                          : token,
                                  )
                                  .join(" ");
                              filterArguments(expression);
                              return { ...filter, expression };
                          })
                        : data.filters;
                    if (renaming || removing) {
                        if (!boardContext?.changeProject)
                            throw new Error("Project changes are unavailable.");
                        await boardContext.changeProject(
                            original,
                            removing ? undefined : name,
                        );
                    }
                    data.projects = projects;
                    data.filters = filters;
                    await persist(data);
                    return data;
                }
                if (
                    !["filter", "tag"].includes(input.kind) ||
                    !["save", "delete"].includes(input.action)
                )
                    throw new Error("Unsupported action");
                const item = input.item;
                if (
                    !item ||
                    typeof item.id !== "string" ||
                    item.id.length > 160
                )
                    throw new Error("Invalid item");
                const list = input.kind === "filter" ? data.filters : data.tags;
                const old = (input.kind === "tag" ? available : list).find(
                    (x) => x.id === item.id,
                );
                let next: SavedFilter | SavedTag | undefined;
                if (input.action === "save") {
                    if (
                        typeof item.name !== "string" ||
                        !item.name.trim() ||
                        item.name.trim().length > 60 ||
                        /[\0\r\n]/.test(item.name)
                    )
                        throw new Error("Name must contain 1–60 characters.");
                    if (
                        !colors.some((c) => c.id === item.color) ||
                        typeof item.favorite !== "boolean"
                    )
                        throw new Error(
                            "Choose a valid color and favorite setting.",
                        );
                    if (
                        (input.kind === "tag" ? available : list).some(
                            (x) =>
                                x.id !== item.id &&
                                x.name.toLocaleLowerCase() ===
                                    item.name.trim().toLocaleLowerCase(),
                        )
                    )
                        throw new Error("This name already exists.");
                    next = {
                        id: old?.id || randomUUID(),
                        name: item.name.trim(),
                        color: item.color,
                        favorite: item.favorite,
                    };
                    if (input.kind === "tag") tagName(next.name);
                    else {
                        const filter = item as SavedFilter;
                        if (
                            typeof filter.description !== "string" ||
                            filter.description.length > 500
                        )
                            throw new Error(
                                "Description must be 500 characters or fewer.",
                            );
                        filterArguments(filter.expression);
                        next = {
                            ...next,
                            description: filter.description,
                            expression: filter.expression.trim(),
                        };
                    }
                } else if (!old)
                    throw new Error(
                        "This item no longer exists. Reload to continue.",
                    );
                if (
                    input.kind === "tag" &&
                    old &&
                    (input.action === "delete" || next?.name !== old.name)
                )
                    await effect(old, next);
                const updated = list.filter(
                    (x) => x.id !== item.id && x.name !== old?.name,
                );
                if (next) updated.push(next);
                if (input.kind === "filter")
                    data.filters = updated as SavedFilter[];
                else {
                    data.tags = updated as SavedTag[];
                    if (old && next && old.name !== next.name)
                        data.filters = data.filters.map((filter) => ({
                            ...filter,
                            expression: filterArguments(filter.expression)
                                .map((token) =>
                                    token === `+${old.name}`
                                        ? `+${next.name}`
                                        : token === `-${old.name}`
                                          ? `-${next.name}`
                                          : token,
                                )
                                .map((token) =>
                                    /\s/.test(token)
                                        ? JSON.stringify(token)
                                        : token,
                                )
                                .join(" "),
                        }));
                }
                await persist(data);
                return data;
            });
        queue = operation;
        return operation;
    }
    return { read, change };
}
