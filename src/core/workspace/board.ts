export type BoardColumn = { id: string; name: string };
export type BoardState = {
    columns: BoardColumn[];
    placements: { uuid: string; columnId: string }[];
    order: string[];
};
export type BoardTask = {
    uuid: string;
    status: string;
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
      }
);

export const UNSECTIONED = "unsectioned";
export const unsectionedColumn: BoardColumn = {
    id: UNSECTIONED,
    name: "Unsectioned",
};

export function defaultBoard(): BoardState {
    return { columns: [], placements: [], order: [] };
}
export function taskColumnId(
    task: Pick<BoardTask, "uuid">,
    board: BoardState,
): string {
    const saved = board.placements.find((item) => item.uuid === task.uuid);
    return saved && board.columns.some((column) => column.id === saved.columnId)
        ? saved.columnId
        : UNSECTIONED;
}
export function columnTasks<T extends BoardTask>(
    tasks: T[],
    board: BoardState,
    columnId: string,
): T[] {
    const order = new Map(board.order.map((uuid, index) => [uuid, index]));
    return tasks
        .filter((task) => taskColumnId(task, board) === columnId)
        .sort(
            (a, b) =>
                (order.get(a.uuid) ?? Infinity) -
                (order.get(b.uuid) ?? Infinity),
        );
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
