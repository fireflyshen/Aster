export const TASK_INDENT = 28;

export type DragRow = {
  uuid: string;
  parentUuid: string | null;
  depth: number;
  top: number;
  bottom: number;
  project: string;
  canParent: boolean;
};
export type DragSection = {
  columnId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  contentTop: number;
  rows: DragRow[];
};
export type DropPosition = {
  columnId: string;
  beforeUuid: string | null;
  parentUuid?: string | null;
};
export type DropPreview = DropPosition & {
  left: number;
  top: number;
  width: number;
  depth: number;
};

/** Geometry is measured once per layout/scroll, never in the pointer hot path. */
export function projectDrop(
  sections: DragSection[],
  point: { x: number; y: number },
  layout: "list" | "board",
  desiredDepth: number,
  project: string,
): DropPreview | undefined {
  if (!sections.length) return;
  const axis = layout === "board" ? point.x : point.y;
  let section = sections[0];
  let distance = Infinity;
  for (const candidate of sections) {
    const start = layout === "board" ? candidate.left : candidate.top;
    const end = layout === "board" ? candidate.right : candidate.bottom;
    const next = Math.max(start - axis, axis - end, 0);
    if (next < distance) {
      section = candidate;
      distance = next;
    }
  }
  // Do not snap a drop made outside the task area back into the last group.
  if (
    point.x < Math.min(...sections.map((s) => s.left)) - 64 ||
    point.x > Math.max(...sections.map((s) => s.right)) + 64 ||
    point.y < Math.min(...sections.map((s) => s.top)) - 48 ||
    point.y > Math.max(...sections.map((s) => s.bottom)) + 64
  )
    return;

  const rows = section.rows;
  let index = rows.findIndex((row) => point.y < (row.top + row.bottom) / 2);
  if (index < 0) index = rows.length;
  let previous = rows[index - 1];
  let depth =
    layout === "list" && previous
      ? Math.max(
          0,
          Math.min(
            Math.round(desiredDepth),
            previous.depth + (previous.canParent ? 1 : 0),
          ),
        )
      : 0;
  // Outdenting beside a subtree means inserting after that subtree, without
  // splitting the remaining children away from their parent.
  while (index < rows.length && rows[index].depth > depth) index++;
  previous = rows[index - 1];
  let parentUuid: string | null = null;
  if (depth > 0) {
    let parent: DragRow | undefined;
    for (let at = index - 1; at >= 0; at--) {
      if (rows[at].depth === depth - 1) {
        parent = rows[at];
        break;
      }
    }
    if (parent && parent.canParent && parent.project === project)
      parentUuid = parent.uuid;
    else depth = 0;
  }
  while (index < rows.length && rows[index].depth > depth) index++;
  const next = rows[index];
  const left = section.left + depth * TASK_INDENT;
  return {
    columnId: section.columnId,
    beforeUuid: next?.uuid ?? null,
    ...(layout === "list" ? { parentUuid } : {}),
    depth,
    left,
    top: next?.top ?? rows.at(-1)?.bottom ?? section.contentTop,
    width: Math.max(24, section.right - left),
  };
}
