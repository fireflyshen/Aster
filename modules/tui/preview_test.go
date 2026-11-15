package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func TestPreviewArtifacts(t *testing.T) {
	dir := os.Getenv("ASTER_PREVIEW_DIR")
	if dir == "" {
		t.Skip("set ASTER_PREVIEW_DIR to render sample screens")
	}
	lipgloss.SetColorProfile(termenv.TrueColor)
	lipgloss.SetHasDarkBackground(true)
	defer lipgloss.SetColorProfile(termenv.Ascii)
	m := sampleModel()
	m.client.Host = "rn"
	m.message = "已连接 rn"
	m.width = 140
	m.height = 36
	m.cursor = 5
	for _, name := range []string{"list", "board", "form"} {
		m.mode = ""
		m.board = false
		if name == "board" {
			m.board = true
			m.boardColumn = 2
		}
		if name == "form" {
			m.selected = m.current()
			m.openTaskForm("task.edit", m.current().task)
		}
		if e := os.WriteFile(
			filepath.Join(dir, name+".ansi"),
			[]byte(m.View()),
			0600,
		); e != nil {
			t.Fatal(e)
		}
	}
}

// Time previews use the real renderer and never connect to the server.
func TestTimePreviewArtifacts(t *testing.T) {
	dir := os.Getenv("ASTER_PREVIEW_DIR")
	if dir == "" {
		t.Skip("set ASTER_PREVIEW_DIR to render time screens")
	}
	lipgloss.SetColorProfile(termenv.TrueColor)
	lipgloss.SetHasDarkBackground(true)
	defer lipgloss.SetColorProfile(termenv.Ascii)
	now := time.Date(2026, 11, 15, 16, 0, 0, 0, time.Local)
	m := makeTimeTestModel(now, true)
	m.timerSnap = nil
	m.org.TimerSnapshot = nil
	m.org.Energy = nil
	m.width = 140
	m.height = 36
	m.navFocus = false
	m.cursor = 1
	m.message = ""
	m.timeState.SelectedDate = "2026-11-15"
	m.org.Projects = []Project{{Name: "学习.C++.标准库", Status: "active"}, {Name: "学习.C++.练习", Status: "later"}, {Name: "家庭财务", Status: "later"}}
	m.timeState.Daily = &DailyLedgerSummary{Date: "2026-11-15", CoveredSeconds: 6660, ConfirmedCostCents: 18636, LocatedSegments: []LocatedSegment{
		{ActivityID: "1", Title: "C++ 作用域、生命周期与 using", StartMs: now.Add(-8 * time.Hour).UnixMilli(), EndMs: now.Add(-405 * time.Minute).UnixMilli(), DurationSeconds: 4500, ConfirmedCostCents: 12497, ProjectSnapshot: "学习.C++.标准库", Tags: []string{"编码"}},
		{ActivityID: "2", Title: "C++ 指针与内存模型", StartMs: now.Add(-6 * time.Hour).UnixMilli(), EndMs: now.Add(-324 * time.Minute).UnixMilli(), DurationSeconds: 2160, ConfirmedCostCents: 6139, ProjectSnapshot: "学习.C++.标准库", Tags: []string{"阅读"}}}}
	w := &WeeklyDistributionSummary{WeekStartDate: "2026-11-09", WeekEndDate: "2026-11-15", CoveredSeconds: 18000, ConfirmedCostCents: 50000}
	for i, secs := range []float64{0, 0, 7200, 3600, 1800, 0, 5400} {
		w.Daily = append(w.Daily, DailyLedgerSummary{Date: fmt.Sprintf("2026-11-%02d", 9+i), CoveredSeconds: secs, ConfirmedCostCents: int64(secs / 3600 * 10000)})
	}
	m.timeState.Weekly = w
	for _, view := range []string{"time.today", "time.weekly"} {
		m.view = view
		m.syncTimeExtraRows()
		for _, width := range []int{80, 140} {
			m.width = width
			base := filepath.Join(dir, fmt.Sprintf("%s-%d", view, width))
			if err := os.WriteFile(base+".ansi", []byte(m.View()), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(base+".txt", []byte(stripANSI(m.View())), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
}
