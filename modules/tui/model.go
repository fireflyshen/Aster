package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
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
type entry struct{ id, title string }
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
	client                                       Client
	tasks                                        []Task
	org                                          Organization
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
	preview                                      json.RawMessage
	previewToken                                 string
	undo                                         *undoChange
	ready                                        bool
}

func newModel(c Client) model {
	s := textinput.New()
	s.Placeholder = "输入关键词…"
	s.Width = 64
	return model{
		client:           c,
		view:             "focus",
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
func (m model) tickInterval() time.Duration {
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
		{"focus", "◎  Focus"},
		{"inbox", "▣  收件箱"},
		{"today", "◷  今天与逾期"},
		{"urgency", "◈  紧迫排行"},
		{"active", "▶  进行中"},
		{"all", "≡  全部任务"},
		{"waiting", "◴  等待中"},
		{"completed", "✓  已完成"},
		{"later", "◌  Later"},
		{"projects", "▦  项目管理"},
		{"filters", "⌕  过滤器"},
		{"tags", "#  标签"},
		{"columns", "▤  分组 / 栏目"},
		{"recovery", "↶  删除恢复"},
		{"backup", "⇩  备份与恢复"},
	}
	for _, p := range m.org.Projects {
		es = append(
			es,
			entry{
				"project:" + p.Name,
				strings.Repeat(
					"  ",
					min(strings.Count(p.Name, "."), 3),
				) + "· " + p.Name,
			},
		)
	}
	for _, f := range m.org.Filters {
		if f.Favorite {
			es = append(es, entry{"filter:" + f.ID, "⌕ " + f.Name})
		}
	}
	return es
}
func (m model) title() string {
	for _, e := range m.nav() {
		if e.id == m.view {
			return e.title
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
	case m.view == "columns":
		return append(cols, m.org.Board.Columns...)
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
	case m.view == "urgency":
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
func (m *model) navigate(view string) tea.Cmd {
	m.view = view
	m.cursor = 0
	m.query = ""
	m.detailScroll = 0
	m.detail = false
	m.navFocus = false
	m.extra = nil
	m.mode = ""
	if view == "recovery" {
		m.busy = true
		return m.read("recovery", "/api/recovery")
	}
	if view == "backup" {
		m.busy = true
		return m.read("points", "/api/backup/points")
	}
	if strings.HasPrefix(view, "filter:") {
		for _, f := range m.org.Filters {
			if f.ID == strings.TrimPrefix(view, "filter:") {
				m.expression = f.Expression
				m.busy = true
				return m.read(
					"filter",
					"/api/tasks?filter="+url.QueryEscape(f.Expression),
				)
			}
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
		m.org = msg.org
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
		if (strings.HasPrefix(m.view, "filter:") || m.view == "expression") &&
			m.mode == "" {
			if strings.HasPrefix(m.view, "filter:") {
				for _, f := range m.org.Filters {
					if "filter:"+f.ID == m.view {
						m.expression = f.Expression
					}
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
		if m.view == "recovery" {
			return m, tea.Batch(
				m.refresh(),
				m.read("recovery", "/api/recovery"),
			)
		}
		if m.view == "backup" {
			return m, tea.Batch(
				m.refresh(),
				m.read("points", "/api/backup/points"),
			)
		}
		return m, m.refresh()
	case result:
		return m.handleResult(msg)
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
			if k == "up" || k == "k" {
				m.navCursor = max(0, m.navCursor-1)
			}
			if k == "down" || k == "j" {
				m.navCursor = min(len(m.nav())-1, m.navCursor+1)
			}
			if k == "right" || k == "l" {
				m.navFocus = false
			}
			if k == "enter" {
				return m, m.navigate(m.nav()[m.navCursor].id)
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
			case "group":
				m.collapsed[r.id] = !m.collapsed[r.id]
			case "project":
				return m, m.navigate("project:" + r.id)
			case "filter":
				return m, m.navigate("filter:" + r.id)
			case "tag":
				return m, m.navigate("tag:" + r.item.Name)
			case "backup":
				return m, m.action(r.id)
			case "point":
				return m, m.action("point.export")
			case "deleted":
				return m, m.action("restore")
			default:
				m.detail = !m.detail
			}
			return m, nil
		}
		if k == " " {
			r := m.current()
			if r.kind == "group" && !m.board {
				m.collapsed[r.id] = !m.collapsed[r.id]
				return m, nil
			}
			if r.kind == "task" && len(m.viewIdx().childrenOf[r.id]) > 0 {
				m.expandedSubtasks[r.id] = !m.expandedSubtasks[r.id]
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
		m.extra = nil
		for _, t := range p.Tasks {
			m.extra = append(
				m.extra,
				row{kind: "task", id: t.UUID, title: t.Description, task: t},
			)
		}
		m.selectFirstTask()
	case "recovery":
		var p struct {
			Tasks []struct{ UUID, Description, Project, RestoreStatus string }
		}
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.extra = nil
		for _, t := range p.Tasks {
			m.extra = append(
				m.extra,
				row{
					kind:     "deleted",
					id:       t.UUID,
					title:    t.Description,
					subtitle: t.Project + " · " + t.RestoreStatus,
				},
			)
		}
	case "points":
		var p struct {
			Points []struct{ ID, CreatedAt, State string }
		}
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.extra = []row{
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
		for _, p := range p.Points {
			m.extra = append(
				m.extra,
				row{
					kind:     "point",
					id:       p.ID,
					title:    p.CreatedAt,
					subtitle: p.State,
				},
			)
		}
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
