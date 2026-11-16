package main

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestSidebarFiveSectionsAndHeaderSkipping(t *testing.T) {
	m := sampleModel()
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
		Available:     true,
		Backend:       "time",
		TimeEnabled:   true,
		TimeAvailable: true,
	}
	m.org.Projects = []Project{
		{Name: "Work", Status: "active", Color: "blue"},
		{Name: "Someday", Status: "later", Color: "gray"},
	}
	m.org.Filters = []SavedItem{
		{
			ID:         "f-fav",
			Name:       "重要事项",
			Expression: "status:pending +WORK",
			Color:      "red",
			Favorite:   true,
		},
		{
			ID:         "f-plain",
			Name:       "普通事项",
			Expression: "status:pending",
		},
	}
	m.org.Tags = []SavedItem{
		{ID: "t-fav", Name: "urgent", Color: "orange", Favorite: true},
	}

	es := m.nav()
	var ids, headers []string
	for _, e := range es {
		ids = append(ids, e.id)
		if e.header {
			headers = append(headers, e.title)
		}
	}

	for _, wantHeader := range []string{"核心视图", "时间账本", "收藏", "我的项目", "工具"} {
		if !slices.Contains(headers, wantHeader) {
			t.Fatalf(
				"expected section header %q in nav, got %v",
				wantHeader,
				headers,
			)
		}
	}

	for _, removed := range []string{"urgency", "active", "waiting", "completed", "all", "later", "filters", "tags", "columns", "recovery", "backup"} {
		if slices.Contains(ids, removed) {
			t.Fatalf("did not expect retired nav entry %q in %v", removed, ids)
		}
	}

	for _, want := range []string{
		"now",
		"focus",
		"inbox",
		"today",
		"time.today",
		"time.weekly",
		"time.report",
		"filter:f-fav",
		"tag:urgent",
		"project:Work",
		"project:Someday",
		"projects",
		"org",
		"data",
	} {
		if !slices.Contains(ids, want) {
			t.Fatalf("expected nav entry %q in %v", want, ids)
		}
	}
	if slices.Contains(ids, "filter:f-plain") {
		t.Fatalf("non-favorited filter should not appear in favorites: %v", ids)
	}
	if slices.Contains(ids, "toggle:later") {
		t.Fatalf("project tree should not have a Later toggle: %v", ids)
	}

	// Cursor movement skips section headers.
	m.navFocus = true
	m.navCursor = 0
	m.clampNavCursor()
	if es[m.navCursor].header {
		t.Fatalf("navCursor should not rest on header: %+v", es[m.navCursor])
	}
	for step := 0; step < len(es); step++ {
		if es[m.navCursor].header {
			t.Fatalf(
				"navCursor landed on header at step %d: %+v",
				step,
				es[m.navCursor],
			)
		}
		m.moveNavCursor(1)
	}

	// Expand Later projects via toggle:later.
	m.laterCollapsed = false
	expanded := m.nav()
	var expandedIDs []string
	for _, e := range expanded {
		expandedIDs = append(expandedIDs, e.id)
	}
	if !slices.Contains(expandedIDs, "project:Someday") {
		t.Fatalf("expected Someday project when expanded: %v", expandedIDs)
	}

	sidebarOut := stripANSI(
		m.sidebar(30, 32, renderFrame{now: time.Now(), idx: m.viewIdx()}),
	)
	for _, label := range []string{"核心视图", "时间账本", "收藏", "我的项目", "工具", "1/3"} {
		if !strings.Contains(sidebarOut, label) {
			t.Fatalf("expected %q in rendered sidebar:\n%s", label, sidebarOut)
		}
	}
}

func TestMergedOrgViewAndCustomItems(t *testing.T) {
	c, log := validClient(t)
	m := sampleModel()
	m.client = c
	m.navFocus = false
	m.view = "org"
	m.org.Filters = []SavedItem{
		{ID: "f1", Name: "自定义Work", Expression: "project:Work", Favorite: true},
	}
	m.org.Tags = []SavedItem{
		{ID: "t1", Name: "focus", Color: "green"},
	}

	now := time.Now()
	findRow := func(rows []row, id string) (int, row) {
		for i, r := range rows {
			if r.id == id {
				return i, r
			}
		}
		return -1, row{}
	}

	rows := m.viewIdx().rows(m, now)
	if idx, _ := findRow(rows, "org.builtin"); idx >= 0 {
		t.Fatalf("did not expect built-in filters section in org view")
	}
	fIdx, _ := findRow(rows, "f1")
	if fIdx < 0 {
		t.Fatalf("expected custom filter f1 row in org view")
	}

	// Toggle favorite on custom filter -> sends kind=filter, action=save, item.favorite=false.
	m.cursor = fIdx
	cmd := m.action("item.favorite")
	if cmd == nil {
		t.Fatalf("expected orgChange cmd for filter item.favorite")
	}
	cmd()
	p := readPayload(t, log)
	data := p["data"].(map[string]any)
	item := data["item"].(map[string]any)
	if data["kind"] != "filter" || data["action"] != "save" ||
		item["id"] != "f1" ||
		item["favorite"] != false {
		t.Fatalf("unexpected favorite payload: %+v", p)
	}

	// Non-clickable info header guards cleanly against delete/favorite.
	infoIdx, _ := findRow(rows, "org.filters")
	if infoIdx < 0 {
		t.Fatalf("expected org.filters section header row")
	}
	m.cursor = infoIdx
	if c1 := m.action("delete"); c1 != nil {
		t.Fatalf("expected nil cmd when deleting info row")
	}
}

func TestMergedDataViewAndLegacyOrgJSON(t *testing.T) {
	raw := []byte(
		`{"revision":3,"builtinFilterPrefs":{"favorites":["builtin:ready"],"hidden":["builtin:blocked"],"sectionHidden":true}}`,
	)
	var org Organization
	if err := json.Unmarshal(raw, &org); err != nil {
		t.Fatalf("unmarshal legacy Organization failed: %v", err)
	}
	if org.Revision != 3 {
		t.Fatalf("expected revision 3, got %d", org.Revision)
	}

	m := sampleModel()
	m.view = "data"
	m.dataDeleted = []row{{kind: "deleted", id: "u-del", title: "已删除任务"}}
	m.dataBackup = []row{{kind: "backup", id: "export", title: "导出完整备份"}}
	m.rebuildDataRows()

	rows := m.viewIdx().rows(m, time.Now())
	var sawDeleted, sawBackup bool
	for _, r := range rows {
		if r.id == "u-del" && r.kind == "deleted" {
			sawDeleted = true
		}
		if r.id == "export" && r.kind == "backup" {
			sawBackup = true
		}
	}
	if !sawDeleted || !sawBackup {
		t.Fatalf(
			"expected merged data rows for recovery + backup, got %+v",
			rows,
		)
	}

	for _, nonTask := range []string{"projects", "org", "data", "time.today"} {
		m.view = nonTask
		if m.taskView() {
			t.Fatalf("expected taskView()=false for %q", nonTask)
		}
	}
	for _, taskV := range []string{"now", "focus", "inbox", "today"} {
		m.view = taskV
		if !m.taskView() {
			t.Fatalf("expected taskView()=true for %q", taskV)
		}
	}
}
