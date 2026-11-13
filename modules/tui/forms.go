package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

type field struct {
	label, hint      string
	input            textinput.Model
	area             textarea.Model
	multiline, multi bool
	options          []choice
}

func textField(label, value, hint string) field {
	t := textinput.New()
	t.SetValue(value)
	t.CharLimit = 8000
	return field{label: label, hint: hint, input: t}
}
func areaField(label, value, hint string) field {
	a := textarea.New()
	a.SetValue(value)
	a.SetHeight(3)
	a.CharLimit = 8000
	a.ShowLineNumbers = false
	return field{label: label, hint: hint, area: a, multiline: true}
}
func selectField(label, value string, options []choice) field {
	f := textField(label, value, "Enter 打开选择器")
	f.options = options
	return f
}
func (f field) value() string {
	if f.multiline {
		return f.area.Value()
	}
	return strings.TrimSpace(f.input.Value())
}
func (f *field) set(s string) {
	if f.multiline {
		f.area.SetValue(s)
	} else {
		f.input.SetValue(s)
	}
}
func (f field) display() string {
	if f.multi {
		return f.value()
	}
	for _, o := range f.options {
		if o.value == f.value() {
			return o.label
		}
	}
	return f.value()
}
func (f *field) focus() tea.Cmd {
	if f.multiline {
		return f.area.Focus()
	}
	return f.input.Focus()
}
func (f *field) blur() { f.input.Blur(); f.area.Blur() }
func (m *model) openForm(kind, title, hint string, fields ...field) tea.Cmd {
	m.formRevision = m.org.Revision
	m.formKind = kind
	m.formTitle = title
	m.formHint = hint
	m.fields = fields
	m.field = 0
	m.mode = "form"
	key := kind + ":" + m.selected.id
	if values, ok := m.draft[key]; ok && len(values) == len(fields) {
		for i, v := range values {
			m.fields[i].set(v)
		}
	}
	for i := range m.fields {
		m.fields[i].input.Width = max(15, min(65, m.width-14))
		if m.fields[i].multiline {
			m.fields[i].area.SetWidth(max(15, min(65, m.width-14)))
		}
	}
	if len(fields) > 0 {
		return m.fields[0].focus()
	}
	return nil
}
func (m *model) stash() {
	vs := []string{}
	for _, f := range m.fields {
		vs = append(vs, f.value())
	}
	m.draft[m.formKind+":"+m.selected.id] = vs
}
func (m *model) choose(options []choice, field int) {
	m.options = options
	m.optionCursor = 0
	m.choiceField = field
	m.search.SetValue("")
	m.search.Width = max(12, min(68, m.width-16))
	m.search.Focus()
	m.mode = "choice"
}
func (m model) matches() []choice {
	var out []choice
	q := strings.ToLower(m.search.Value())
	for _, o := range m.options {
		if strings.Contains(strings.ToLower(o.label+" "+o.hint), q) {
			out = append(out, o)
		}
	}
	return out
}
func (m model) overlayKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	k := msg.String()
	if m.mode == "search" {
		if k == "esc" {
			m.mode = ""
			return m, nil
		}
		if k == "enter" {
			m.query = m.search.Value()
			m.mode = ""
			m.selectFirstTask()
			return m, nil
		}
		var cmd tea.Cmd
		m.search, cmd = m.search.Update(msg)
		return m, cmd
	}
	if m.mode == "preview" {
		if k == "esc" {
			m.mode = ""
			return m, nil
		}
		if k == "enter" && !m.blocked {
			return m, m.openForm(
				"restore.confirm",
				"确认替换工作区",
				"当前任务、组织资料与计时将被替换，恢复前副本由服务器保留。",
				textField("输入 RESTORE 确认", "", "先确认预览中的范围与警告"),
			)
		}
		return m, nil
	}
	if m.mode == "choice" {
		if k == "esc" {
			if m.choiceField >= 0 {
				m.mode = "form"
			} else {
				m.mode = ""
			}
			return m, nil
		}
		options := m.matches()
		if k == "up" || k == "ctrl+p" {
			m.optionCursor = max(0, m.optionCursor-1)
			return m, nil
		}
		if k == "down" || k == "ctrl+n" {
			m.optionCursor = min(max(0, len(options)-1), m.optionCursor+1)
			return m, nil
		}
		if k == "enter" && len(options) > 0 {
			o := options[min(m.optionCursor, len(options)-1)]
			if m.choiceField >= 0 {
				f := &m.fields[m.choiceField]
				if f.multi {
					values := splitTags(f.value())
					at := -1
					for i, v := range values {
						if v == o.value {
							at = i
						}
					}
					if at < 0 {
						values = append(values, o.value)
					} else {
						values = append(values[:at], values[at+1:]...)
					}
					f.set(strings.Join(values, ", "))
					return m, nil
				}
				f.set(o.value)
				m.mode = "form"
				if m.formKind == "task.move" && m.choiceField == 0 {
					m.fields[1].options = m.positionChoices(o.value)
					m.fields[1].set("")
				}
				return m, f.focus()
			}
			m.mode = ""
			return m, m.action(o.value)
		}
		var cmd tea.Cmd
		m.search, cmd = m.search.Update(msg)
		m.optionCursor = 0
		return m, cmd
	}
	if m.mode == "form" {
		if k == "esc" {
			m.stash()
			m.mode = ""
			m.message = "草稿已保留在本次会话"
			return m, nil
		}
		if k == "ctrl+r" {
			m.stash()
			m.busy = true
			return m, m.refresh()
		}
		if k == "ctrl+s" {
			if m.blocked {
				m.message = "写入已锁定。关闭表单，刷新核对后重新打开。"
				return m, nil
			}
			cmd, err := m.submit()
			if err != nil {
				m.message = err.Error()
				return m, nil
			}
			if cmd != nil {
				m.busy = true
				delete(m.draft, m.formKind+":"+m.selected.id)
			}
			return m, cmd
		}
		if k == "tab" || k == "shift+tab" {
			m.fields[m.field].blur()
			d := 1
			if k == "shift+tab" {
				d = -1
			}
			m.field = (m.field + d + len(m.fields)) % len(m.fields)
			return m, m.fields[m.field].focus()
		}
		f := &m.fields[m.field]
		if (k == "enter" || k == "ctrl+space") && len(f.options) > 0 {
			m.choose(f.options, m.field)
			return m, nil
		}
		var cmd tea.Cmd
		if f.multiline {
			f.area, cmd = f.area.Update(msg)
		} else {
			f.input, cmd = f.input.Update(msg)
		}
		return m, cmd
	}
	return m, nil
}
func splitTags(s string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range strings.Split(s, ",") {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			out = append(out, t)
			seen[t] = true
		}
	}
	return out
}
func colors() []choice {
	var out []choice
	for _, c := range []string{"gray", "berry", "red", "orange", "yellow", "olive", "lime", "green", "mint", "teal", "blue", "purple"} {
		out = append(out, choice{c, c, ""})
	}
	return out
}
func yesNo() []choice { return []choice{{"false", "否", ""}, {"true", "是", ""}} }
func (m model) projectChoices() []choice {
	out := []choice{{"", "无项目 / 收件箱", ""}}
	for _, p := range m.org.Projects {
		out = append(out, choice{p.Name, p.Name, p.Outcome})
	}
	return out
}
func (m model) taskChoices(p Project) []choice {
	out := []choice{{"", "暂不指定", ""}}
	for _, t := range m.tasks {
		if inProject(t.Project, p.Name) &&
			(t.Status == "pending" || t.Status == "waiting") {
			out = append(out, choice{t.UUID, t.Description, t.Project})
		}
	}
	return out
}
func (m model) positionChoices(column string) []choice {
	out := []choice{{"", "放到末尾", ""}}
	for _, t := range m.grouped(m.visible(), column) {
		if t.UUID != m.selected.task.UUID {
			out = append(
				out,
				choice{t.UUID, "放在前面：" + t.Description, t.Project},
			)
		}
	}
	return out
}
func (m *model) openTaskForm(kind string, t Task) tea.Cmd {
	tags := selectField("标签（逗号分隔；Enter 多选）", strings.Join(t.Tags, ", "), nil)
	tags.multi = true
	for _, tag := range m.org.Tags {
		tags.options = append(tags.options, choice{tag.Name, tag.Name, ""})
	}
	title := "任务详情"
	if kind == "task.subtask" && m.selected.title != "" {
		title = "添加子任务 · " + m.selected.title
	}
	desc := ""
	if kind == "task.edit" && t.UUID != "" {
		desc = m.org.Descriptions[t.UUID]
	}
	return m.openForm(
		kind,
		title,
		"Ctrl+S 保存；Tab 切换；日期使用本机时区。未修改日期保留原时间。",
		textField("任务名称", t.Description, "必填"),
		selectField("项目", t.Project, m.projectChoices()),
		textField(
			"截止日期",
			shownDate(t.Due),
			"YYYY-MM-DD HH:MM；也支持今天、明天、YYYY-MM-DD",
		),
		selectField(
			"优先级",
			t.Priority,
			[]choice{
				{"", "无", ""},
				{"H", "高 / p1", ""},
				{"M", "中 / p2", ""},
				{"L", "低 / p3", ""},
			},
		),
		tags,
		selectField(
			"重复规则",
			t.Recur,
			[]choice{
				{"", "不重复", ""},
				{"daily", "每天", ""},
				{"weekly", "每周", ""},
				{"monthly", "每月", ""},
				{"yearly", "每年", ""},
			},
		),
		textField(
			"重复截止",
			shownDate(t.Until),
			"留空表示持续重复；也可输入自定义 Taskwarrior 规则",
		),
		areaField("追加备注", "", "已有备注保留，可在操作菜单中移除"),
		areaField("任务描述", desc, "可选多行说明（与 Taskwarrior 备注独立同步）"),
	)
}
func (m *model) openRepeatForm(t Task) tea.Cmd {
	return m.openForm(
		"repeat",
		"重复系列",
		"修改规则，或停止生成新任务。已有任务保留，停止的系列可在删除恢复中恢复。",
		textField("重复规则", t.Recur, "daily / weekly / monthly / 2weeks"),
		textField("重复截止", shownDate(t.Until), "留空为持续重复"),
		selectField(
			"操作",
			"update",
			[]choice{{"update", "保存规则", ""}, {"stop", "停止系列", "保留已有任务"}},
		),
		textField("停止时输入 STOP 确认", "", "保存规则时不需要填写"),
	)
}
func (m *model) openProjectForm(p Project) tea.Cmd {
	return m.openForm(
		"project.edit",
		"项目资料",
		"名称使用点路径表示层级。修改名称会迁移整个分支，任务状态保持。",
		textField("项目名称", p.Name, "如 工作.Aster"),
		areaField("描述", p.Description, "支持多行"),
		selectField("颜色", p.Color, colors()),
		areaField("完成目标", p.Outcome, "聚焦项目必须填写具体结果"),
		selectField("下一步任务", p.NextTask, m.taskChoices(p)),
	)
}
func (m *model) openStatus(p Project, status string) tea.Cmd {
	if status == "" {
		status = "later"
	}
	replace := []choice{{"", "不替换", ""}}
	for _, a := range m.activeProjects() {
		if a.Name != p.Name {
			replace = append(replace, choice{a.Name, a.Name, a.Outcome})
		}
	}
	chosen := ""
	for _, a := range m.activeProjects() {
		if a.Name != p.Name &&
			(inProject(a.Name, p.Name) || inProject(p.Name, a.Name)) {
			chosen = a.Name
		}
	}
	return m.openForm(
		"project.status",
		"Focus / 项目状态",
		fmt.Sprintf(
			"%s · %d / 3 聚焦项目；完成项目只改变组织状态，不完成任务。",
			p.Name,
			len(m.activeProjects()),
		),
		selectField(
			"状态",
			status,
			[]choice{
				{"active", "聚焦 / Active", ""},
				{"later", "暂缓 / Later", ""},
				{"completed", "项目已完成", ""},
			},
		),
		areaField("完成目标", p.Outcome, "激活时必填"),
		selectField("暂停哪个项目以替换", chosen, replace),
		selectField("完成时保留未完成任务", "false", yesNo()),
	)
}
func inputDate(s, original string) (string, error) {
	if s == "" {
		return "", nil
	}
	if shownDate(original) == s {
		return compact(original), nil
	}
	now := time.Now()
	switch strings.ToLower(s) {
	case "today", "今天":
		s = now.Format("2006-01-02")
	case "tomorrow", "明天":
		s = now.AddDate(0, 0, 1).Format("2006-01-02")
	}
	for _, format := range []string{"2006-01-02 15:04", "2006-01-02"} {
		if t, e := time.ParseInLocation(format, s, time.Local); e == nil {
			return t.UTC().Format("20060102T150405Z"), nil
		}
	}
	if t := date(s); !t.IsZero() {
		return compact(s), nil
	}
	return "", fmt.Errorf("日期格式：YYYY-MM-DD HH:MM（本机时区）")
}
func (m *model) openItemForm(kind string, i SavedItem) tea.Cmd {
	fs := []field{
		textField("名称", i.Name, "必填"),
		selectField("颜色", i.Color, colors()),
		selectField("收藏", fmt.Sprint(i.Favorite), yesNo()),
	}
	if kind == "filter" {
		fs = append(
			fs,
			textField("过滤表达式", i.Expression, "status:pending +READY"),
			areaField("描述", i.Description, "可选"),
		)
	}
	return m.openForm(kind+".edit", "编辑 "+kind, "所有客户端共享，修改带版本校验。", fs...)
}
func (m model) taskInput(values []string) (map[string]any, error) {
	if strings.TrimSpace(values[0]) == "" {
		return nil, errRequired("任务名称")
	}
	due, e := inputDate(values[2], m.selected.task.Due)
	if e != nil {
		return nil, e
	}
	until, e := inputDate(values[6], m.selected.task.Until)
	if e != nil {
		return nil, e
	}
	priority := values[3]
	if priority != "" && priority != "H" && priority != "M" && priority != "L" {
		return nil, fmt.Errorf("优先级请选择高、中、低或无")
	}
	p := map[string]any{
		"description": strings.TrimSpace(values[0]),
		"project":     values[1],
		"due":         due,
		"priority":    priority,
		"tags":        splitTags(values[4]),
		"recur":       values[5],
		"until":       until,
	}
	if m.formKind == "task.edit" && m.selected.task.Parent != "" {
		if values[5] != m.selected.task.Recur ||
			values[6] != shownDate(m.selected.task.Until) {
			return nil, fmt.Errorf("此任务属于重复系列，请从操作菜单使用编辑重复系列")
		}
		delete(p, "recur")
		delete(p, "until")
	}
	if values[7] != "" {
		p["note"] = values[7]
	}
	return p, nil
}
func (m *model) submit() (tea.Cmd, error) {
	v := []string{}
	for _, f := range m.fields {
		v = append(v, f.value())
	}
	r := m.selected
	org := func(d map[string]any) tea.Cmd { d["revision"] = m.formRevision; return m.write("/api/organization", d) }
	action := func(a string, fields map[string]any) tea.Cmd {
		fields["uuid"] = r.task.UUID
		fields["action"] = a
		return m.write("/api/action", fields)
	}
	switch m.formKind {
	case "task.new", "task.subtask", "task.edit":
		p, e := m.taskInput(v)
		if e != nil {
			return nil, e
		}
		desc := ""
		if len(v) > 8 {
			desc = strings.TrimSpace(v[8])
		}
		if m.formKind == "task.new" || m.formKind == "task.subtask" {
			if m.formKind == "task.subtask" && r.id != "" {
				p["parentUuid"] = r.id
			}
			if desc != "" {
				p["taskDescription"] = desc
			}
			return m.write("/api/tasks", p), nil
		}
		oldDesc := strings.TrimSpace(m.org.Descriptions[r.id])
		if desc == oldDesc {
			return action("edit", map[string]any{"task": p}), nil
		}
		editPayload := map[string]any{
			"uuid":   r.task.UUID,
			"action": "edit",
			"task":   p,
		}
		descAction := "set"
		if desc == "" {
			descAction = "delete"
		}
		descPayload := map[string]any{
			"revision":    m.formRevision,
			"kind":        "description",
			"action":      descAction,
			"uuid":        r.task.UUID,
			"description": desc,
		}
		return func() tea.Msg {
			if err := m.client.mutate("/api/action", editPayload); err != nil {
				return saved{err: err}
			}
			if err := m.client.mutate("/api/organization", descPayload); err != nil {
				return saved{err: err}
			}
			return saved{message: "已保存任务与描述"}
		}, nil
	case "task.description":
		desc := strings.TrimSpace(v[0])
		descAction := "set"
		if desc == "" {
			descAction = "delete"
		}
		return org(map[string]any{
			"kind":        "description",
			"action":      descAction,
			"uuid":        r.id,
			"description": desc,
		}), nil
	case "task.due.custom":
		d, e := inputDate(v[0], r.task.Due)
		if e != nil {
			return nil, e
		}
		prev := taskBaseMap(r.task)
		next := taskBaseMap(r.task)
		next["due"] = d
		m.undo = &undoChange{
			"/api/action",
			map[string]any{"uuid": r.id, "action": "edit", "task": prev},
			r.title,
		}
		return action("edit", map[string]any{"task": next}), nil
	case "quick":
		if v[0] == "" {
			return nil, errRequired("表达式")
		}
		return func() tea.Msg {
			var b json.RawMessage
			e := m.client.request(
				"/api/quick/preview",
				map[string]any{"text": v[0]},
				&b,
			)
			return result{"quick", b, e}
		}, nil
	case "expression":
		m.expression = v[0]
		m.view = "expression"
		m.query = ""
		return m.read("filter", "/api/tasks?filter="+url.QueryEscape(v[0])), nil
	case "task.wait":
		d, e := inputDate(v[0], r.task.Wait)
		if e != nil {
			return nil, e
		}
		m.undo = &undoChange{
			"/api/action",
			map[string]any{
				"uuid":   r.id,
				"action": "wait",
				"wait":   compact(r.task.Wait),
			},
			r.title,
		}
		return action("wait", map[string]any{"wait": d}), nil
	case "task.move":
		if v[0] == "" {
			return nil, errRequired("目标栏目")
		}
		var before any
		if v[1] != "" {
			before = v[1]
		}
		oldCol := m.columnID(r.task)
		old := m.grouped(m.tasks, oldCol)
		var oldBefore any
		for i, t := range old {
			if t.UUID == r.id && i+1 < len(old) {
				oldBefore = old[i+1].UUID
			}
		}
		m.undo = &undoChange{
			"/api/organization",
			map[string]any{
				"kind":       "board",
				"action":     "task.move",
				"uuid":       r.id,
				"columnId":   oldCol,
				"beforeUuid": oldBefore,
			},
			r.title,
		}
		return org(
			map[string]any{
				"kind":       "board",
				"action":     "task.move",
				"uuid":       r.id,
				"columnId":   v[0],
				"beforeUuid": before,
			},
		), nil
	case "column.new", "column.edit":
		if v[0] == "" {
			return nil, errRequired("分组名称")
		}
		return org(
			map[string]any{
				"kind":   "board",
				"action": "column.save",
				"column": map[string]string{"id": r.id, "name": v[0]},
			},
		), nil
	case "project.edit":
		if v[0] == "" {
			return nil, errRequired("项目名称")
		}
		item := map[string]any{
			"name":        v[0],
			"description": v[1],
			"color":       v[2],
			"outcome":     v[3],
			"nextTask":    v[4],
		}
		if v[2] == "" {
			delete(item, "color")
		}
		d := map[string]any{"kind": "project", "action": "save", "item": item}
		if r.project.Name != "" {
			d["originalName"] = r.project.Name
		}
		return org(d), nil
	case "project.next":
		p := r.project
		return org(
			map[string]any{
				"kind":   "project",
				"action": "save",
				"item": map[string]any{
					"name":        p.Name,
					"description": p.Description,
					"nextTask":    v[0],
				},
			},
		), nil
	case "project.status":
		if v[0] == "active" && v[1] == "" {
			return nil, errRequired("完成目标")
		}
		if v[0] == "completed" && v[3] != "true" {
			unfinished := 0
			for _, t := range m.tasks {
				if inProject(t.Project, r.project.Name) &&
					(t.Status == "pending" || t.Status == "waiting") {
					unfinished++
				}
			}
			if unfinished > 0 {
				return nil, fmt.Errorf("请确认保留 %d 条未完成任务", unfinished)
			}
		}
		d := map[string]any{
			"kind":   "project",
			"action": "status",
			"name":   r.project.Name,
			"status": v[0],
		}
		if v[0] == "active" {
			d["outcome"] = v[1]
			if v[2] != "" {
				d["replaceProject"] = v[2]
			}
		}
		if v[0] == "completed" {
			d["remaining"] = "keep"
		}
		return org(d), nil
	case "filter.edit", "tag.edit":
		if v[0] == "" {
			return nil, errRequired("名称")
		}
		kind := strings.TrimSuffix(m.formKind, ".edit")
		id := r.item.ID
		item := map[string]any{
			"id":       id,
			"name":     v[0],
			"color":    v[1],
			"favorite": v[2] == "true",
		}
		if v[1] == "" {
			item["color"] = "gray"
		}
		if kind == "filter" {
			item["expression"] = v[3]
			item["description"] = v[4]
		}
		return org(
			map[string]any{"kind": kind, "action": "save", "item": item},
		), nil
	case "note.add":
		if v[0] == "" {
			return nil, errRequired("备注")
		}
		p := taskBaseMap(r.task)
		p["note"] = v[0]
		return action("edit", map[string]any{"task": p}), nil
	case "note.remove":
		var index int
		if _, e := fmt.Sscan(
			v[0],
			&index,
		); e != nil || index < 0 ||
			index >= len(r.task.Annotations) {
			return nil, errRequired("要移除的备注")
		}
		n := r.task.Annotations[index]
		return action(
			"note.remove",
			map[string]any{"entry": n.Entry, "description": n.Description},
		), nil
	case "repeat":
		if v[2] == "stop" {
			if v[3] != "STOP" {
				return nil, fmt.Errorf("请输入 STOP 确认停止系列")
			}
			return m.taskAction("delete", r.task), nil
		}
		if v[0] == "" {
			return nil, fmt.Errorf("请选择重复规则，或选择停止系列")
		}
		until, e := inputDate(v[1], r.task.Until)
		if e != nil {
			return nil, e
		}
		return action(
			"recurrence.edit",
			map[string]any{"recur": v[0], "until": until},
		), nil
	case "delete":
		if v[0] != "DELETE" {
			return nil, fmt.Errorf("请输入 DELETE 确认")
		}
		switch r.kind {
		case "task":
			return m.taskAction("delete", r.task), nil
		case "project":
			return org(
				map[string]any{
					"kind":   "project",
					"action": "delete",
					"item":   r.project,
				},
			), nil
		case "filter", "tag":
			return org(
				map[string]any{
					"kind":   r.kind,
					"action": "delete",
					"item":   r.item,
				},
			), nil
		case "group", "column":
			return org(
				map[string]any{
					"kind":     "board",
					"action":   "column.delete",
					"columnId": r.id,
				},
			), nil
		}
	case "restore":
		if v[0] != "true" {
			return nil, fmt.Errorf("请选择确认恢复")
		}
		return m.taskAction("restore", Task{UUID: r.id}), nil
	case "energy":
		if v[0] != "true" {
			return nil, fmt.Errorf("请选择确认使用")
		}
		return org(map[string]any{"kind": "energy", "action": "elixir"}), nil
	case "export", "point.export":
		if v[0] == "" {
			return nil, errRequired("文件路径")
		}
		route := "/api/export"
		if m.formKind == "point.export" {
			route = "/api/backup/download?id=" + url.QueryEscape(r.id)
		}
		return func() tea.Msg {
			var data json.RawMessage
			e := m.client.read(route, &data)
			if e == nil {
				e = writePrivateFile(v[0], data)
			}
			return saved{e, "已导出：" + v[0]}
		}, nil
	case "import":
		if v[0] == "" {
			return nil, errRequired("文件路径")
		}
		return func() tea.Msg {
			f, e := os.Open(v[0])
			if e != nil {
				return result{err: e}
			}
			defer f.Close()
			info, e := f.Stat()
			if e != nil {
				return result{err: e}
			}
			if info.Size() > 8*1024*1024 {
				return result{err: fmt.Errorf("备份超过 8 MiB")}
			}
			b, e := os.ReadFile(v[0])
			if e != nil {
				return result{err: e}
			}
			if !json.Valid(b) {
				return result{err: fmt.Errorf("备份不是有效 JSON")}
			}
			var out json.RawMessage
			e = m.client.request(
				"/api/backup/preview",
				json.RawMessage(b),
				&out,
			)
			return result{"preview", out, e}
		}, nil
	case "restore.confirm":
		if v[0] != "RESTORE" {
			return nil, fmt.Errorf("请输入 RESTORE 确认替换")
		}
		if m.previewToken == "" {
			return nil, fmt.Errorf("请先重新预览备份")
		}
		return m.write(
			"/api/backup/restore",
			map[string]any{"token": m.previewToken},
		), nil
	}
	return nil, fmt.Errorf("未选择有效操作")
}
