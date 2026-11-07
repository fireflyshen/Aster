package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
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
type tick time.Time
type entry struct{ id, title string }
type row struct {
	kind, id, title, subtitle string
	task                      Task
	project                   Project
	item                      SavedItem
	column                    Column
	count                     int
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
	view, query, message                         string
	expression                                   string
	cursor, navCursor, width, height             int
	navFocus, busy, blocked, board, detail, help bool
	detailScroll, boardColumn                    int
	collapsed                                    map[string]bool
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
	return model{client: c, view: "focus", width: 120, height: 32, busy: true, collapsed: map[string]bool{}, draft: map[string][]string{}, search: s, choiceField: -1}
}
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
}
func inProject(name, root string) bool { return name == root || strings.HasPrefix(name, root+".") }
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
func (m model) Init() tea.Cmd {
	return tea.Batch(m.refresh(), tea.Tick(time.Second, func(t time.Time) tea.Msg { return tick(t) }))
}
func (m model) refresh() tea.Cmd {
	return func() tea.Msg {
		o, e := m.client.workspace()
		if e != nil {
			return loaded{err: e}
		}
		ts, e := m.client.tasks()
		return loaded{ts, o, e}
	}
}
func (m model) write(route string, data any) tea.Cmd {
	return func() tea.Msg { return saved{m.client.mutate(route, data), "已保存"} }
}
func (m model) read(kind, route string) tea.Cmd {
	return func() tea.Msg { var b json.RawMessage; e := m.client.read(route, &b); return result{kind, b, e} }
}
func (m model) nav() []entry {
	es := []entry{{"focus", "◎  Focus"}, {"inbox", "▣  收件箱"}, {"today", "◷  今天与逾期"}, {"all", "≡  全部任务"}, {"waiting", "◴  等待中"}, {"completed", "✓  已完成"}, {"later", "◌  Later"}, {"projects", "▦  项目管理"}, {"filters", "⌕  过滤器"}, {"tags", "#  标签"}, {"columns", "▤  分组 / 栏目"}, {"recovery", "↶  删除恢复"}, {"backup", "⇩  备份与恢复"}}
	for _, p := range m.org.Projects {
		es = append(es, entry{"project:" + p.Name, strings.Repeat("  ", min(strings.Count(p.Name, "."), 3)) + "· " + p.Name})
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
	var out []Project
	for _, p := range m.org.Projects {
		if p.Status == "active" {
			out = append(out, p)
		}
	}
	return out
}
func (m model) visible() []Task {
	var out []Task
	for _, t := range m.tasks {
		match := false
		unfinished := t.Status == "pending" || t.Status == "waiting"
		switch {
		case m.view == "focus":
			for _, p := range m.activeProjects() {
				if inProject(t.Project, p.Name) && unfinished {
					match = true
				}
			}
		case m.view == "inbox":
			match = unfinished && t.Project == ""
		case m.view == "today":
			now := time.Now()
			y, mo, d := now.Date()
			end := time.Date(y, mo, d+1, 0, 0, 0, 0, now.Location())
			match = unfinished && !date(t.Due).IsZero() && date(t.Due).Before(end) && !date(t.Wait).After(now)
		case m.view == "waiting":
			match = t.Status == "waiting" || unfinished && date(t.Wait).After(time.Now())
		case m.view == "completed":
			match = t.Status == "completed"
		case strings.HasPrefix(m.view, "project:"):
			match = inProject(t.Project, strings.TrimPrefix(m.view, "project:"))
		case strings.HasPrefix(m.view, "tag:"):
			for _, tag := range t.Tags {
				if tag == strings.TrimPrefix(m.view, "tag:") {
					match = true
				}
			}
		case m.view == "all":
			match = unfinished || t.Status == "completed"
		}
		if match && strings.Contains(strings.ToLower(t.Description+" "+t.Project+" "+strings.Join(t.Tags, " ")), strings.ToLower(m.query)) {
			out = append(out, t)
		}
	}
	if strings.HasPrefix(m.view, "filter:") || m.view == "expression" {
		out = nil
		for _, r := range m.extra {
			if strings.Contains(strings.ToLower(r.task.Description+" "+r.task.Project), strings.ToLower(m.query)) {
				out = append(out, r.task)
			}
		}
	}
	return out
}
func (m model) columns() []Column {
	return append([]Column{{"unsectioned", "未分组"}}, m.org.Board.Columns...)
}
func (m model) columnID(t Task) string {
	for _, id := range []string{t.UUID, t.Parent} {
		if id == "" {
			continue
		}
		for _, p := range m.org.Board.Placements {
			if p.UUID == id {
				for _, c := range m.org.Board.Columns {
					if c.ID == p.ColumnID {
						return c.ID
					}
				}
			}
		}
	}
	return "unsectioned"
}
func (m model) grouped(ts []Task, col string) []Task {
	var out []Task
	for _, t := range ts {
		if m.columnID(t) == col {
			out = append(out, t)
		}
	}
	order := map[string]int{}
	for i, id := range m.org.Board.Order {
		order[id] = i
	}
	rank := func(t Task) int {
		if v, ok := order[t.UUID]; ok {
			return v
		}
		if v, ok := order[t.Parent]; ok {
			return v
		}
		return len(order) + 1
	}
	sort.SliceStable(out, func(i, j int) bool {
		if rank(out[i]) != rank(out[j]) {
			return rank(out[i]) < rank(out[j])
		}
		if m.view == "completed" {
			return out[i].End > out[j].End
		}
		return out[i].Description < out[j].Description
	})
	return out
}
func (m model) rows() []row {
	var out []row
	switch m.view {
	case "projects", "later":
		for _, p := range m.org.Projects {
			if m.view == "later" {
				covered := false
				for _, a := range m.activeProjects() {
					if inProject(p.Name, a.Name) {
						covered = true
					}
				}
				if covered {
					continue
				}
			}
			if strings.Contains(strings.ToLower(p.Name+" "+p.Description), strings.ToLower(m.query)) {
				status := p.Status
				if status == "" {
					status = "later"
				}
				out = append(out, row{kind: "project", id: p.Name, title: p.Name, subtitle: status + " · " + p.Outcome, project: p})
			}
		}
		return out
	case "filters", "tags":
		items := m.org.Filters
		kind := "filter"
		if m.view == "tags" {
			items = m.org.Tags
			kind = "tag"
		}
		for _, i := range items {
			if strings.Contains(strings.ToLower(i.Name+" "+i.Expression), strings.ToLower(m.query)) {
				star := ""
				if i.Favorite {
					star = "★ "
				}
				out = append(out, row{kind: kind, id: i.ID, title: star + i.Name, subtitle: i.Expression, item: i})
			}
		}
		return out
	case "columns":
		for _, c := range m.org.Board.Columns {
			out = append(out, row{kind: "column", id: c.ID, title: c.Name, subtitle: "列表分组 ↔ 看板栏目", column: c})
		}
		return out
	case "recovery", "backup":
		return m.extra
	}
	ts := m.visible()
	cols := m.columns()
	if m.board {
		at := min(m.boardColumn, len(cols)-1)
		cols = cols[at : at+1]
	}
	for _, c := range cols {
		items := m.grouped(ts, c.ID)
		out = append(out, row{kind: "group", id: c.ID, title: c.Name, count: len(items), column: c})
		if m.collapsed[c.ID] && !m.board {
			continue
		}
		for _, t := range items {
			out = append(out, row{kind: "task", id: t.UUID, title: t.Description, subtitle: t.Project, task: t})
		}
	}
	return out
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
				return m.read("filter", "/api/tasks?filter="+url.QueryEscape(f.Expression))
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
	case tick:
		nextTick := tea.Tick(time.Second, func(t time.Time) tea.Msg { return tick(t) })
		if m.ready && !m.busy && !m.blocked && m.mode == "" && !m.navFocus && time.Since(m.lastRefresh) > 30*time.Second {
			m.busy = true
			return m, tea.Batch(nextTick, m.refresh())
		}
		return m, nextTick
	case loaded:
		m.busy = false
		if msg.err != nil {
			m.blocked = true
			m.message = msg.err.Error()
			return m, nil
		}
		id := m.current().id
		m.tasks = msg.tasks
		m.org = msg.org
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
		if (strings.HasPrefix(m.view, "filter:") || m.view == "expression") && m.mode == "" {
			if strings.HasPrefix(m.view, "filter:") {
				for _, f := range m.org.Filters {
					if "filter:"+f.ID == m.view {
						m.expression = f.Expression
					}
				}
			}
			m.busy = true
			return m, m.read("filter", "/api/tasks?filter="+url.QueryEscape(m.expression))
		}
		return m, nil
	case saved:
		m.busy = false
		if msg.err != nil {
			m.message = msg.err.Error()
			m.undo = nil
			var e *requestError
			if errors.As(msg.err, &e) && (e.uncertain || e.code == 409 || e.code == 423) {
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
			return m, tea.Batch(m.refresh(), m.read("recovery", "/api/recovery"))
		}
		if m.view == "backup" {
			return m, tea.Batch(m.refresh(), m.read("points", "/api/backup/points"))
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
			if k == "enter" {
				return m, m.navigate(m.nav()[m.navCursor].id)
			}
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
		if k == " " && m.current().kind == "group" {
			m.collapsed[m.current().id] = !m.collapsed[m.current().id]
			return m, nil
		}
		actions := map[string]string{"a": "task.new", "A": "quick", "e": "edit", "x": "task.toggle", "s": "task.timer", "m": "task.move", "d": "delete", "u": "undo", "p": "focus.choose", "n": "project.next", "g": "column.new"}
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
			m.extra = append(m.extra, row{kind: "task", id: t.UUID, title: t.Description, task: t})
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
			m.extra = append(m.extra, row{kind: "deleted", id: t.UUID, title: t.Description, subtitle: t.Project + " · " + t.RestoreStatus})
		}
	case "points":
		var p struct {
			Points []struct{ ID, CreatedAt, State string }
		}
		if e := json.Unmarshal(r.data, &p); e != nil {
			m.message = e.Error()
			return m, nil
		}
		m.extra = []row{{kind: "backup", id: "export", title: "导出完整备份", subtitle: "保存任务、组织资料及计时历史到本地文件"}, {kind: "backup", id: "import", title: "从文件恢复", subtitle: "先预览范围，再明确确认替换"}}
		for _, p := range p.Points {
			m.extra = append(m.extra, row{kind: "point", id: p.ID, title: p.CreatedAt, subtitle: p.State})
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
func marshal(v any) json.RawMessage { b, _ := json.MarshalIndent(v, "", "  "); return b }
func (m model) orgChange(data map[string]any) tea.Cmd {
	data["revision"] = m.org.Revision
	return m.write("/api/organization", data)
}
func (m model) taskAction(action string, t Task) tea.Cmd {
	return m.write("/api/action", map[string]any{"uuid": t.UUID, "action": action})
}
func errRequired(s string) error { return fmt.Errorf("请填写%s", s) }
