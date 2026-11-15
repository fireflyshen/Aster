package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

type loaded struct {
	tasks []Task
	org   Organization
	err   error
}
type saved struct {
	err     error
	message string
}
type result struct {
	kind string
	data json.RawMessage
	err  error
}
type tickMsg struct {
	at  time.Time
	gen int
}
type entry struct {
	id, title string
	header    bool
}
type row struct {
	kind, id, title, subtitle string
	task                      Task
	project                   Project
	item                      SavedItem
	column                    Column
	count                     int
	depth                     int
	lastChild                 bool
	parentTitle               string
	chartValue, chartMax      float64
	chart                     bool
	chartSeconds              float64
	chartCost                 int64
	chartOver                 int64
	chartOverMax              float64
}
type choice struct{ value, label, hint string }
type undoChange struct {
	route       string
	data        map[string]any
	description string
}
type model struct {
	formRevision                                 int
	lastRefresh                                  time.Time
	snapReceived                                 time.Time
	client                                       Client
	tasks                                        []Task
	org                                          Organization
	timerSnap                                    *TimerSnapshot
	idx                                          viewIndex
	tickGen                                      int
	view, query, message                         string
	expression                                   string
	cursor, navCursor, width, height             int
	navFocus, busy, blocked, board, detail, help bool
	detailScroll, boardColumn                    int
	collapsed                                    map[string]bool
	expandedSubtasks                             map[string]bool
	mode                                         string
	search                                       textinput.Model
	options                                      []choice
	optionCursor                                 int
	choiceField                                  int
	fields                                       []field
	field                                        int
	formKind, formTitle, formHint                string
	selected                                     row
	draft                                        map[string][]string
	extra                                        []row
	dataDeleted                                  []row
	dataBackup                                   []row
	filterLoaded                                 bool
	laterCollapsed                               bool
	showHiddenBuiltin                            bool
	preview                                      json.RawMessage
	previewToken                                 string
	undo                                         *undoChange
	ready                                        bool
	timeState                                    TimeState
}

func newModel(c Client) model {
	s := textinput.New()
	s.Placeholder = "输入关键词…"
	s.Width = 64
	return model{
		client:           c,
		view:             "focus",
		navCursor:        1,
		laterCollapsed:   true,
		width:            120,
		height:           32,
		busy:             true,
		collapsed:        map[string]bool{},
		expandedSubtasks: map[string]bool{},
		draft:            map[string][]string{},
		search:           s,
		choiceField:      -1,
	}
}
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
}

func inProject(
	name, root string,
) bool {
	return name == root || strings.HasPrefix(name, root+".")
}
func date(s string) time.Time {
	for _, f := range []string{"20060102T150405Z", time.RFC3339Nano} {
		if t, e := time.Parse(f, s); e == nil {
			return t
		}
	}
	return time.Time{}
}
func compact(s string) string {
	if s == "" {
		return ""
	}
	t := date(s)
	if t.IsZero() {
		return s
	}
	return t.UTC().Format("20060102T150405Z")
}
func shownDate(s string) string {
	t := date(s)
	if t.IsZero() {
		return ""
	}
	return t.Local().Format("2006-01-02 15:04")
}
func (m model) isTimeMode() bool {
	return (m.org.Timing != nil && m.org.Timing.Backend == "time") ||
		(m.timerSnap != nil && m.timerSnap.Backend == "time")
}

func (m model) activeTimingTaskUUID() string {
	snap := m.timerSnap
	if snap == nil {
		snap = m.org.TimerSnapshot
	}
	if snap == nil || snap.ActiveActivity == nil {
		return ""
	}
	return snap.ActiveActivity.TaskUUID
}

func isSnapshotNewerOrEqual(incoming, current *TimerSnapshot) bool {
	if incoming == nil {
		return false
	}
	if current == nil {
		return true
	}
	if incoming.TimeEpoch != current.TimeEpoch {
		return incoming.TimeEpoch > current.TimeEpoch
	}
	if incoming.TaskDataEpoch != current.TaskDataEpoch {
		return incoming.TaskDataEpoch > current.TaskDataEpoch
	}
	if incoming.SessionVersion != current.SessionVersion {
		return incoming.SessionVersion > current.SessionVersion
	}
	nextAt := date(incoming.SnapshotAt)
	currAt := date(current.SnapshotAt)
	if nextAt.IsZero() {
		return false
	}
	if currAt.IsZero() {
		return true
	}
	return !nextAt.Before(currAt)
}

