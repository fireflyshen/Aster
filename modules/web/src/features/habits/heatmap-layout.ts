/** Keep every week intact and balance wrapped panels instead of leaving a tiny tail. */
export function heatmapPanelLayout(
  weekCount: number,
  width: number,
  compact: boolean,
) {
  const gap = 3;
  const gutter = 20;
  const minimumCell = compact ? 12 : 13;
  const capacity = Math.max(
    1,
    Math.floor((Math.max(0, width) - gutter) / (minimumCell + gap)),
  );
  const panels = width > 0 ? Math.max(1, Math.ceil(weekCount / capacity)) : 1;
  const columns = Math.max(1, Math.ceil(weekCount / panels));
  return { columns, panels, gap, gutter };
}
