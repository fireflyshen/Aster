import { UNSECTIONED } from "@core/workspace/board";

/** Returns the localized display title for a board column or section. */
export function columnDisplayName(col?: { id?: string; name?: string }) {
  if (
    !col ||
    col.id === UNSECTIONED ||
    col.name === "No section" ||
    col.name === "未分区" ||
    col.name === "(没有版块)"
  ) {
    return "(没有版块)";
  }
  return col.name;
}