func (m model) snapshotLiveStatus(
	now time.Time,
) (canTick bool, cappedExtra float64, stateLabel string) {
	snap := m.timerSnap
	if snap == nil {
		snap = m.org.TimerSnapshot
	}
	if snap == nil {
		return false, 0, "unavailable"
	}
	switch snap.State {
	case "restoring":
		return false, 0, "restoring"
	case "unavailable":
		return false, 0, "unavailable"
	case "pending_reconcile":
		return false, 0, "pending_reconcile"
	}
	if snap.ActiveActivity == nil {
		return false, 0, "idle"
	}
	if snap.ActiveActivity.State == "review_required" ||
		snap.ActiveActivity.SuspendAt != "" {
		return false, 0, "review_required"
	}
	snapAt := date(snap.SnapshotAt)
	liveUntil := date(snap.LiveUntil)
	maxLive := liveUntil.Sub(snapAt)
	if snapAt.IsZero() || liveUntil.IsZero() || maxLive < 0 {
		maxLive = 0
	}
	hitAutoStop := false
	var autoStopRemaining time.Duration
	if snap.ActiveActivity.AutoStopAt != "" {
		if autoStop := date(
			snap.ActiveActivity.AutoStopAt,
		); !autoStop.IsZero() &&
			!snapAt.IsZero() {
			rem := max(time.Duration(0), autoStop.Sub(snapAt))
			if rem < maxLive {
				maxLive = rem
			}
			autoStopRemaining = rem
			hitAutoStop = true
		}
	}
	var elapsed time.Duration
	if !m.snapReceived.IsZero() {
		elapsed = now.Sub(m.snapReceived)
	}
	if elapsed < 0 {
		elapsed = 0
	}
	if (hitAutoStop && elapsed >= autoStopRemaining) || elapsed > maxLive {
		return false, min(elapsed, maxLive).Seconds(), "stale"
	}
	return true, elapsed.Seconds(), "live"
}

func (m model) activeActivityElapsed(now time.Time) (float64, bool) {
	snap := m.timerSnap
	if snap == nil {
		snap = m.org.TimerSnapshot
	}
	if snap == nil || snap.ActiveActivity == nil {
		return 0, false
	}
	started := date(snap.ActiveActivity.StartedAt)
	snapAt := date(snap.SnapshotAt)
	if started.IsZero() || snapAt.IsZero() {
		return 0, false
	}
	if snap.ActiveActivity.SuspendAt != "" {
		suspend := date(snap.ActiveActivity.SuspendAt)
		if !suspend.IsZero() {
			return max(0.0, suspend.Sub(started).Seconds()), true
		}
	}
	base := max(0.0, snapAt.Sub(started).Seconds())
	maxAutoStop := -1.0
	if snap.ActiveActivity.AutoStopAt != "" {
		if autoStop := date(
			snap.ActiveActivity.AutoStopAt,
		); !autoStop.IsZero() {
			maxAutoStop = max(0.0, autoStop.Sub(started).Seconds())
			if base > maxAutoStop {
				base = maxAutoStop
			}
		}
	}
	if snap.State != "ready" || snap.ActiveActivity.State != "running" {
		return base, true
	}
	_, extra, _ := m.snapshotLiveStatus(now)
	total := base + extra
	if maxAutoStop >= 0 && total > maxAutoStop {
		total = maxAutoStop
	}
	return total, true
}

