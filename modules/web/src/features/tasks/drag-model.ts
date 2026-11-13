export const TASK_INDENT = 28;
export const DROP_HYSTERESIS = 8;
export type DragBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

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
  sectionIndex: number;
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
  previous?: DropPreview,
  bounds?: DragBounds,
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
  // Today/overdue can show two visual groups with the same stored column id.
  const priorSection = previous && sections[previous.sectionIndex];
  if (priorSection && priorSection !== section) {
    const start = layout === "board" ? priorSection.left : priorSection.top;
    const end = layout === "board" ? priorSection.right : priorSection.bottom;
    const priorDistance = Math.max(start - axis, axis - end, 0);
    if (priorDistance <= distance + DROP_HYSTERESIS) section = priorSection;
  }
  // Do not snap a drop made outside the task area back into the last group.
  if (
    point.x < (bounds?.left ?? Math.min(...sections.map((s) => s.left))) - 64 ||
    point.x >
      (bounds?.right ?? Math.max(...sections.map((s) => s.right))) + 64 ||
    point.y < (bounds?.top ?? Math.min(...sections.map((s) => s.top))) - 48 ||
    point.y >
      (bounds?.bottom ?? Math.max(...sections.map((s) => s.bottom))) + 64
  )
    return;

  const rows = section.rows;
  const sectionIndex = sections.indexOf(section);
  let index = rows.findIndex((row) => point.y < (row.top + row.bottom) / 2);
  if (index < 0) index = rows.length;
  const previousIndex =
    previous?.sectionIndex === sectionIndex
      ? previous.beforeUuid === null
        ? rows.length
        : rows.findIndex((row) => row.uuid === previous.beforeUuid)
      : -1;
  if (previousIndex >= 0) {
    const before = rows[previousIndex - 1];
    const after = rows[previousIndex];
    const lower = before ? (before.top + before.bottom) / 2 : -Infinity;
    const upper = after ? (after.top + after.bottom) / 2 : Infinity;
    if (
      point.y >= lower - DROP_HYSTERESIS &&
      point.y <= upper + DROP_HYSTERESIS
    )
      index = previousIndex;
  }
  const preceding = rows[index - 1];
  // A few pixels of hand movement must not change the hierarchy either.
  const stableDepth =
    previous &&
    Math.abs(desiredDepth - previous.depth) <
      0.5 + DROP_HYSTERESIS / TASK_INDENT
      ? previous.depth
      : Math.round(desiredDepth);
  let depth =
    layout === "list" && preceding
      ? Math.max(
          0,
          Math.min(
            stableDepth,
            preceding.depth + (preceding.canParent ? 1 : 0),
          ),
        )
      : 0;
  // Outdenting beside a subtree means inserting after that subtree, without
  // splitting the remaining children away from their parent.
  while (index < rows.length && rows[index].depth > depth) index++;
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
    sectionIndex,
    columnId: section.columnId,
    beforeUuid: next?.uuid ?? null,
    ...(layout === "list" ? { parentUuid } : {}),
    depth,
    left,
    top: next?.top ?? rows.at(-1)?.bottom ?? section.contentTop,
    width: Math.max(24, section.right - left),
  };
}
