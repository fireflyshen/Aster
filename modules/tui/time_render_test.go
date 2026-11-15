package main

import (
	"github.com/charmbracelet/lipgloss"
	"strings"
	"testing"
)

func TestTimelineGutterAndLongTitles(t *testing.T) {
	r := row{kind: "time.segment", title: "08:00–09:15  C++ 作用域、生命周期与 using，整理学习笔记", subtitle: "¥124.97 · 1h15m · 项目学习 · #阅读"}
	for _, width := range []int{24, 36, 65, 100} {
		lines := renderTimelineLines(r, width, true, false)
		text := stripANSI(strings.Join(lines, "\n"))
		if !strings.Contains(text, "08:00") || !strings.Contains(text, "09:15") || !strings.Contains(text, "¥124.97") || !strings.Contains(text, "1h15m") || !strings.Contains(text, "╵") {
			t.Fatalf("missing timeline facts: %s", text)
		}
		for _, line := range lines {
			if lipgloss.Width(line) > width {
				t.Fatalf("overflow at %d: %q", width, line)
			}
		}
		if strings.Count(text, "●") != 1 {
			t.Fatal("wrapping duplicated node")
		}
	}
}

func TestStatisticsKeepAlignedValuesAndBothMetrics(t *testing.T) {
	m := sampleModel()
	r := row{kind: "time.statistic", title: "上位机学习.C++", chart: true, chartSeconds: 4500, chartCost: 12497, chartValue: 4500, chartMax: 7200}
	for _, width := range []int{24, 40, 72} {
		for _, metric := range []string{"seconds", "cost"} {
			m.timeState.ChartMetric = metric
			lines := m.renderStatisticLines(r, width, true)
			if len(lines) != 2 {
				t.Fatal("statistics should use two rows")
			}
			first, second := stripANSI(lines[0]), stripANSI(lines[1])
			primary, secondary := "1h15m", "¥124.97"
			if metric == "cost" {
				primary, secondary = secondary, primary
			}
			if !strings.HasSuffix(strings.TrimRight(first, " "), primary) || !strings.HasSuffix(strings.TrimRight(second, " "), secondary) {
				t.Fatalf("unaligned values: %q, %q", first, second)
			}
			for _, line := range lines {
				if lipgloss.Width(line) > width {
					t.Fatal("chart overflow")
				}
			}
			if strings.Contains(second, "█") {
				t.Fatal("solid bar escaped fine rendering")
			}
		}
	}
}
