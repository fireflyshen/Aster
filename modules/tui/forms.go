package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
func (m *model) openActions() {
	r := m.current()
	options := []choice{}
	add := func(v, l, h string) { options = append(options, choice{v, l, h}) }
	switch r.kind {
	case "task":
		add("edit", "编辑任务", "项目、日期、优先级、标签、重复、备注")
		add("task.toggle", "完成 / 重新打开", "保留 UUID 与栏目")
		add("task.timer", "开始 / 停止计时", "遵循共享精力规则")
		add("task.wait", "设置 / 清除等待", "明确日期时间")
		add("task.move", "移动 / 排序", "选择栏目及插入位置")
		add("project.next", "设为项目下一步", "Focus 项目已有任务")
		add("note.add", "追加备注", "多行文本")
		add("note.remove", "移除备注", "选择具体备注")
		add("repeat", "编辑重复规则", "任务或系列")
		add("delete", "删除任务", "保留删除恢复快照")
	case "project":
		add("edit", "编辑项目", "名称、描述、颜色、完成目标、下一步")
		add("project.child", "添加子项目", "原生点路径层级")
		add("project.status", "项目状态 / Focus", "激活、暂停、完成或重新打开")
		add("delete", "删除项目", "任务保留，项目字段清除")
	case "filter", "tag":
		add("edit", "编辑条目", "名称、颜色、收藏与筛选条件")
		add("delete", "删除条目", "不会删除任务")
	case "group", "column":
		if r.id != "unsectioned" {
			add("edit", "重命名分组", "列表与看板同步")
			add("column.left", "分组前移", "同步看板列顺序")
			add("column.right", "分组后移", "同步看板列顺序")
			add("delete", "删除分组", "任务移回未分组")
		}
	case "deleted":
		add("restore", "恢复任务", "恢复原状态，计时不会重新启动")
	case "backup":
		if r.id == "export" {
			add("export", "导出备份到文件", "不覆盖已有文件")
		} else {
			add("import", "从文件预览恢复", "预览后再次确认")
		}
	case "point":
		add("point.export", "下载恢复前副本", "保存到本地文件")
	}
	add("task.new", "添加任务", "完整表单")
	add("quick", "一句话捕捉", "中文日期 / #项目 / @标签 / p1")
	add("focus.choose", "选择 Focus 项目", "最多三个，可选择替换")
	add("project.new", "新建项目", "无须创建占位任务")
	add("column.new", "新增分组", "同时创建看板栏目")
	add("filter.new", "新建过滤器", "原生 Taskwarrior 表达式")
	add("tag.new", "新建标签", "颜色与收藏")
	add("expression", "Taskwarrior 筛选", "只接受过滤条件")
	add("energy", "恢复 +30 精力", "使用 Elixir")
	add("undo", "撤销最近任务操作", "完成、重开、计时、等待或移动")
	add("export", "导出完整备份", "本地 JSON 文件")
	add("import", "从备份文件恢复", "先预览后确认")
	m.choose(options, -1)
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
	return m.openForm(
		kind,
		"任务详情",
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

func (m *model) action(a string) tea.Cmd {
	r := m.current()
	m.selected = r
	readOnly := a == "expression" || a == "export" || a == "point.export" ||
		a == "import" ||
		a == "quick"
	if m.blocked && !readOnly {
		m.message = "连接或写入状态待核对，请按 r 刷新"
		return nil
	}
	if strings.HasPrefix(a, "focus:") {
		name := strings.TrimPrefix(a, "focus:")
		for _, p := range m.org.Projects {
			if p.Name == name {
				m.selected = row{kind: "project", id: p.Name, project: p}
				return m.openStatus(p, "active")
			}
		}
	}
	switch a {
	case "task.new":
		t := Task{}
		if strings.HasPrefix(m.view, "project:") {
			t.Project = strings.TrimPrefix(m.view, "project:")
		}
		m.selected = row{}
		return m.openTaskForm(a, t)
	case "quick":
		m.selected = row{}
		return m.openForm(
			"quick",
			"一句话捕捉",
			"解析后进入完整表单核对日期、项目和标签。",
			areaField("表达式", "", "明天 交报告 #工作 @专注 p1"),
		)
	case "expression":
		return m.openForm(
			"expression",
			"原生筛选",
			"仅支持 Taskwarrior 过滤条件，不执行操作命令。",
			textField("筛选表达式", "status:pending", "例如 project:Work +READY"),
		)
	case "task.toggle", "task.timer":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil
		}
		act, reverse := "complete", "reopen"
		if r.task.Status == "completed" {
			act, reverse = "reopen", "complete"
		}
		if a == "task.timer" {
			act, reverse = "start", "stop"
			if r.task.Start != "" {
				act, reverse = "stop", "start"
			}
		}
		m.undo = &undoChange{
			"/api/action",
			map[string]any{"action": reverse, "uuid": r.id},
			r.title,
		}
		m.busy = true
		return m.taskAction(act, r.task)
	case "task.wait":
		if r.kind != "task" {
			return nil
		}
		return m.openForm(
			a,
			"等待日期",
			"清空日期恢复待办。",
			textField("等到", shownDate(r.task.Wait), "YYYY-MM-DD HH:MM"),
		)
	case "task.move":
		if r.kind != "task" {
			return nil
		}
		cs := []choice{}
		for _, c := range m.columns() {
			cs = append(cs, choice{c.ID, c.Name, ""})
		}
		col := m.columnID(r.task)
		return m.openForm(
			a,
			"移动任务 / 调整顺序",
			"栏目位置与完成状态独立。",
			selectField("目标分组", col, cs),
			selectField("插入位置", "", m.positionChoices(col)),
		)
	case "column.new":
		m.selected = row{}
		return m.openForm(
			a,
			"新增分组",
			"每个分组对应一列看板，所有客户端共享。",
			textField("分组名称", "", "必填，最多 60 字符"),
		)
	case "column.left", "column.right":
		if r.kind != "column" && r.kind != "group" {
			return nil
		}
		direction := "left"
		if a == "column.right" {
			direction = "right"
		}
		m.busy = true
		return m.orgChange(
			map[string]any{
				"kind":      "board",
				"action":    "column.move",
				"columnId":  r.id,
				"direction": direction,
			},
		)
	case "project.new", "project.child":
		name := ""
		if a == "project.child" {
			p := m.selectedProject()
			name = p.Name + "."
		}
		m.selected = row{}
		return m.openProjectForm(Project{Name: name})
	case "project.status":
		p := m.selectedProject()
		if p.Name == "" {
			m.message = "请在项目视图中选择项目"
			return nil
		}
		m.selected = row{kind: "project", id: p.Name, project: p}
		return m.openStatus(p, p.Status)
	case "focus.choose":
		os := []choice{}
		for _, p := range m.org.Projects {
			if p.Status != "active" && p.Status != "completed" {
				os = append(os, choice{"focus:" + p.Name, p.Name, p.Outcome})
			}
		}
		m.choose(os, -1)
		m.message = fmt.Sprintf("选择聚焦项目 · %d / 3 已使用", len(m.activeProjects()))
		return nil
	case "project.next":
		p := m.selectedProject()
		if p.Name == "" {
			m.message = "请先聚焦一个项目，或在项目视图中设置下一步"
			return nil
		}
		m.selected = row{kind: "project", id: p.Name, project: p}
		return m.openForm(
			"project.next",
			"选择下一步",
			p.Name,
			selectField("下一步任务", p.NextTask, m.taskChoices(p)),
		)
	case "note.add":
		if r.kind != "task" {
			return nil
		}
		return m.openForm(a, "追加备注", r.title, areaField("备注", "", "支持多行文本"))
	case "note.remove":
		if r.kind != "task" {
			return nil
		}
		os := []choice{}
		for i, n := range r.task.Annotations {
			os = append(os, choice{fmt.Sprint(i), n.Description, n.Entry})
		}
		if len(os) == 0 {
			m.message = "此任务没有备注"
			return nil
		}
		return m.openForm(a, "移除备注", r.title, selectField("选择备注", "", os))
	case "repeat":
		if r.kind != "task" {
			return nil
		}
		if r.task.Parent != "" {
			m.busy = true
			return m.read(
				"series",
				"/api/recurrence?uuid="+url.QueryEscape(r.task.Parent),
			)
		}
		return m.openTaskForm("task.edit", r.task)
	case "edit":
		switch r.kind {
		case "task":
			return m.openTaskForm("task.edit", r.task)
		case "project":
			return m.openProjectForm(r.project)
		case "filter", "tag":
			return m.openItemForm(r.kind, r.item)
		case "group", "column":
			if r.id != "unsectioned" {
				return m.openForm(
					"column.edit",
					"重命名分组",
					"列表与看板同步。",
					textField("名称", r.title, ""),
				)
			}
		}
	case "filter.new", "tag.new":
		kind := "filter"
		if a == "tag.new" {
			kind = "tag"
		}
		m.selected = row{}
		return m.openItemForm(kind, SavedItem{Color: "gray"})
	case "delete":
		if r.id == "" || r.id == "unsectioned" {
			return nil
		}
		hint := "任务会保留在删除恢复中。"
		if r.kind == "project" {
			hint = "删除项目及子项目资料，任务保留并移回收件箱。"
		}
		if r.kind == "group" || r.kind == "column" {
			hint = "删除栏目，任务保留并移回未分组。"
		}
		if r.kind == "filter" || r.kind == "tag" {
			hint = "仅移除该过滤器或标签，不删除任务。"
		}
		return m.openForm(
			"delete",
			"删除「"+r.title+"」",
			hint,
			textField("输入 DELETE 确认", "", "操作对象请核对上方标题"),
		)
	case "restore":
		if r.kind == "deleted" {
			return m.openForm(
				a,
				"恢复任务",
				r.title,
				selectField("确认恢复", "false", yesNo()),
			)
		}
	case "undo":
		if m.undo == nil {
			m.message = "暂无可撤销的任务操作"
			return nil
		}
		data := m.undo.data
		if m.undo.route == "/api/organization" {
			data["revision"] = m.org.Revision
		}
		m.busy = true
		cmd := m.write(m.undo.route, data)
		m.undo = nil
		return cmd
	case "energy":
		return m.openForm(
			a,
			"使用 Elixir",
			"恢复 +30 精力；遵循服务端每日规则。",
			selectField("确认使用", "false", yesNo()),
		)
	case "export", "point.export":
		return m.openForm(
			a,
			"导出备份",
			"仅创建新文件，权限 0600，不覆盖已有文件。",
			textField(
				"本地文件路径",
				filepath.Join(
					os.TempDir(),
					"aster-backup-"+time.Now().
						Format("20060102-150405")+
						".json",
				),
				"可输入绝对路径",
			),
		)
	case "import":
		return m.openForm(
			a,
			"预览备份恢复",
			"读取本地 JSON，最多 8 MiB。下一步显示替换范围，不立即恢复。",
			textField("备份文件路径", "", "先导出当前备份以便核对"),
		)
	}
	return nil
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
	case "task.new", "task.edit":
		p, e := m.taskInput(v)
		if e != nil {
			return nil, e
		}
		if m.formKind == "task.new" {
			return m.write("/api/tasks", p), nil
		}
		return action("edit", map[string]any{"task": p}), nil
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
		t := r.task
		p := map[string]any{
			"description": t.Description,
			"project":     t.Project,
			"due":         compact(t.Due),
			"priority":    t.Priority,
			"tags":        append([]string{}, t.Tags...),
			"note":        v[0],
		}
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
