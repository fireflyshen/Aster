package main

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func stripANSI(s string) string {
	csi := regexp.MustCompile(`\x1b\[[0-9;]*m`)
	return csi.ReplaceAllString(s, "")
}

func makeTimeTestModel(now time.Time, highlightCost bool) model {
	m := newModel(Client{Host: "mac-mini"})
	m.width = 120
	m.height = 36
	m.ready = true
	m.busy = false
	m.view = "project:Work"
	m.snapReceived = now
	initBudget := int64(10000)
	currBudget := int64(15000)
	initSecs := 3600.0
	currSecs := 5400.0
	plannedMs := now.UnixMilli()
	hardStopMs := now.Add(90 * time.Minute).UnixMilli()
	hl := highlightCost

	m.tasks = []Task{
		{
			UUID:        "uuid-over",
			Description: "实现时间成本功能",
			Status:      "pending",
			Project:     "Work.Aster",
			Tags:        []string{"dev", "core"},
			Start: now.Add(-15 * time.Minute).
				UTC().
				Format("20060102T150405Z"),
		},
		{
			UUID:        "uuid-nobudget",
			Description: "临时排查问题",
			Status:      "pending",
			Project:     "Work",
		},
	}
	m.org.Projects = []Project{
		{Name: "Work.Aster", Status: "active"},
		{Name: "Work", Status: "later"},
	}
	m.org.Tags = []SavedItem{{Name: "dev"}, {Name: "core"}}
	m.org.Timing = &struct {
		Available       bool   `json:"available"`
		Error           string `json:"error"`
		Backend         string `json:"backend"`
		HardEnergyLimit *bool  `json:"hardEnergyLimit"`
		TimeEnabled     bool   `json:"timeEnabled"`
		TimeAvailable   bool   `json:"timeAvailable"`
		TimeError       string `json:"timeError"`
		EnergyPeriod    string `json:"energyPeriod"`
		Timezone        string `json:"timezone"`
		HistoryComplete bool   `json:"historyComplete"`
	}{
		Available:       true,
		Backend:         "time",
		TimeEnabled:     true,
		TimeAvailable:   true,
		HistoryComplete: true,
	}
	snap := &TimerSnapshot{
		Backend:         "time",
		ContractVersion: 1,
		TimeEpoch:       1,
		TaskDataEpoch:   1,
		State:           "ready",
		SessionVersion:  1,
		SnapshotAt:      now.UTC().Format(time.RFC3339),
		LiveUntil: now.Add(30 * time.Second).
			UTC().
			Format(time.RFC3339),
		HourlyRateCents:       10000,
		TaskListHighlightCost: &hl,
		ActiveActivity: &ActiveActivitySnapshot{
			ID:       "act-1",
			Version:  2,
			Title:    "实现时间成本功能",
			TaskUUID: "uuid-over",
			StartedAt: now.Add(-15 * time.Minute).
				UTC().
				Format(time.RFC3339),
			AutoStopAt: now.Add(18 * time.Minute).
				UTC().
				Format(time.RFC3339),
			TimingPlanID:    "plan-1",
			State:           "running",
			HourlyRateCents: 12000,
		},
		TaskTotalsSeconds: map[string]float64{
			"uuid-over":     10800,
			"uuid-nobudget": 1800,
		},
		TaskCosts: map[string]TaskCostSummary{
			"uuid-over": {
				TaskUUID:                "uuid-over",
				ConfirmedSeconds:        9000,
				ConfirmedCostCents:      30000,
				ProvisionalSeconds:      1800,
				ProvisionalCostCents:    5000,
				HasBudget:               true,
				InitialAllowanceSeconds: &initSecs,
				InitialBudgetCents:      &initBudget,
				CurrentAllowanceSeconds: &currSecs,
				CurrentBudgetCents:      &currBudget,
				AddedBudgetCents:        5000,
				OverInitialBudgetCents:  20000,
				OverCurrentBudgetCents:  15000,
				PlannedStartAtMs:        &plannedMs,
				HardStopAtMs:            &hardStopMs,
				LinkedCashCents:         4200,
				CombinedCostCents:       34200,
				CurrentHourlyRateCents:  12000,
			},
			"uuid-nobudget": {
				TaskUUID:               "uuid-nobudget",
				ConfirmedSeconds:       1800,
				ConfirmedCostCents:     5000,
				HasBudget:              false,
				OverInitialBudgetCents: 0,
				CurrentHourlyRateCents: 10000,
			},
		},
		TotalsComplete:  true,
		HistoryComplete: true,
	}
	m.timerSnap = snap
	m.org.TimerSnapshot = snap
	m.idx = buildViewIndex(m.tasks, m.org)
	return m
}

