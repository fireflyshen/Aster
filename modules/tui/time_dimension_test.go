package main

import "testing"

func TestReportDimensionsClampLegacyState(t *testing.T) {
	m := sampleModel()
	m.view = "time.report"
	m.timeState.Report = &CostReportSummary{
		ByTask: []CostReportTaskRow{
			{TaskUUID: "task", Title: "Must not be a report row"},
		},
		ByProject: []CostReportProjectRow{
			{ProjectKey: "p", ProjectName: "P", PeriodSeconds: 3600},
		},
	}
	for _, legacy := range []string{"", "task", "day", "project", "tag"} {
		m.timeState.ReportGroupBy = legacy
		_, _, dimension := m.timeReportDefaults()
		if dimension != "project" && dimension != "tag" {
			t.Fatalf("invalid report dimension %q", dimension)
		}
		m.syncTimeExtraRows()
		for _, r := range m.extra {
			if r.kind == "time.report_task" || r.kind == "time.day" {
				t.Fatalf("retired dimension leaked: %+v", r)
			}
		}
	}
	m.timeState.ReportGroupBy = "project"
	for i := 0; i < 4; i++ {
		m.action("time.report.group")
		want := "tag"
		if i%2 == 1 {
			want = "project"
		}
		if m.timeState.ReportGroupBy != want {
			t.Fatal("report must cycle through project and tag only")
		}
	}
}
