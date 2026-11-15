import type { BuiltinFilterPrefs, SavedFilter } from "./organization.ts";

/** Built-in read-only Taskwarrior preset filters shared across Aster clients. */
export const BUILTIN_TW_FILTERS: readonly SavedFilter[] = [
    {
        id: "builtin:ready",
        name: "就绪任务",
        description: "status:pending +READY · 可立即执行且未被阻塞",
        expression: "status:pending +READY",
        color: "green",
        favorite: false,
    },
    {
        id: "builtin:urgency",
        name: "紧迫排行",
        description: "status:pending -WAITING · 按紧迫度排序的待办",
        expression: "status:pending -WAITING",
        color: "orange",
        favorite: false,
    },
    {
        id: "builtin:overdue",
        name: "已逾期",
        description: "status:pending +OVERDUE · 已过截止时间",
        expression: "status:pending +OVERDUE",
        color: "red",
        favorite: false,
    },
    {
        id: "builtin:active",
        name: "正在进行",
        description: "status:pending +ACTIVE · 已开始计时",
        expression: "status:pending +ACTIVE",
        color: "orange",
        favorite: false,
    },
    {
        id: "builtin:high",
        name: "高优先级",
        description: "status:pending priority:H · P1 高优任务",
        expression: "status:pending priority:H",
        color: "berry",
        favorite: false,
    },
    {
        id: "builtin:week",
        name: "本周截止",
        description: "status:pending due.before:eow · 本周内到期",
        expression: "status:pending due.before:eow",
        color: "yellow",
        favorite: false,
    },
    {
        id: "builtin:all",
        name: "全部待办",
        description: "status:pending · 全部待办任务",
        expression: "status:pending",
        color: "blue",
        favorite: false,
    },
    {
        id: "builtin:waiting",
        name: "等待中",
        description: "status:pending +WAITING · 已推迟的任务",
        expression: "status:pending +WAITING",
        color: "teal",
        favorite: false,
    },
    {
        id: "builtin:blocked",
        name: "被阻塞",
        description: "status:pending +BLOCKED · 依赖前置任务",
        expression: "status:pending +BLOCKED",
        color: "purple",
        favorite: false,
    },
    {
        id: "builtin:no-project",
        name: "无项目",
        description: "status:pending project: · 未分配项目",
        expression: "status:pending project:",
        color: "blue",
        favorite: false,
    },
    {
        id: "builtin:untagged",
        name: "无标签",
        description: "status:pending tags.none: · 未添加标签",
        expression: "status:pending tags.none:",
        color: "gray",
        favorite: false,
    },
    {
        id: "builtin:completed-7d",
        name: "近 7 天已完成",
        description: "status:completed end.after:today-7d · 最近完成",
        expression: "status:completed end.after:today-7d",
        color: "mint",
        favorite: false,
    },
    {
        id: "builtin:completed",
        name: "全部已完成",
        description: "status:completed · 全部历史已完成任务",
        expression: "status:completed",
        color: "mint",
        favorite: false,
    },
];

export type ResolvedBuiltinFilter = SavedFilter & { hidden: boolean };

/** Empty baseline preferences for built-in filters. */
export function emptyBuiltinFilterPrefs(): BuiltinFilterPrefs {
    return { favorites: [], hidden: [] };
}

/** Look up a built-in Taskwarrior filter by id. */
export function findBuiltinFilter(id: string): SavedFilter | undefined {
    return BUILTIN_TW_FILTERS.find((item) => item.id === id);
}

/** Normalize and deduplicate built-in filter ids in order of the built-in catalog. */
export function normalizeBuiltinFilterPrefs(
    prefs?: Partial<BuiltinFilterPrefs> | null,
): BuiltinFilterPrefs {
    const validIds = new Set(BUILTIN_TW_FILTERS.map((item) => item.id));
    const favSet = new Set(
        Array.isArray(prefs?.favorites)
            ? prefs.favorites.filter(
                  (id): id is string =>
                      typeof id === "string" && validIds.has(id),
              )
            : [],
    );
    const hiddenSet = new Set(
        Array.isArray(prefs?.hidden)
            ? prefs.hidden.filter(
                  (id): id is string =>
                      typeof id === "string" && validIds.has(id),
              )
            : [],
    );
    const favorites = BUILTIN_TW_FILTERS.map((item) => item.id).filter((id) =>
        favSet.has(id),
    );
    const hidden = BUILTIN_TW_FILTERS.map((item) => item.id).filter((id) =>
        hiddenSet.has(id),
    );
    return {
        favorites,
        hidden,
        ...(prefs?.sectionHidden ? { sectionHidden: true } : {}),
    };
}

/** Return every built-in filter with effective favorite and hidden state applied. */
export function resolveBuiltinFilters(
    prefs?: Partial<BuiltinFilterPrefs> | null,
): ResolvedBuiltinFilter[] {
    const normalized = normalizeBuiltinFilterPrefs(prefs);
    const favorites = new Set(normalized.favorites);
    const hidden = new Set(normalized.hidden);
    return BUILTIN_TW_FILTERS.map((item) => ({
        ...item,
        favorite: favorites.has(item.id),
        hidden: hidden.has(item.id),
    }));
}

/** Return visible built-in filters with favorite flags applied. */
export function visibleBuiltinFilters(
    prefs?: Partial<BuiltinFilterPrefs> | null,
): SavedFilter[] {
    if (prefs?.sectionHidden) return [];
    return resolveBuiltinFilters(prefs)
        .filter((item) => !item.hidden)
        .map(({ hidden: _hidden, ...filter }) => filter);
}

/** Return true when the built-in filter represents urgency-ordered pending tasks. */
export function isUrgencyBuiltinFilterId(id: string): boolean {
    return id === "builtin:urgency";
}

/** Return true when a filter expression targets completed tasks. */
export function isCompletedFilterExpression(expression: string): boolean {
    return /\bstatus:completed\b/i.test(expression);
}