func (m model) resolveTaskTiming(
	t Task,
	td parsedDates,
	now time.Time,
) (isTime, isTiming, started bool, secs float64, secsKnown bool) {
	started = t.Start != "" && t.Status != "completed"
	if m.isTimeMode() {
		if m.org.Timing != nil && !m.org.Timing.Available {
			return true, false, started, 0, false
		}
		snap := m.timerSnap
		if snap == nil {
			snap = m.org.TimerSnapshot
		}
		if snap == nil {
			return true, false, started, 0, false
		}
		activeUUID := m.activeTimingTaskUUID()
		isTiming = t.Status != "completed" && activeUUID != "" &&
			strings.EqualFold(activeUUID, t.UUID)
		key := strings.ToLower(t.UUID)
		base, ok := snap.TaskTotalsSeconds[key]
		if !ok {
			base, ok = snap.TaskTotalsSeconds[t.UUID]
		}
		if !ok {
			return true, isTiming, started, 0, false
		}
		if isTiming && snap.State == "ready" && snap.ActiveActivity != nil &&
			snap.ActiveActivity.State == "running" {
			_, extra, _ := m.snapshotLiveStatus(now)
			return true, true, started, base + extra, true
		}
		return true, isTiming, started, base, true
	}
	base := 0.0
	if m.org.Energy != nil {
		base = m.org.Energy.TaskSeconds[t.UUID]
	}
	if started && !td.start.IsZero() {
		live := max(0.0, now.Sub(td.start).Seconds())
		return false, true, true, max(base, live), true
	}
	return false, false, false, base, true
}

func (m model) tickInterval() time.Duration {
	if m.isTimeMode() {
		canTick, _, _ := m.snapshotLiveStatus(time.Now())
		if canTick {
			return time.Second
		}
		return 10 * time.Second
	}
	if m.viewIdx().anyRunning {
		return time.Second
	}
	return 10 * time.Second
}
func (m model) nextTick() tea.Cmd {
	gen := m.tickGen
	return tea.Tick(
		m.tickInterval(),
		func(t time.Time) tea.Msg { return tickMsg{t, gen} },
	)
}
func (m model) Init() tea.Cmd {
	return tea.Batch(
		m.refresh(),
		m.nextTick(),
	)
}
func (m model) refresh() tea.Cmd {
	return func() tea.Msg {
		var (
			o  Organization
			ts []Task
			oe error
			te error
			wg sync.WaitGroup
		)
		wg.Add(2)
		go func() {
			defer wg.Done()
			o, oe = m.client.workspace()
		}()
		go func() {
			defer wg.Done()
			ts, te = m.client.tasks()
		}()
		wg.Wait()
		if oe != nil {
			return loaded{err: oe}
		}
		return loaded{ts, o, te}
	}
}
func (m model) write(route string, data any) tea.Cmd {
	return func() tea.Msg { return saved{m.client.mutate(route, data), "已保存"} }
}
func (m model) read(kind, route string) tea.Cmd {
	return func() tea.Msg { var b json.RawMessage; e := m.client.read(route, &b); return result{kind, b, e} }
}
func (m model) nav() []entry {
	es := []entry{
		{id: "hdr:core", title: "核心视图", header: true},
		{id: "focus", title: "◎  Focus"},
		{id: "inbox", title: "▣  收件箱"},
		{id: "today", title: "◷  今天"},
	}
	if m.isTimeMode() {
		es = append(
			es,
			entry{id: "hdr:time", title: "时间账本", header: true},
			entry{id: "time.today", title: "◷  今日时间线"},
			entry{id: "time.weekly", title: "◫  本周分布"},
			entry{id: "time.report", title: "¥  成本报告"},
		)
	}
	var favs []entry
	for _, f := range m.org.Filters {
		if f.Favorite {
			favs = append(
				favs,
				entry{id: "filter:" + f.ID, title: "★  " + f.Name},
			)
		}
	}
	for _, bf := range resolveBuiltinFilters(m.org.BuiltinFilterPrefs) {
		if bf.Item.Favorite {
			favs = append(
				favs,
				entry{id: "filter:" + bf.Item.ID, title: "★  " + bf.Item.Name},
			)
		}
	}
	for _, t := range m.org.Tags {
		if t.Favorite {
			favs = append(
				favs,
				entry{id: "tag:" + t.Name, title: "#  " + t.Name},
			)
		}
	}
	if len(favs) > 0 {
		es = append(es, entry{id: "hdr:fav", title: "收藏", header: true})
		es = append(es, favs...)
	}
	projectNames := map[string]bool{}
	for _, p := range m.org.Projects {
		if p.Status == "completed" && m.view != "project:"+p.Name {
			continue
		}
		parts := strings.Split(p.Name, ".")
		for i := range parts {
			projectNames[strings.Join(parts[:i+1], ".")] = true
		}
	}
	if len(projectNames) > 0 {
		es = append(es, entry{id: "hdr:projects", title: "我的项目", header: true})
		names := make([]string, 0, len(projectNames))
		for name := range projectNames {
			names = append(names, name)
		}
		sort.Slice(names, func(i, j int) bool {
			// Compare path components so children always follow their parent.
			a, b := strings.Split(names[i], "."), strings.Split(names[j], ".")
			for k := 0; k < min(len(a), len(b)); k++ {
				if a[k] != b[k] {
					return a[k] < b[k]
				}
			}
			return len(a) < len(b)
		})
		for _, name := range names {
			es = append(es, entry{id: "project:" + name, title: name})
		}
	}

	es = append(
		es,
		entry{id: "hdr:tools", title: "工具", header: true},
		entry{id: "projects", title: "▦  项目管理"},
		entry{id: "org", title: "⌕  过滤器 & 标签"},
		entry{id: "data", title: "⇩  数据与恢复"},
	)
	return es
}

