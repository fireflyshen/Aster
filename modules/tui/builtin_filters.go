package main

import (
	"slices"
	"strings"
	"time"
)

type ResolvedBuiltinFilter struct {
	Item   SavedItem
	Hidden bool
}

var builtinFilterCatalog = []SavedItem{
	{
		ID:          "builtin:ready",
		Name:        "就绪任务",
		Description: "status:pending +READY · 可立即执行且未被阻塞",
		Expression:  "status:pending +READY",
		Color:       "green",
	},
	{
		ID:          "builtin:urgency",
		Name:        "紧迫排行",
		Description: "status:pending -WAITING · 按紧迫度排序的待办",
		Expression:  "status:pending -WAITING",
		Color:       "orange",
	},
	{
		ID:          "builtin:overdue",
		Name:        "已逾期",
		Description: "status:pending +OVERDUE · 已过截止时间",
		Expression:  "status:pending +OVERDUE",
		Color:       "red",
	},
	{
		ID:          "builtin:active",
		Name:        "正在进行",
		Description: "status:pending +ACTIVE · 已开始计时",
		Expression:  "status:pending +ACTIVE",
		Color:       "orange",
	},
	{
		ID:          "builtin:high",
		Name:        "高优先级",
		Description: "status:pending priority:H · P1 高优任务",
		Expression:  "status:pending priority:H",
		Color:       "berry",
	},
	{
		ID:          "builtin:week",
		Name:        "本周截止",
		Description: "status:pending due.before:eow · 本周内到期",
		Expression:  "status:pending due.before:eow",
		Color:       "yellow",
	},
	{
		ID:          "builtin:all",
		Name:        "全部待办",
		Description: "status:pending · 全部待办任务",
		Expression:  "status:pending",
		Color:       "blue",
	},
	{
		ID:          "builtin:waiting",
		Name:        "等待中",
		Description: "status:pending +WAITING · 已推迟的任务",
		Expression:  "status:pending +WAITING",
		Color:       "teal",
	},
	{
		ID:          "builtin:blocked",
		Name:        "被阻塞",
		Description: "status:pending +BLOCKED · 依赖前置任务",
		Expression:  "status:pending +BLOCKED",
		Color:       "purple",
	},
	{
		ID:          "builtin:no-project",
		Name:        "无项目",
		Description: "status:pending project: · 未分配项目",
		Expression:  "status:pending project:",
		Color:       "blue",
	},
	{
		ID:          "builtin:untagged",
		Name:        "无标签",
		Description: "status:pending tags.none: · 未添加标签",
		Expression:  "status:pending tags.none:",
		Color:       "gray",
	},
	{
		ID:          "builtin:completed-7d",
		Name:        "近 7 天已完成",
		Description: "status:completed end.after:today-7d · 最近完成",
		Expression:  "status:completed end.after:today-7d",
		Color:       "mint",
	},
	{
		ID:          "builtin:completed",
		Name:        "全部已完成",
		Description: "status:completed · 全部历史已完成任务",
		Expression:  "status:completed",
		Color:       "mint",
	},
}

func builtinTWFilters() []SavedItem {
	out := make([]SavedItem, len(builtinFilterCatalog))
	copy(out, builtinFilterCatalog)
	return out
}

func findBuiltinFilter(id string) (SavedItem, bool) {
	for _, f := range builtinFilterCatalog {
		if f.ID == id {
			return f, true
		}
	}
	return SavedItem{}, false
}

func resolveBuiltinFilters(prefs *BuiltinFilterPrefs) []ResolvedBuiltinFilter {
	var favs, hidden []string
	if prefs != nil {
		favs = prefs.Favorites
		hidden = prefs.Hidden
	}
	out := make([]ResolvedBuiltinFilter, 0, len(builtinFilterCatalog))
	for _, f := range builtinFilterCatalog {
		f.Favorite = slices.Contains(favs, f.ID)
		out = append(out, ResolvedBuiltinFilter{
			Item:   f,
			Hidden: slices.Contains(hidden, f.ID),
		})
	}
	return out
}

func findFilterByID(org Organization, id string) (SavedItem, bool) {
	for _, f := range org.Filters {
		if f.ID == id {
			return f, true
		}
	}
	return findBuiltinFilter(id)
}

func isUrgencyFilterView(view string) bool {
	return view == "filter:builtin:urgency"
}

func isCompletedFilterView(org Organization, view, expr string) bool {
	if strings.HasPrefix(view, "filter:") {
		if f, ok := findFilterByID(org, strings.TrimPrefix(view, "filter:")); ok {
			return strings.Contains(strings.ToLower(f.Expression), "status:completed")
		}
	}
	return strings.Contains(strings.ToLower(expr), "status:completed")
}

func evalLocalFilterMatch(
	id string,
	expr string,
	t Task,
	td parsedDates,
	idx viewIndex,
	now time.Time,
) bool {
	unfinished := t.Status == "pending" || t.Status == "waiting"
	waiting := t.Status == "waiting" || (unfinished && td.wait.After(now))
	switch id {
	case "builtin:urgency":
		return unfinished && !waiting
	case "builtin:active":
		if idx.isTimeMode {
			return unfinished &&
				(t.Start != "" || (idx.activeTimingTaskUUID != "" && strings.EqualFold(idx.activeTimingTaskUUID, t.UUID)))
		}
		return unfinished && t.Start != ""
	case "builtin:waiting":
		return waiting
	case "builtin:overdue":
		return unfinished && !td.due.IsZero() && td.due.Before(now)
	case "builtin:high":
		return unfinished && strings.EqualFold(t.Priority, "H")
	case "builtin:no-project":
		return unfinished && t.Project == ""
	case "builtin:untagged":
		return unfinished && len(t.Tags) == 0
	case "builtin:all", "builtin:ready", "builtin:week", "builtin:blocked":
		return unfinished
	case "builtin:completed", "builtin:completed-7d":
		return t.Status == "completed"
	}
	lower := strings.ToLower(strings.TrimSpace(expr))
	if lower == "status:pending or status:completed" {
		return unfinished || t.Status == "completed"
	}
	if strings.Contains(lower, "status:completed") {
		return t.Status == "completed"
	}
	if strings.Contains(lower, "status:pending") {
		return unfinished
	}
	return true
}
