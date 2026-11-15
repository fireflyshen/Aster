import {
  emptyBuiltinFilterPrefs,
  normalizeBuiltinFilterPrefs,
  resolveBuiltinFilters,
} from "@core/workspace/builtin-filters";
import type {
  BuiltinFilterPrefs,
  Organization,
  OrganizationChange,
} from "@core/workspace/organization";
import { useCallback, useMemo } from "react";

/** Manages server-synced favorite and visibility preferences for built-in Taskwarrior filters. */
export function useBuiltinFilterPrefs(
  organization: Organization,
  onChange?: (change: OrganizationChange) => Promise<boolean>,
) {
  const prefs: BuiltinFilterPrefs = useMemo(
    () =>
      organization.builtinFilterPrefs
        ? normalizeBuiltinFilterPrefs(organization.builtinFilterPrefs)
        : emptyBuiltinFilterPrefs(),
    [organization.builtinFilterPrefs],
  );

  const favoriteIds = useMemo(
    () => new Set(prefs.favorites),
    [prefs.favorites],
  );
  const hiddenIds = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  const builtinFilters = useMemo(() => resolveBuiltinFilters(prefs), [prefs]);

  const toggleFavorite = useCallback(
    (id: string) => {
      if (!onChange) return Promise.resolve(false);
      return onChange({
        revision: organization.revision,
        kind: "builtinFilter",
        action: "favorite",
        id,
        value: !prefs.favorites.includes(id),
      });
    },
    [onChange, organization.revision, prefs.favorites],
  );

  const toggleHidden = useCallback(
    (id: string) => {
      if (!onChange) return Promise.resolve(false);
      return onChange({
        revision: organization.revision,
        kind: "builtinFilter",
        action: "hide",
        id,
        value: !prefs.hidden.includes(id),
      });
    },
    [onChange, organization.revision, prefs.hidden],
  );

  const toggleSectionHidden = useCallback(() => {
    if (!onChange) return Promise.resolve(false);
    return onChange({
      revision: organization.revision,
      kind: "builtinFilter",
      action: "section",
      value: !prefs.sectionHidden,
    });
  }, [onChange, organization.revision, prefs.sectionHidden]);

  return {
    builtinFilters,
    favoriteIds,
    hiddenIds,
    sectionHidden: Boolean(prefs.sectionHidden),
    toggleFavorite,
    toggleHidden,
    toggleSectionHidden,
  };
}