func (m *model) moveNavCursor(delta int) {
	es := m.nav()
	if len(es) == 0 {
		m.navCursor = 0
		return
	}
	if m.navCursor < 0 {
		m.navCursor = 0
	}
	if m.navCursor >= len(es) {
		m.navCursor = len(es) - 1
	}
	for next := m.navCursor + delta; next >= 0 && next < len(es); next += delta {
		if !es[next].header {
			m.navCursor = next
			return
		}
	}
}

func (m *model) clampNavCursor() {
	es := m.nav()
	if len(es) == 0 {
		m.navCursor = 0
		return
	}
	if m.navCursor < 0 {
		m.navCursor = 0
	}
	if m.navCursor >= len(es) {
		m.navCursor = len(es) - 1
	}
	if es[m.navCursor].header {
		m.moveNavCursor(1)
		if es[m.navCursor].header {
			m.moveNavCursor(-1)
		}
	}
}

func (m model) title() string {
	switch m.view {
	case "org":
		return "过滤器 & 标签"
	case "data":
		return "数据与恢复"
	case "projects":
		return "项目管理"
	}
	for _, e := range m.nav() {
		if !e.header && e.id == m.view {
			return e.title
		}
	}
	if strings.HasPrefix(m.view, "project:") {
		return strings.TrimPrefix(m.view, "project:")
	}
	if strings.HasPrefix(m.view, "filter:") {
		if f, ok := findFilterByID(
			m.org,
			strings.TrimPrefix(m.view, "filter:"),
		); ok {
			return f.Name
		}
	}
	if strings.HasPrefix(m.view, "tag:") {
		return "标签 · " + strings.TrimPrefix(m.view, "tag:")
	}
	return "筛选结果"
}
func (m model) activeProjects() []Project {
	return m.viewIdx().activeProjects
}
func (m model) visible() []Task {
	return m.viewIdx().visibleTasks(m, time.Now())
}
func (m model) columns() []Column {
	cols := []Column{{ID: "unsectioned", Name: "未分组"}}
	idx := m.viewIdx()
	switch {
	case strings.HasPrefix(m.view, "project:"):
		proj := strings.TrimPrefix(m.view, "project:")
		for _, c := range m.org.Board.Columns {
			if c.Project == proj {
				cols = append(cols, c)
			}
		}
		return cols
	case m.view == "focus":
		for _, c := range m.org.Board.Columns {
			if c.Project == "" {
				cols = append(cols, c)
				continue
			}
			for _, a := range idx.activeProjects {
				if inProject(c.Project, a.Name) {
					cols = append(cols, c)
					break
				}
			}
		}
		return cols
	case isUrgencyFilterView(m.view):
		return []Column{{ID: "unsectioned", Name: "紧迫排行"}}
	default:
		for _, c := range m.org.Board.Columns {
			if c.Project == "" {
				cols = append(cols, c)
			}
		}
		return cols
	}
}
func (m model) columnID(t Task) string {
	return m.viewIdx().columnID(t)
}
func (m model) grouped(ts []Task, col string) []Task {
	items, _, _ := m.viewIdx().groupedTasks(m, ts, col)
	return items
}
func (m model) rows() []row {
	return m.viewIdx().rows(m, time.Now())
}
func (m model) current() row {
	rs := m.rows()
	if m.cursor >= 0 && m.cursor < len(rs) {
		return rs[m.cursor]
	}
	return row{}
}
func (m *model) selectFirstTask() {
	rs := m.rows()
	for i, r := range rs {
		if r.kind == "task" {
			m.cursor = i
			return
		}
	}
	m.cursor = 0
}
func (m *model) rebuildDataRows() {
	var out []row
	out = append(out, row{
		kind:  "group",
		id:    "data:deleted",
		title: "已删除任务恢复",
		count: len(m.dataDeleted),
	})
	if !m.collapsed["data:deleted"] {
		if len(m.dataDeleted) == 0 {
			out = append(out, row{
				kind:     "info",
				id:       "data:empty_deleted",
				title:    "暂无已删除任务",
				subtitle: "已删除的任务会留在这里以便恢复",
			})
		} else {
			out = append(out, m.dataDeleted...)
		}
	}
	out = append(out, row{
		kind:  "group",
		id:    "data:backup",
		title: "备份与恢复",
		count: len(m.dataBackup),
	})
	if !m.collapsed["data:backup"] {
		out = append(out, m.dataBackup...)
	}
	m.extra = out
}