func TestTimerSnapshotCostJSONAndTaskListHighlight(t *testing.T) {
	raw := `{
		"backend":"time",
		"contractVersion":1,
		"state":"ready",
		"hourlyRateCents":12000,
		"taskListHighlightCost":true,
		"activeActivity":{"id":"a1","title":"编码","categoryId":"uncategorized","taskUuid":"t1","startedAt":"2026-11-15T10:00:00Z","state":"running","hourlyRateCents":12000},
		"taskTotalsSeconds":{"t1":3600},
		"taskCosts":{
			"t1":{"taskUuid":"t1","confirmedSeconds":3600,"confirmedCostCents":12000,"provisionalSeconds":0,"provisionalCostCents":0,"hasBudget":true,"initialBudgetCents":10000,"overInitialBudgetCents":2000,"linkedCashCents":1500,"combinedCostCents":13500,"currentHourlyRateCents":12000}
		}
	}`
	var snap TimerSnapshot
	if err := json.Unmarshal([]byte(raw), &snap); err != nil {
		t.Fatalf("failed to decode TimerSnapshot cost payload: %v", err)
	}
	if snap.HourlyRateCents != 12000 || !highlightTaskListCost(&snap) {
		t.Fatalf(
			"unexpected rate/highlight decoding: rate=%d hl=%v",
			snap.HourlyRateCents,
			highlightTaskListCost(&snap),
		)
	}
	sum, ok := lookupTaskCost(&snap, "T1")
	if !ok || sum.CombinedCostCents != 13500 {
		t.Fatalf(
			"case-insensitive TaskCosts lookup failed: ok=%v sum=%+v",
			ok,
			sum,
		)
	}

	now := time.Date(2026, 11, 15, 14, 0, 0, 0, time.Local)
	m := makeTimeTestModel(now, true)
	f := renderFrame{now: now, idx: m.idx}

	spOver := stripANSI(
		renderSpans(
			m.taskMetaSpans(f, row{kind: "task", task: m.tasks[0]}, false),
			110,
			110,
			false,
		),
	)
	if !strings.Contains(spOver, "¥300") ||
		!strings.Contains(spOver, "暂计 ¥50") ||
		!strings.Contains(spOver, "超出 ¥200") ||
		!strings.Contains(spOver, "现金 ¥42") {
		t.Fatalf(
			"expected highlighted cost + provisional + overrun + cash tags, got %q",
			spOver,
		)
	}
	if strings.Index(spOver, "¥300") > strings.Index(spOver, "▶ 3h") {
		t.Fatalf(
			"expected cost before duration when highlightCost=true, got %q",
			spOver,
		)
	}

	spNoBudget := stripANSI(
		renderSpans(
			m.taskMetaSpans(f, row{kind: "task", task: m.tasks[1]}, false),
			110,
			110,
			false,
		),
	)
	if !strings.Contains(spNoBudget, "未设预算") ||
		strings.Contains(spNoBudget, "超出") {
		t.Fatalf(
			"unbudgeted task must show 未设预算 and never overrun, got %q",
			spNoBudget,
		)
	}

	mDur := makeTimeTestModel(now, false)
	fDur := renderFrame{now: now, idx: mDur.idx}
	spDur := stripANSI(
		renderSpans(
			mDur.taskMetaSpans(
				fDur,
				row{kind: "task", task: mDur.tasks[0]},
				false,
			),
			110,
			110,
			false,
		),
	)
	if strings.Index(spDur, "▶ 3h") > strings.Index(spDur, "¥300") {
		t.Fatalf(
			"expected duration before cost when highlightCost=false, got %q",
			spDur,
		)
	}
}

