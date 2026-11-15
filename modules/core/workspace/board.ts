export type BoardColumn = { id: string; name: string; project?: string };
export type BoardState = {
    columns: BoardColumn[];
    placements: { uuid: string; columnId: string }[];
    order: string[];
};
export type BoardTask = {
    uuid: string;
    status: string;
    parent?: string;
    start?: string | Date;
    wait?: string | Date;
};
export type BoardChange = { revision: number; kind: "board" } & (
    | { action: "column.save"; column: BoardColumn }
    | { action: "column.delete"; columnId: string }
    | { action: "column.move"; columnId: string; direction: "left" | "right" }
    | {
          action: "task.move";
          uuid: string;
          columnId: string;
          beforeUuid: string | null;
          /** undefined preserves hierarchy; null promotes to a root task. */
          parentUuid?: string | null;
      }
);

export const UNSECTIONED = "unsectioned";
export const unsectionedColumn: BoardColumn = {
    id: UNSECTIONED,
    name: "No section",
};

export function defaultBoard(): BoardState {
    return { columns: [], placements: [], order: [] };
}
export function taskColumnId(
    task: Pick<BoardTask, "uuid" | "parent">,
    board: BoardState,
): string {
    const saved =
        board.placements.find((item) => item.uuid === task.uuid) ||
        (task.parent
            ? board.placements.find((item) => item.uuid === task.parent)
            : undefined);
    return saved && board.columns.some((column) => column.id === saved.columnId)
        ? saved.columnId
        : UNSECTIONED;
}
export function columnTasks<T extends BoardTask>(
    tasks: T[],
    board: BoardState,
    columnId: string,
    visibleColumnIds?: ReadonlySet<string>,
): T[] {
    const order = new Map(board.order.map((uuid, index) => [uuid, index]));
    const placements = new Map(
        board.placements.map((item) => [item.uuid, item.columnId]),
    );
    const columns =
        visibleColumnIds ?? new Set(board.columns.map((column) => column.id));
    return tasks
        .filter((task) => {
            const saved =
                placements.get(task.uuid) ??
                (task.parent ? placements.get(task.parent) : undefined);
            return (
                (saved && columns.has(saved) ? saved : UNSECTIONED) === columnId
            );
        })
        .sort(
            (a, b) =>
                (order.get(a.uuid) ??
                    (a.parent ? order.get(a.parent) : undefined) ??
                    Infinity) -
                (order.get(b.uuid) ??
                    (b.parent ? order.get(b.parent) : undefined) ??
                    Infinity),
        );
}

/** Aster hierarchy is separate from Taskwarrior's recurring-task `parent`. */
export function inheritSubtaskColumns(
    board: BoardState,
    tasks: BoardTask[],
    links: Record<string, string>,
): BoardState {
    const byUuid = new Map(tasks.map((task) => [task.uuid, task]));
    const placements = new Map(
        board.placements.map((item) => [item.uuid, item.columnId]),
    );
    for (const child of Object.keys(links)) {
        let root = child;
        const seen = new Set<string>();
        while (links[root] && byUuid.has(links[root]) && !seen.has(root)) {
            seen.add(root);
            root = links[root];
        }
        const task = byUuid.get(root);
        if (task && root !== child)
            placements.set(child, taskColumnId(task, board));
    }
    return {
        ...board,
        placements: [...placements].map(([uuid, columnId]) => ({
            uuid,
            columnId,
        })),
    };
}

export function placeCard(
    board: BoardState,
    tasks: BoardTask[],
    uuid: string,
    columnId: string,
    beforeUuid: string | null,
): BoardState {
    const order = board.order.filter((id) => id !== uuid);
    const known = new Set(order);
    for (const task of tasks)
        if (task.uuid !== uuid && !known.has(task.uuid)) {
            order.push(task.uuid);
            known.add(task.uuid);
        }
    const at = beforeUuid ? order.indexOf(beforeUuid) : order.length;
    order.splice(at < 0 ? order.length : at, 0, uuid);
    return {
        ...board,
        order,
        placements: [
            ...board.placements.filter((item) => item.uuid !== uuid),
            { uuid, columnId },
        ],
    };
}

/** Section placement follows the whole Aster subtree, including hidden children. */
export function placeTaskTree(
    board: BoardState,
    tasks: BoardTask[],
    links: Record<string, string>,
    uuid: string,
    columnId: string,
    beforeUuid: string | null,
): BoardState {
    const moved = placeCard(board, tasks, uuid, columnId, beforeUuid);
    const children = new Map<string, string[]>();
    for (const [child, parent] of Object.entries(links)) {
        const list = children.get(parent) || [];
        list.push(child);
        children.set(parent, list);
    }
    const descendants = new Set<string>();
    const pending = [...(children.get(uuid) || [])];
    while (pending.length) {
        const child = pending.pop()!;
        if (descendants.has(child) || child === uuid) continue;
        descendants.add(child);
        pending.push(...(children.get(child) || []));
    }
    if (beforeUuid && descendants.has(beforeUuid))
        throw new Error("Cannot move a task inside its own subtree.");
    moved.placements = moved.placements.filter(
        (item) => !descendants.has(item.uuid),
    );
    for (const child of descendants)
        moved.placements.push({ uuid: child, columnId });
    return moved;
}
