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
			text := stripANSI(strings.Join(lines, "\n"))
			if !strings.Contains(text, "1h15m") || !strings.Contains(text, "¥124.97") {
				t.Fatalf("lost values: %q", text)
			}
			for _, line := range lines {
				if lipgloss.Width(line) > width {
					t.Fatal("chart overflow")
				}
			}
			if strings.Contains(text, "█") {
				t.Fatal("solid bar escaped fine rendering")
			}
		}
	}
}

func TestWideTerminalKeepsStatisticsTogether(t *testing.T) {
	m := sampleModel()
	r := row{kind: "time.statistic", title: "Work", chart: true, chartSeconds: 4500, chartCost: 12497, chartValue: 4500, chartMax: 7200}
	lines := m.renderStatisticLines(r, 400, false)
	if len(lines) != 1 {
		t.Fatal("category should compare label, bar and values on one row")
	}
	text := stripANSI(lines[0])
	for _, value := range []string{"Work", "1h15m", "¥124.97"} {
		if !strings.Contains(text, value) {
			t.Fatalf("missing %s", value)
		}
	}
	if lipgloss.Width(text) > 88 {
		t.Fatalf("data spread beyond content column: %d", lipgloss.Width(text))
	}
}

func TestDailyTableAndColumnChart(t *testing.T) {
	m := sampleModel()
	m.view = "time.weekly"
	rows := []row{{kind: "time.day", id: "2026-11-14", title: "2026-11-14", chart: true, chartSeconds: 1800, chartCost: 5000, chartValue: 1800}, {kind: "time.day", id: "2026-11-15", title: "2026-11-15", chart: true, chartSeconds: 3600, chartCost: 10000, chartValue: 3600}}
	for _, width := range []int{32, 65, 260} {
		chart := m.renderDailyColumns(rows, width)
		text := stripANSI(strings.Join(chart, "\n"))
		if !strings.Contains(text, "最高 1h") || !strings.Contains(text, "14") || !strings.Contains(text, "15") {
			t.Fatalf("missing daily scale: %s", text)
		}
		for _, line := range chart {
			if lipgloss.Width(line) > min(width, 74) {
				t.Fatalf("chart overflow: %q", line)
			}
		}
		lines := m.renderStatisticLines(rows[0], width, true)
		if len(lines) != 1 {
			t.Fatal("daily row should be a table, not a repeated bar")
		}
		if !strings.Contains(stripANSI(lines[0]), "30m") {
			t.Fatal("lost exact daily value")
		}
	}
}

func TestBudgetRankingUsesOverrunAmounts(t *testing.T) {
	m := sampleModel()
	m.view = "time.report"
	m.timeState.ReportSort = "highest_over_budget"
	r := row{kind: "time.report_task", title: "C++", chart: true, chartSeconds: 3600, chartCost: 12500, chartValue: 3600, chartMax: 3600, chartOver: 2500, chartOverMax: 2500}
	text := stripANSI(strings.Join(m.renderStatisticLines(r, 88, false), "\n"))
	if !strings.Contains(text, "¥25") || !strings.Contains(text, "¥125") || strings.Contains(text, "1h") {
		t.Fatalf("overrun view shows wrong metric: %q", text)
	}
}
