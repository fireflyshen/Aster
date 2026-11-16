package main

import (
	"strings"
	"time"
)

func findFilterByID(org Organization, id string) (SavedItem, bool) {
	for _, f := range org.Filters {
		if f.ID == id {
			return f, true
		}
	}
	return SavedItem{}, false
}

func isCompletedFilterView(org Organization, view, expr string) bool {
	if strings.HasPrefix(view, "filter:") {
		if f, ok := findFilterByID(
			org,
			strings.TrimPrefix(view, "filter:"),
		); ok {
			return strings.Contains(
				strings.ToLower(f.Expression),
				"status:completed",
			)
		}
	}
	return strings.Contains(strings.ToLower(expr), "status:completed")
}

func evalLocalFilterMatch(
	_ string,
	expr string,
	t Task,
	_ parsedDates,
	_ viewIndex,
	_ time.Time,
) bool {
	unfinished := t.Status == "pending" || t.Status == "waiting"
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