func TestActiveCostLiveExtrapolationSleepZeroAndCountdown(t *testing.T) {
	now := time.Date(2026, 11, 15, 14, 0, 0, 0, time.Local)
	m := makeTimeTestModel(now, true)
	// Simulate 30 seconds elapsed locally within liveUntil (rate is ¥120/h -> 30s = ¥1 = 100 cents).
	later := now.Add(30 * time.Second)
	m.snapReceived = now
	f := renderFrame{now: later, idx: m.idx}
	sp := stripANSI(
		renderSpans(
			m.taskMetaSpans(f, row{kind: "task", task: m.tasks[0]}, false),
			120,
			120,
			false,
		),
	)
	if !strings.Contains(sp, "暂计 ¥51") {
		t.Fatalf(
			"expected live provisional extrapolation ¥50 + ¥1 = ¥51, got %q",
			sp,
		)
	}

	// Verify active sleep marker always yields ¥0.
	m.timerSnap.ActiveActivity = &ActiveActivitySnapshot{
		ID:         "sleep-1",
		Title:      "夜间睡眠",
		CategoryID: "sleep",
		StartedAt:  now.Add(-6 * time.Hour).UTC().Format(time.RFC3339),
		State:      "running",
	}
	isSleep, confCents, provCents, ok := displayedActiveCost(
		m.timerSnap,
		now,
		6*3600,
		true,
	)
	if !ok || !isSleep || confCents != 0 || provCents != 0 {
		t.Fatalf(
			"sleep activity must report ¥0, got sleep=%v conf=%d prov=%d ok=%v",
			isSleep,
			confCents,
			provCents,
			ok,
		)
	}

	// Verify countdown and narrow terminal header do not overflow width.
	wallNow := time.Now()
	m2 := makeTimeTestModel(wallNow, true)
	for _, w := range []int{65, 85, 120} {
		m2.width = w
		m2.height = 24
		view := m2.View()
		for _, line := range strings.Split(view, "\n") {
			if lipgloss.Width(line) > w {
				t.Fatalf(
					"width %d overflowed: %d (%q)",
					w,
					lipgloss.Width(line),
					stripANSI(line),
				)
			}
		}
		if w >= 100 && !strings.Contains(stripANSI(view), "剩 ") {
			t.Fatalf("expected autoStop countdown in header for width %d", w)
		}
	}
}

func TestContinuationCostPreviewHardStopCapAndExpiry(t *testing.T) {
	now := time.Date(2026, 11, 15, 14, 0, 0, 0, time.Local).UnixMilli()
	// Uncapped 30m at ¥100/h -> ¥50
	p1 := computeContinuationCostPreview(30*60, 10000, nil, now)
	if p1.Expired || p1.CappedByHardStop || p1.AdditionalCostCents != 5000 {
		t.Fatalf("unexpected uncapped preview: %+v", p1)
	}

	// Hard stop in 20m -> capped to 20m, cost ¥33.33
	hs20 := now + 20*60*1000
	p2 := computeContinuationCostPreview(30*60, 10000, &hs20, now)
	if p2.Expired || !p2.CappedByHardStop || p2.EffectiveSeconds != 1200 ||
		p2.AdditionalCostCents != 3333 {
		t.Fatalf("unexpected capped preview: %+v", p2)
	}

	// Hard stop passed -> expired
	hsPast := now - 60*1000
	p3 := computeContinuationCostPreview(30*60, 10000, &hsPast, now)
	if !p3.Expired || p3.EffectiveSeconds != 0 || p3.AdditionalCostCents != 0 {
		t.Fatalf("expected expired preview: %+v", p3)
	}
}

