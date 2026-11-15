package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/NimbleMarkets/ntcharts/barchart"
	"github.com/charmbracelet/lipgloss"
)

// ntcharts draws the bar; labels and values use Aster's existing typography.
func renderStatisticBar(value, maximum float64, width int) string {
	if width < 1 {
		return ""
	}
	chart := barchart.New(width, 1, barchart.WithHorizontalBars(), barchart.WithNoAxis(), barchart.WithNoAutoMaxValue(), barchart.WithMaxValue(math.Max(1, maximum)), barchart.WithBarGap(0))
	chart.Push(barchart.BarData{Values: []barchart.BarValue{{Value: math.Max(0, value), Style: lipgloss.NewStyle().Foreground(muted)}}})
	chart.Draw()
	return chart.View()
}

type timeStatistic struct {
	key, label string
	seconds    float64
	cost       int64
}

func (m model) statisticRows() []row {
	dim := m.timeState.WeeklyDimension
	if dim == "" {
		dim = "day"
	}
	if m.view == "time.report" {
		_, _, dim = m.timeReportDefaults()
	}
	items := map[string]*timeStatistic{}
	add := func(key, label string, seconds float64, cost int64) {
		item := items[key]
		if item == nil {
			item = &timeStatistic{key: key, label: label}
			items[key] = item
		}
		item.seconds += seconds
		item.cost += cost
	}
	kind := "time.statistic"
	if dim == "day" {
		kind = "time.day"
	}
	if m.view == "time.weekly" && m.timeState.Weekly != nil {
		w := m.timeState.Weekly
		switch dim {
		case "day":
			for _, day := range w.Daily {
				add(day.Date, day.Date, day.CoveredSeconds, day.ConfirmedCostCents)
			}
		case "project", "tag":
			seconds, costs := w.ByProjectSeconds, w.ByProjectCostCents
			if dim == "tag" {
				seconds, costs = w.ByTagSeconds, w.ByTagCostCents
			}
			for key, secs := range seconds {
				label := key
				if key == "__unassigned__" {
					label = "未指定项目"
				} else if key == "__untagged__" {
					label = "未设标签"
				} else if dim == "tag" {
					label = "#" + key
				}
				add(key, label, secs, costs[key])
			}
		}
	} else if m.view == "time.report" && m.timeState.Report != nil {
		rep := m.timeState.Report
		switch dim {
		case "task":
			for _, task := range rep.ByTask {
				add(task.TaskUUID, task.Title, task.PeriodSeconds, task.PeriodCostCents)
			}
		case "project":
			for _, project := range rep.ByProject {
				add(project.ProjectKey, project.ProjectName, project.PeriodSeconds, project.PeriodCostCents)
			}
		default:
			if dim == "day" {
				start, err := time.Parse("2006-01-02", rep.PeriodStartDate)
				if err == nil {
					for date, n := start, 0; date.Format("2006-01-02") <= rep.PeriodEndDate && n < 32; date, n = date.AddDate(0, 0, 1), n+1 {
						key := date.Format("2006-01-02")
						add(key, key, 0, 0)
					}
				}
			}
			seen := map[string]bool{}
			segments := append([]CostReportSegmentRef{}, rep.UnassignedSegments...)
			for _, project := range rep.ByProject {
				segments = append(segments, project.Segments...)
			}
			for _, task := range rep.ByTask {
				segments = append(segments, task.Segments...)
			}
			for _, segment := range segments {
				id := fmt.Sprintf("%s:%d:%d", segment.ActivityID, segment.StartMs, segment.EndMs)
				if seen[id] {
					continue
				}
				seen[id] = true
				if dim == "day" {
					add(segment.Date, segment.Date, segment.ConfirmedSeconds, segment.ConfirmedCostCents)
					continue
				}
				tags := segment.Tags
				if len(tags) == 0 {
					tags = []string{"__untagged__"}
				}
				unique := map[string]bool{}
				for _, tag := range tags {
					if unique[tag] {
						continue
					}
					unique[tag] = true
					label := "#" + tag
					if tag == "__untagged__" {
						label = "未设标签"
					}
					add(tag, label, segment.ConfirmedSeconds, segment.ConfirmedCostCents)
				}
			}
		}
	}
	ordered := make([]*timeStatistic, 0, len(items))
	for _, item := range items {
		ordered = append(ordered, item)
	}
	metric := func(item *timeStatistic) float64 {
		if m.timeState.ChartMetric == "cost" {
			return float64(item.cost)
		}
		return item.seconds
	}
	maximum := 1.0
	for _, item := range ordered {
		maximum = math.Max(maximum, metric(item))
	}
	sort.Slice(ordered, func(i, j int) bool {
		if dim == "day" || metric(ordered[i]) == metric(ordered[j]) {
			return ordered[i].key < ordered[j].key
		}
		return metric(ordered[i]) > metric(ordered[j])
	})
	var rows []row
	for _, item := range ordered {
		hint := ""
		if dim == "day" {
			hint = " · Enter 时间线"
		}
		if dim == "tag" {
			hint = " · 多标签分别累计"
		}
		if dim == "task" {
			hint = " · 仅关联任务"
		}
		metricLabel := "时长"
		if m.timeState.ChartMetric == "cost" {
			metricLabel = "时间成本"
		}
		rows = append(rows, row{kind: kind, id: item.key, title: item.label, subtitle: fmt.Sprintf("%s · %s · 图表：%s%s", formatDurationShort(item.seconds), formatCurrencyCny(item.cost), metricLabel, hint), chart: true, chartValue: metric(item), chartMax: maximum})
	}
	return rows
}

func projectTreeLabel(name string, entries []entry, index int) string {
	parts := strings.Split(name, ".")
	if len(parts) == 1 {
		return name
	}
	var label strings.Builder
	for depth := 1; depth < len(parts); depth++ {
		prefix := strings.Join(parts[:depth], ".") + "."
		hasNext := false
		for _, next := range entries[index+1:] {
			nextName := strings.TrimPrefix(next.id, "project:")
			if strings.HasPrefix(next.id, "project:") && strings.HasPrefix(nextName, prefix) && strings.Count(nextName, ".") == depth && nextName != strings.Join(parts[:depth+1], ".") {
				hasNext = true
				break
			}
		}
		if depth == len(parts)-1 {
			if hasNext {
				label.WriteString("├─ ")
			} else {
				label.WriteString("└─ ")
			}
		} else if hasNext {
			label.WriteString("│  ")
		} else {
			label.WriteString("   ")
		}
	}
	label.WriteString(parts[len(parts)-1])
	return label.String()
}