func (m *model) navigate(view string) tea.Cmd {
	if view == "toggle:later" {
		m.laterCollapsed = !m.laterCollapsed
		m.clampNavCursor()
		return nil
	}
	m.view = view
	m.cursor = 0
	m.query = ""
	m.detailScroll = 0
	m.detail = false
	m.navFocus = false
	m.extra = nil
	m.filterLoaded = false
	m.mode = ""
	if view == "data" {
		m.busy = true
		m.dataDeleted = nil
		m.dataBackup = nil
		return tea.Batch(
			m.read("data.recovery", "/api/recovery"),
			m.read("data.points", "/api/backup/points"),
		)
	}
	if view == "time.today" || view == "time.weekly" || view == "time.report" {
		m.syncTimeExtraRows()
		m.busy = true
		return m.loadTimeViewCmd(view)
	}
	if strings.HasPrefix(view, "filter:") {
		if f, ok := findFilterByID(
			m.org,
			strings.TrimPrefix(view, "filter:"),
		); ok {
			m.expression = f.Expression
			m.busy = true
			return m.read(
				"filter",
				"/api/tasks?filter="+url.QueryEscape(f.Expression),
			)
		}
	}
	m.selectFirstTask()
	return nil
}
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.search.Width = max(12, min(68, m.width-16))
		for i := range m.fields {
			if m.fields[i].multiline {
				m.fields[i].area.SetWidth(max(12, min(65, m.width-14)))
			} else {
				m.fields[i].input.Width = max(12, min(65, m.width-14))
			}
		}
		return m, nil
	case tickMsg:
		if msg.gen != m.tickGen {
			return m, nil
		}
		next := m.nextTick()
		if m.ready && !m.busy && !m.blocked && m.mode == "" && !m.navFocus &&
			time.Since(m.lastRefresh) > 30*time.Second {
			m.busy = true
			return m, tea.Batch(next, m.refresh())
		}
		return m, next
	case loaded:
		m.busy = false
		if msg.err != nil {
			m.blocked = true
			m.message = msg.err.Error()
			return m, nil
		}
		wasRunning := m.idx.anyRunning
		id := m.current().id
		m.tasks = msg.tasks
		if msg.org.TimerSnapshot != nil &&
			isSnapshotNewerOrEqual(msg.org.TimerSnapshot, m.timerSnap) {
			m.timerSnap = msg.org.TimerSnapshot
			m.snapReceived = time.Now()
		}
		m.org = msg.org
		if m.timerSnap != nil {
			m.org.TimerSnapshot = m.timerSnap
		}
		m.idx = buildViewIndex(m.tasks, m.org)
		m.ready = true
		m.lastRefresh = time.Now()
		m.blocked = false
		m.message = "已连接 " + m.client.Host
		m.selectFirstTask()
		for i, r := range m.rows() {
			if r.id == id {
				m.cursor = i
				break
			}
		}
		if m.mode == "form" {
			m.message = "已刷新；草稿保留。请关闭后重新打开表单以使用新版本。"
		}
		var tickCmd tea.Cmd
		if m.idx.anyRunning != wasRunning {
			m.tickGen++
			tickCmd = m.nextTick()
		}
		m.clampNavCursor()
		if (strings.HasPrefix(m.view, "filter:") || m.view == "expression") &&
			m.mode == "" {
			if strings.HasPrefix(m.view, "filter:") {
				if f, ok := findFilterByID(
					m.org,
					strings.TrimPrefix(m.view, "filter:"),
				); ok {
					m.expression = f.Expression
				}
			}
			m.busy = true
			return m, tea.Batch(
				tickCmd,
				m.read(
					"filter",
					"/api/tasks?filter="+url.QueryEscape(m.expression),
				),
			)
		}
		return m, tickCmd
	case saved:
		m.busy = false
		if msg.err != nil {
			m.message = msg.err.Error()
			m.undo = nil
			var e *requestError
			if errors.As(msg.err, &e) &&
				(e.uncertain || e.code == 409 || e.code == 423) {
				m.blocked = true
				m.message += " · 请刷新核对，保留草稿"
			}
			return m, nil
		}
		m.mode = ""
		m.fields = nil
		m.previewToken = ""
		m.busy = true
		m.message = msg.message
		if m.view == "data" {
			return m, tea.Batch(
				m.refresh(),
				m.read("data.recovery", "/api/recovery"),
				m.read("data.points", "/api/backup/points"),
			)
		}
		if m.isTimeNavView() {
			return m, tea.Batch(
				m.refresh(),
				m.loadTimeViewCmd(m.view),
			)
		}
		return m, m.refresh()
	case result:
		return m.handleResult(msg)
	case timeDataLoadedMsg:
		return m.handleTimeLoaded(msg)
	case timeMutationMsg:
		return m.handleTimeMutation(msg)
	case tea.MouseMsg:
		if msg.Type == tea.MouseWheelDown {
			m.detailScroll++
		}
		if msg.Type == tea.MouseWheelUp && m.detailScroll > 0 {
			m.detailScroll--
		}
		return m, nil
	case tea.KeyMsg:
		k := msg.String()
		if k == "ctrl+c" {
			return m, tea.Quit
		}
		if m.busy {
			if k == "?" {
				m.help = !m.help
			}
			return m, nil
		}
		if m.help {
			if k == "esc" || k == "?" {
				m.help = false
			}
			return m, nil
		}
		if m.mode != "" {
			return m.overlayKey(msg)
		}
		if k == "?" {
			m.help = true
			return m, nil
		}
		if k == "q" {
			return m, tea.Quit
		}
		if k == "esc" {
			if m.detail {
				m.detail = false
			} else {
				m.navFocus = true
			}
			return m, nil
		}
		if k == "tab" {
			m.navFocus = !m.navFocus
			return m, nil
		}
		if k == "ctrl+r" || k == "r" {
			m.busy = true
			if m.isTimeNavView() {
				return m, tea.Batch(m.refresh(), m.loadTimeViewCmd(m.view))
			}
			return m, m.refresh()
		}
		if k == ":" || k == "ctrl+k" {
			m.openActions()
			return m, nil
		}
		if k == "/" {
			m.mode = "search"
			m.search.SetValue(m.query)
			return m, m.search.Focus()
		}
		if k == "pgdown" {
			m.detailScroll += 5
			return m, nil
		}
		if k == "pgup" {
			m.detailScroll = max(0, m.detailScroll-5)
			return m, nil
		}
		if m.navFocus {
			m.clampNavCursor()
			if k == "up" || k == "k" {
				m.moveNavCursor(-1)
			}
			if k == "down" || k == "j" {
				m.moveNavCursor(1)
			}
			if k == "right" || k == "l" {
				m.navFocus = false
			}
			if k == "enter" || k == " " {
				es := m.nav()
				if m.navCursor >= 0 && m.navCursor < len(es) &&
					!es[m.navCursor].header {
					if k == "enter" || es[m.navCursor].id == "toggle:later" {
						return m, m.navigate(es[m.navCursor].id)
					}
				}
			}
			return m, nil
		}
		if (k == "left" || k == "h") && !m.board {
			m.navFocus = true
			return m, nil
		}
		if k == "b" {
			selected := m.current()
			m.board = !m.board
			if m.board && selected.kind == "task" {
				for i, c := range m.columns() {
					if c.ID == m.columnID(selected.task) {
						m.boardColumn = i
					}
				}
			}
			m.selectFirstTask()
			return m, nil
		}
		if (k == "left" || k == "h" || k == "right" || k == "l") && m.board {
			d := 1
			if k == "left" || k == "h" {
				d = -1
			}
			m.boardColumn = max(0, min(len(m.columns())-1, m.boardColumn+d))
			m.selectFirstTask()
			return m, nil
		}
		if k == "up" || k == "k" {
			m.cursor = max(0, m.cursor-1)
			m.detailScroll = 0
			return m, nil
		}
		if k == "down" || k == "j" {
			m.cursor = min(max(0, len(m.rows())-1), m.cursor+1)
			m.detailScroll = 0
			return m, nil
		}
		if k == "enter" {
			r := m.current()
			switch r.kind {
			case "time.day":
				m.timeState.SelectedDate = r.id
				return m, m.navigate("time.today")
			case "group":
				m.collapsed[r.id] = !m.collapsed[r.id]
				if m.view == "data" {
					m.rebuildDataRows()
				}
			case "project":
				return m, m.navigate("project:" + r.id)
			case "filter", "builtin_filter":
				return m, m.navigate("filter:" + r.id)
			case "tag":
				return m, m.navigate("tag:" + r.item.Name)
			case "backup":
				return m, m.action(r.id)
			case "point":
				return m, m.action("point.export")
			case "deleted":
				return m, m.action("restore")
			case "info":
				return m, nil
			default:
				m.detail = !m.detail
				if m.detail && r.kind == "task" && m.isTimeMode() &&
					!strings.EqualFold(m.timeState.TaskDetailUUID, r.id) {
					m.busy = true
					return m, m.fetchTaskCostDetailCmd(r.id)
				}
			}
			return m, nil
		}
		if k == " " {
			r := m.current()
			if r.kind == "group" && !m.board {
				m.collapsed[r.id] = !m.collapsed[r.id]
				if m.view == "data" {
					m.rebuildDataRows()
				}
				return m, nil
			}
			if r.kind == "task" && len(m.viewIdx().childrenOf[r.id]) > 0 {
				m.expandedSubtasks[r.id] = !m.expandedSubtasks[r.id]
				return m, nil
			}
		}
		if m.isTimeNavView() {
			switch k {
			case "[":
				return m, m.action("time.date.prev")
			case "]":
				return m, m.action("time.date.next")
			case ".":
				return m, m.action("time.date.today")
			case "w":
				if m.view == "time.report" {
					return m, m.action("time.report.granularity")
				}
			case "m":
				if m.view != "time.today" {
					return m, m.action("time.chart.metric")
				}
			case "o":
				if m.view == "time.report" {
					return m, m.action("time.report.sort")
				}
			case "v":
				if m.view == "time.weekly" {
					return m, m.action("time.weekly.group")
				}
				if m.view == "time.report" {
					return m, m.action("time.report.group")
				}
			}
		}
		if k == "c" {
			if m.current().kind == "time.segment" {
				return m, m.action("time.segment.confirm")
			}
			if (m.current().kind == "task" || m.current().kind == "time.report_task") &&
				m.isTimeMode() {
				return m, m.action("task.cost_detail")
			}
		}
		if k == "v" {
			if m.isTimeNavView() {
				if m.view == "time.report" {
					return m, m.action("time.report.group")
				}
			} else if m.view == "org" {
				m.showHiddenBuiltin = !m.showHiddenBuiltin
				m.cursor = min(m.cursor, max(0, len(m.rows())-1))
				return m, nil
			}
		}
		actions := map[string]string{
			"a": "task.new",
			"A": "quick",
			"S": "task.subtask",
			"D": "task.description",
			"e": "edit",
			"x": "task.toggle",
			"s": "task.timer",
			"m": "task.move",
			"!": "task.priority",
			"@": "task.due",
			"d": "delete",
			"u": "undo",
			"p": "focus.choose",
			"n": "project.next",
			"g": "column.new",
			"f": "item.favorite",
			"H": "builtin.hide",
			"T": "time.go.today",
			"B": "task.budget",
			"P": "time.plan.new",
			"$": "task.bill.link",
			",": "time.settings",
		}
		if a, ok := actions[k]; ok {
			return m, m.action(a)
		}
	}
	return m, nil
}
func (m model) handleResult(r result) (tea.Model, tea.Cmd) {
	m.busy = false
	if r.err != nil {
		var e *requestError
		if errors.As(r.err, &e) && e.code == 404 {
			m.message = "此功能需要部署新版 Aster 工作区服务（现有数据保持不变）"
		} else {
			m.message = r.err.Error()
		}
		return m, nil
	}
	switch r.kind {
	case "filter":
		var p struct{ Tasks []Task }
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		if isUrgencyFilterView(m.view) {
			sort.SliceStable(p.Tasks, func(i, j int) bool {
				if p.Tasks[i].Urgency != p.Tasks[j].Urgency {
					return p.Tasks[i].Urgency > p.Tasks[j].Urgency
				}
				return p.Tasks[i].Description < p.Tasks[j].Description
			})
		} else if isCompletedFilterView(m.org, m.view, m.expression) {
			sort.SliceStable(p.Tasks, func(i, j int) bool {
				return p.Tasks[i].End > p.Tasks[j].End
			})
		}
		m.filterLoaded = true
		m.extra = nil
		for _, t := range p.Tasks {
			m.extra = append(
				m.extra,
				row{kind: "task", id: t.UUID, title: t.Description, task: t},
			)
		}
		m.selectFirstTask()
	case "data.recovery":
		var p struct {
			Tasks []struct{ UUID, Description, Project, RestoreStatus string }
		}
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.dataDeleted = nil
		for _, t := range p.Tasks {
			m.dataDeleted = append(
				m.dataDeleted,
				row{
					kind:     "deleted",
					id:       t.UUID,
					title:    t.Description,
					subtitle: t.Project + " · " + t.RestoreStatus,
				},
			)
		}
		m.rebuildDataRows()
	case "data.points":
		var p struct {
			Points []struct{ ID, CreatedAt, State string }
		}
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.dataBackup = []row{
			{
				kind:     "backup",
				id:       "export",
				title:    "导出完整备份",
				subtitle: "保存任务、组织资料及计时历史到本地文件",
			},
			{
				kind:     "backup",
				id:       "import",
				title:    "从文件恢复",
				subtitle: "先预览范围，再明确确认替换",
			},
		}
		for _, pt := range p.Points {
			m.dataBackup = append(
				m.dataBackup,
				row{
					kind:     "point",
					id:       pt.ID,
					title:    pt.CreatedAt,
					subtitle: pt.State,
				},
			)
		}
		m.rebuildDataRows()
	case "quick":
		var p struct {
			Task   map[string]any
			Errors []string
		}
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		if len(p.Errors) > 0 {
			m.message = strings.Join(p.Errors, " · ")
			return m, nil
		}
		m.preview = r.data
		m.selected = row{task: taskFromInput(p.Task)}
		return m, m.openTaskForm("task.new", m.selected.task)
	case "preview":
		var p struct{ Token string }
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.preview = r.data
		m.previewToken = p.Token
		m.mode = "preview"
	case "series":
		var t Task
		if e := json.Unmarshal(r.data, &t); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.selected = row{kind: "task", task: t, id: t.UUID}
		return m, m.openRepeatForm(t)
	}
	m.cursor = min(m.cursor, max(0, len(m.rows())-1))
	return m, nil
}
func taskFromInput(p map[string]any) Task {
	b, _ := json.Marshal(p)
	var t Task
	_ = json.Unmarshal(b, &t)
	return t
}
func (m model) selectedProject() Project {
	r := m.current()
	if r.kind == "project" {
		return r.project
	}
	name := strings.TrimPrefix(m.view, "project:")
	for _, p := range m.org.Projects {
		if p.Name == name {
			return p
		}
		if p.Status == "active" && inProject(r.task.Project, p.Name) {
			return p
		}
	}
	return Project{}
}

func marshal(
	v any,
) json.RawMessage {
	b, _ := json.MarshalIndent(v, "", "  ")
	return b
}
func (m model) orgChange(data map[string]any) tea.Cmd {
	data["revision"] = m.org.Revision
	return m.write("/api/organization", data)
}
func (m model) taskAction(action string, t Task) tea.Cmd {
	return m.write(
		"/api/action",
		map[string]any{"uuid": t.UUID, "action": action},
	)
}
func errRequired(s string) error { return fmt.Errorf("请填写%s", s) }