func TestTimeFormsNoPresetCategoriesAndSubmit(t *testing.T) {
	now := time.Date(2026, 11, 15, 14, 0, 0, 0, time.Local)
	m := makeTimeTestModel(now, true)

	// 1. Time log form: no preset categories, only project + tags + optional sleep toggle.
	m.selected = row{kind: "task", id: "uuid-over", task: m.tasks[0]}
	m.openTimeLogForm(&m.tasks[0])
	for _, f := range m.fields {
		if strings.Contains(f.label, "分类") {
			t.Fatalf(
				"unexpected preset category field in time.log: %q",
				f.label,
			)
		}
	}

	// 2. Plan form: no preset categories, uses project + tags.
	m.openCreatePlanForm(&m.tasks[0])
	for _, f := range m.fields {
		if strings.Contains(f.label, "分类") {
			t.Fatalf(
				"unexpected preset category field in time.plan.new: %q",
				f.label,
			)
		}
	}
	hint := m.dynamicFormHint()
	if !strings.Contains(hint, "¥150") {
		t.Fatalf(
			"expected live budget ¥ conversion ¥150 for prefilled 90m in dynamicFormHint, got %q",
			hint,
		)
	}
	m.fields[1].set("60")
	if !strings.Contains(m.dynamicFormHint(), "¥100") {
		t.Fatalf(
			"expected updated live budget ¥100 for 60m in dynamicFormHint, got %q",
			m.dynamicFormHint(),
		)
	}

	// 3. Open task form appends 3 budget fields in Time mode and leaves [0..8] intact.
	m.openTaskForm("task.edit", m.tasks[0])
	if len(m.fields) != 12 {
		t.Fatalf(
			"expected 12 fields on task.edit in Time mode, got %d",
			len(m.fields),
		)
	}
	if m.fields[9].value() != "90" {
		t.Fatalf("expected prefilled 90m budget, got %q", m.fields[9].value())
	}
	// Editing task budget fields validates and emits a budget payload; unchanged emits no budget change.
	vals := make([]string, len(m.fields))
	for i, f := range m.fields {
		vals[i] = f.value()
	}
	applyUnchanged, _, err := m.parseTaskFormBudget(
		vals,
		&[]TaskCostSummary{m.timerSnap.TaskCosts["uuid-over"]}[0],
	)
	if err != nil || applyUnchanged {
		t.Fatalf(
			"unchanged budget should not reapply, got apply=%v err=%v",
			applyUnchanged,
			err,
		)
	}
	vals[9] = "120"
	applyChanged, payload, err := m.parseTaskFormBudget(
		vals,
		&[]TaskCostSummary{m.timerSnap.TaskCosts["uuid-over"]}[0],
	)
	if err != nil || !applyChanged || payload["allowanceSeconds"] != 7200 {
		t.Fatalf(
			"expected 7200s budget update payload, got apply=%v payload=%+v err=%v",
			applyChanged,
			payload,
			err,
		)
	}

	// 4. Settings form dynamic hint updates with new rate.
	m.timeState.Policy = &TimePolicy{
		PolicyVersion: 3,
		Timezone:      "Asia/Shanghai",
		SleepTemplate: SleepTemplate{
			Enabled:   true,
			StartTime: "23:30",
			EndTime:   "07:30",
		},
		LongActivityThresholdSeconds: 21600,
		ReconcileReminder: ReconcileReminderPolicy{
			Enabled: true,
			Hour:    21,
			Minute:  30,
		},
	}
	m.openTimeSettingsForm()
	m.fields[0].set("200")
	if !strings.Contains(m.dynamicFormHint(), "30 分钟 ≈ ¥100") {
		t.Fatalf(
			"expected dynamic rate conversion ¥100 for 30m at ¥200/h, got %q",
			m.dynamicFormHint(),
		)
	}
}

