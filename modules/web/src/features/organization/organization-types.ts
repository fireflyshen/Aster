import type { SavedFilter, SavedTag } from "@core/workspace/organization";

export type OrganizationEntry =
  | { kind: "filter"; item: SavedFilter }
  | { kind: "tag"; item: SavedTag };

/** Builds a blank filter or tag draft for creation in OrganizationManager. */
export function freshOrganizationEntry(
  kind: OrganizationEntry["kind"],
): OrganizationEntry {
  return kind === "filter"
    ? {
        kind,
        item: {
          id: "",
          name: "",
          color: "gray",
          favorite: false,
          description: "",
          expression: "status:pending",
        },
      }
    : { kind, item: { id: "", name: "", color: "gray", favorite: false } };
}
