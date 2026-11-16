package main

import (
	"strings"
	"time"
)

const doingLimit = 5

var stateLabels = map[string]string{
	"planned":   "计划中",
	"doing":     "处理中",
	"scheduled": "已排期",
	"waiting":   "等待中",
	"parked":    "长期搁置",
}

var stateActionLabels = map[string]string{
	"planned":   "放回计划中",
	"doing":     "设为处理中",
	"scheduled": "设置排期日期",
	"waiting":   "转为等待外部",
	"parked":    "长期搁置",
}

var stateActionHints = map[string]string{
	"planned":   "移出处理中队列，不占用 5 个名额",
	"doing":     "进入「现在能做」处理中列表（最多 5 项）",
	"scheduled": "指定未来可见日期，到期自动回到计划中",
	"waiting":   "需要填写等待原因与可选跟进日",
	"parked":    "30 天未推进再提醒，不参与自动补位",
}

var stateTransitions = map[string][]string{
	"planned":   {"doing", "scheduled", "waiting", "parked"},
	"doing":     {"planned", "scheduled", "waiting", "parked"},
	"scheduled": {"doing", "planned", "waiting", "parked"},
	"waiting":   {"doing", "planned", "parked"},
	"parked":    {"planned", "doing"},
}

func isValidTaskState(s string) bool {
	_, ok := stateLabels[s]
	return ok
}

func stateLabel(s string) string {
	if l, ok := stateLabels[s]; ok {
		return l
	}
	return "未设定"
}

func allowedStateTargets(eff string) []string {
	if targets, ok := stateTransitions[eff]; ok {
		return targets
	}
	return stateTransitions["planned"]
}

func dependsUUIDs(t Task) []string {
	if t.Depends == nil {
		return nil
	}
	switch v := t.Depends.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		var out []string
		for _, part := range strings.Split(v, ",") {
			p := strings.TrimSpace(part)
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	case []string:
		var out []string
		for _, item := range v {
			p := strings.TrimSpace(item)
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	case []any:
		var out []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				p := strings.TrimSpace(s)
				if p != "" {
					out = append(out, p)
				}
			}
		}
		return out
	}
	return nil
}

func isHabitProject(t Task, projByName map[string]Project) bool {
	if t.Project == "" {
		return false
	}
	parts := strings.Split(t.Project, ".")
	for i := len(parts); i >= 1; i-- {
		name := strings.Join(parts[:i], ".")
		if p, ok := projByName[name]; ok && p.Category == "habit" {
			return true
		}
	}
	return false
}

func effectiveTaskState(
	t Task,
	td parsedDates,
	projByName map[string]Project,
	now time.Time,
) string {
	if t.Status != "pending" && t.Status != "waiting" {
		return ""
	}
	if isHabitProject(t, projByName) {
		return ""
	}
	explicit := strings.TrimSpace(t.State)
	if !isValidTaskState(explicit) {
		explicit = ""
	}
	waitingTW := t.Status == "waiting" || (!td.wait.IsZero() && td.wait.After(now))
	if waitingTW {
		if explicit == "waiting" || explicit == "parked" {
			return explicit
		}
		return "scheduled"
	}
	if explicit == "scheduled" ||
		(explicit == "" && !td.scheduled.IsZero() && td.scheduled.After(now)) {
		return "scheduled"
	}
	if explicit != "" {
		return explicit
	}
	return "planned"
}

func isBlockedTask(t Task, openUUIDs map[string]bool) bool {
	for _, dep := range dependsUUIDs(t) {
		if openUUIDs[dep] {
			return true
		}
	}
	return false
}