func TestInspectorAndTimeViewsRenderCleanly(t *testing.T) {
	now := time.Date(2026, 11, 15, 14, 0, 0, 0, time.Local)
	m := makeTimeTestModel(now, true)
	m.detail = true
	rows := m.idx.rows(m, now)
	overIdx := -1
	noBudgetIdx := -1
	for i, r := range rows {
		if r.kind == "task" && r.id == "uuid-over" {
			overIdx = i
		}
		if r.kind == "task" && r.id == "uuid-nobudget" {
			noBudgetIdx = i
		}
	}
	if overIdx < 0 || noBudgetIdx < 0 {
		t.Fatalf(
			"expected both task rows, got over=%d noBudget=%d",
			overIdx,
			noBudgetIdx,
		)
	}
	f := renderFrame{
		now:     now,
		idx:     m.idx,
		visible: m.tasks,
		rows:    rows,
	}
	f.cur = currentRow(rows, overIdx)
	insp := stripANSI(m.inspector(48, 34, f))
	for _, want := range []string{"投入成本与预算", "已确认", "¥300", "暂计 ¥50", "最初 ¥100", "超出最初预估 ¥200", "¥42", "¥342"} {
		if !strings.Contains(insp, want) {
			t.Fatalf("expected %q in task cost inspector, got:\n%s", want, insp)
		}
	}
	f.cur = currentRow(rows, noBudgetIdx)
	inspNB := stripANSI(m.inspector(48, 34, f))
	if !strings.Contains(inspNB, "未设预算") || strings.Contains(inspNB, "超出最初预估") {
		t.Fatalf(
			"expected 未设预算 for unbudgeted task inspector, got:\n%s",
			inspNB,
		)
	}

	// Weekly distribution uses TW projects & tags, zero preset categories.
	m.view = "time.weekly"
	m.timeState.WeeklyDimension = "project"
	m.timeState.Weekly = &WeeklyDistributionSummary{
		WeekStartDate:        "2026-11-09",
		WeekEndDate:          "2026-11-15",
		CoveredSeconds:       7200,
		ConfirmedCostCents:   20000,
		ProvisionalCostCents: 5000,
		UnrecordedSeconds:    3600,
		ByProjectSeconds: map[string]float64{
			"Work.Aster":     5400,
			"__unassigned__": 1800,
		},
		ByProjectCostCents: map[string]int64{
			"Work.Aster":     15000,
			"__unassigned__": 5000,
		},
		ByTagSeconds: map[string]float64{
			"dev":          5400,
			"__untagged__": 1800,
		},
		ByTagCostCents: map[string]int64{
			"dev":          15000,
			"__untagged__": 5000,
		},
	}
	m.syncTimeExtraRows()
	if len(m.extra) != 3 {
		t.Fatalf(
			"expected summary + selected project dimension in time.weekly, got %d",
			len(m.extra),
		)
	}
	if !strings.Contains(m.extra[1].title, "Work.Aster") ||
		!strings.Contains(m.extra[1].subtitle, "¥150") {
		t.Fatalf("unexpected weekly project row: %+v", m.extra[1])
	}

	// Cost report switching group (task vs project) & Enter key toggling detail.
	m.view = "time.report"
	initB := int64(10000)
	m.timeState.Report = &CostReportSummary{
		Granularity:                   "week",
		PeriodStartDate:               "2026-11-09",
		PeriodEndDate:                 "2026-11-15",
		SortBy:                        "highest_over_budget",
		TotalPeriodConfirmedCostCents: 30000,
		TotalCashExpenseCents:         4200,
		TotalCombinedCostCents:        34200,
		ByTask: []CostReportTaskRow{{
			TaskUUID:                    "uuid-over",
			Title:                       "实现时间成本功能",
			ProjectSnapshot:             "Work.Aster",
			Tags:                        []string{"dev"},
			PeriodSeconds:               10800,
			PeriodCostCents:             30000,
			CumulativeCostCents:         30000,
			HasBudget:                   true,
			InitialBudgetCents:          &initB,
			OverInitialBudgetCents:      20000,
			CashExpenseCents:            4200,
			CombinedCumulativeCostCents: 34200,
		}},
		ByProject: []CostReportProjectRow{{
			ProjectKey:              "Work.Aster",
			ProjectName:             "Work.Aster",
			PeriodSeconds:           10800,
			PeriodCostCents:         30000,
			OverInitialBudgetCents:  20000,
			CashExpenseCents:        4200,
			CombinedPeriodCostCents: 34200,
			TaskCount:               1,
		}},
	}
	m.syncTimeExtraRows()
	if len(m.extra) != 2 || m.extra[1].kind != "time.report_project" {
		t.Fatalf("expected summary + project row, got %+v", m.extra)
	}
	nextM, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'v'}})
	mAfter := nextM.(model)
	if mAfter.timeState.ReportGroupBy != "tag" {
		t.Fatalf(
			"expected v key to toggle group by tag, got %+v",
			mAfter.extra,
		)
	}
}
