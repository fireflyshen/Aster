package main

import (
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss"
)

func TestStatisticsDeduplicateAndKeepSleep(t *testing.T) {
	m := makeTimeTestModel(time.Now(), true)
	m.view = "time.report"
	work := CostReportSegmentRef{
		ActivityID:         "work",
		Date:               "2026-11-15",
		StartMs:            1000,
		EndMs:              2000,
		ConfirmedSeconds:   3600,
		ConfirmedCostCents: 10000,
		Tags:               []string{"study", "study", "code"},
	}
	sleep := CostReportSegmentRef{
		ActivityID:       "sleep",
		Date:             "2026-11-15",
		ConfirmedSeconds: 28800,
	}
	m.timeState.Report = &CostReportSummary{
		PeriodStartDate: "2026-11-14",
		PeriodEndDate:   "2026-11-15",
		ByProject: []CostReportProjectRow{
			{Segments: []CostReportSegmentRef{work}},
		},
		ByTask: []CostReportTaskRow{
			{Segments: []CostReportSegmentRef{work}},
		},
		UnassignedSegments: []CostReportSegmentRef{sleep, work},
	}
	m.timeState.ReportGroupBy = "tag"
	rows := m.statisticRows()
	if len(rows) != 3 || rows[0].id != "__untagged__" ||
		rows[0].chartSeconds != 28800 {
		t.Fatalf("sleep and dedup: %+v", rows)
	}
	m.timeState.ChartMetric = "cost"
	m.timeState.ReportGroupBy = "tag"
	rows = m.statisticRows()
	if len(rows) != 3 {
		t.Fatalf("tag stats: %+v", rows)
	}
	for _, r := range rows {
		if r.id == "study" && r.chartValue != 10000 {
			t.Fatal("duplicate tag counted")
		}
	}
}

func TestChartWidthsAndZero(t *testing.T) {
	for _, width := range []int{1, 8, 24, 70} {
		for _, value := range []float64{0, 1, 50, 100} {
			out := renderStatisticBar(value, 100, width)
			if lipgloss.Width(out) > width || strings.Contains(out, "\n") {
				t.Fatalf("chart overflow width=%d: %q", width, out)
			}
			if value == 0 && strings.TrimSpace(stripANSI(out)) != "" {
				t.Fatalf("zero drew a bar: %q", out)
			}
			if value == 100 && strings.TrimSpace(stripANSI(out)) == "" {
				t.Fatal("nonzero chart missing")
			}
		}
	}
}

func TestTimelineRemovesPlansAndSorts(t *testing.T) {
	m := makeTimeTestModel(time.Now(), true)
	m.view = "time.today"
	m.timeState.Plans = []TimingPlan{
		{ID: "plan", Title: "Hidden plan", Status: "ready"},
	}
	m.timeState.Daily = &DailyLedgerSummary{
		LocatedSegments: []LocatedSegment{
			{ActivityID: "late", StartMs: 2000},
			{ActivityID: "early", StartMs: 1000},
		},
	}
	m.syncTimeExtraRows()
	if len(m.extra) != 3 || m.extra[1].id != "early" {
		t.Fatalf("unexpected timeline: %+v", m.extra)
	}
	for _, r := range m.extra {
		if r.kind == "time.plan" {
			t.Fatal("plan leaked into timeline")
		}
	}
}

func TestWeeklyChartProjectTagSwitching(t *testing.T) {
	m := makeTimeTestModel(time.Now(), true)
	m.view = "time.weekly"
	m.navFocus = false
	m.timeState.Weekly = &WeeklyDistributionSummary{
		ByProjectSeconds:   map[string]float64{"Work": 3600},
		ByProjectCostCents: map[string]int64{"Work": 20000},
		ByTagSeconds:       map[string]float64{"dev": 3600},
		ByTagCostCents:     map[string]int64{"dev": 20000},
	}
	m.syncTimeExtraRows()
	if len(m.extra) != 2 || m.extra[1].id != "Work" {
		t.Fatalf("project should be default: %+v", m.extra)
	}
	m.action("time.weekly.group")
	if m.timeState.WeeklyDimension != "tag" || m.extra[1].id != "dev" {
		t.Fatal("tag switch failed")
	}
	m.action("time.chart.metric")
	if m.extra[1].chartValue != 20000 {
		t.Fatal("cost switch failed")
	}
	m.action("time.weekly.group")
	if m.extra[1].id != "Work" {
		t.Fatal("must cycle back to project")
	}
}

func TestProjectTreeIncludesParentsWithoutLaterGroup(t *testing.T) {
	m := sampleModel()
	m.org.Projects = []Project{
		{Name: "Work.Aster.UI", Status: "active"},
		{Name: "Work.Aster.API", Status: "later"},
		{Name: "Family", Status: "later"},
	}
	es := m.nav()
	names := []string{}
	for i, e := range es {
		if e.id == "toggle:later" {
			t.Fatal("unexpected Later group")
		}
		if strings.HasPrefix(e.id, "project:") {
			names = append(names, e.id)
			label := projectTreeLabel(
				strings.TrimPrefix(e.id, "project:"),
				es,
				i,
			)
			if strings.HasSuffix(e.id, "API") &&
				!strings.Contains(label, "├─ API") {
				t.Fatalf("missing tree branch: %q", label)
			}
		}
	}
	if strings.Join(
		names,
		",",
	) != "project:Family,project:Work,project:Work.Aster,project:Work.Aster.API,project:Work.Aster.UI" {
		t.Fatalf("tree order: %v", names)
	}
}

func TestStatisticsViewsFitTerminal(t *testing.T) {
	m := makeTimeTestModel(time.Now(), true)
	m.navFocus = false
	m.org.Projects = []Project{
		{Name: "学习.C++.标准库", Status: "active"},
		{Name: "家庭财务", Status: "later"},
	}
	m.timeState.Weekly = &WeeklyDistributionSummary{
		Daily: []DailyLedgerSummary{
			{
				Date:               "2026-11-15",
				CoveredSeconds:     7200,
				ConfirmedCostCents: 20000,
			},
		},
		ByProjectSeconds: map[string]float64{"学习.C++.标准库": 7200},
	}
	m.timeState.Daily = &DailyLedgerSummary{
		LocatedSegments: []LocatedSegment{
			{
				ActivityID:         "1",
				Title:              "C++ 作用域、生命周期与 using",
				StartMs:            1000,
				EndMs:              2000,
				DurationSeconds:    7200,
				ConfirmedCostCents: 20000,
			},
		},
	}
	for _, size := range [][2]int{{65, 24}, {85, 30}, {140, 36}} {
		m.width = size[0]
		m.height = size[1]
		for _, view := range []string{"time.today", "time.weekly"} {
			m.view = view
			m.syncTimeExtraRows()
			out := m.View()
			if lipgloss.Height(out) > m.height {
				t.Fatalf("%s height overflow", view)
			}
			for _, line := range strings.Split(out, "\n") {
				if lipgloss.Width(line) > m.width {
					t.Fatalf("%s width overflow %d: %q", view, m.width, line)
				}
			}
		}
	}
}
