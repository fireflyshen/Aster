package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func taskBaseMap(t Task) map[string]any {
	return map[string]any{
		"description": t.Description,
		"project":     t.Project,
		"due":         compact(t.Due),
		"priority":    t.Priority,
		"tags":        append([]string{}, t.Tags...),
	}
}

func quickDuePreset(preset string, now time.Time) (string, bool) {
	loc := now.Local().Location()
	y, mo, d := now.Local().Date()
	dayAt := func(days, hour int) string {
		t := time.Date(y, mo, d+days, hour, 0, 0, 0, loc)
		return t.UTC().Format("20060102T150405Z")
	}
	switch preset {
	case "today":
		return dayAt(0, 18), true
	case "tomorrow":
		return dayAt(1, 9), true
	case "weekend":
		daysUntilSat := (6 - int(now.Local().Weekday()) + 7) % 7
		if daysUntilSat == 0 && now.Local().Hour() >= 18 {
			daysUntilSat = 7
		}
		return dayAt(daysUntilSat, 18), true
	case "nextweek":
		daysUntilMon := (8 - int(now.Local().Weekday())) % 7
		if daysUntilMon == 0 {
			daysUntilMon = 7
		}
		return dayAt(daysUntilMon, 9), true
	case "clear":
		return "", true
	default:
		return "", false
	}
}

func (m *model) openActions() {
	r := m.current()
	options := []choice{}
	add := func(v, l, h string) { options = append(options, choice{v, l, h}) }
	switch r.kind {
	case "task":
		add("edit", "编辑任务", "名称、项目、日期、优先级、标签、重复、描述")
		add("task.toggle", "完成 / 重新打开", "保留 UUID 与栏目")
		add("task.timer", "开始 / 停止计时", "遵循共享精力规则")
		add("task.priority", "快速设置优先级 (!)", "P1 高 / P2 中 / P3 低 / 无")
		add("task.due", "快速改期 (@)", "今天 / 明天 / 本周末 / 下周 / 清除 / 自定义")
		add("task.description", "编辑任务描述 (D)", "支持多行详细说明")
		add("task.subtask", "添加子任务 (S)", "在当前任务下新建并关联子任务")
		if m.viewIdx().parentOf[r.id] != "" {
			add("task.unlink", "脱离父任务", "保留任务本身，解除子任务归属")
		}
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
	add("undo", "撤销最近任务操作", "完成、重开、计时、等待、移动、优先级或改期")
	add("export", "导出完整备份", "本地 JSON 文件")
	add("import", "从备份文件恢复", "先预览后确认")
	m.choose(options, -1)
}

func (m *model) action(a string) tea.Cmd {
	r := m.current()
	m.selected = r
	readOnly := a == "expression" || a == "export" || a == "point.export" ||
		a == "import" || a == "quick" || a == "task.priority" || a == "task.due"
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
	if strings.HasPrefix(a, "setprio:") {
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil
		}
		prio := strings.TrimPrefix(a, "setprio:")
		prev := taskBaseMap(r.task)
		next := taskBaseMap(r.task)
		next["priority"] = prio
		m.undo = &undoChange{
			"/api/action",
			map[string]any{"uuid": r.id, "action": "edit", "task": prev},
			r.title,
		}
		m.busy = true
		return m.write("/api/action", map[string]any{"uuid": r.id, "action": "edit", "task": next})
	}
	if strings.HasPrefix(a, "setdue:") {
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil
		}
		preset := strings.TrimPrefix(a, "setdue:")
		if preset == "custom" {
			return m.openForm(
				"task.due.custom",
				"设置截止日期",
				r.title,
				textField("截止日期", shownDate(r.task.Due), "YYYY-MM-DD HH:MM；留空清除"),
			)
		}
		due, ok := quickDuePreset(preset, time.Now())
		if !ok {
			return nil
		}
		prev := taskBaseMap(r.task)
		next := taskBaseMap(r.task)
		next["due"] = due
		m.undo = &undoChange{
			"/api/action",
			map[string]any{"uuid": r.id, "action": "edit", "task": prev},
			r.title,
		}
		m.busy = true
		return m.write("/api/action", map[string]any{"uuid": r.id, "action": "edit", "task": next})
	}
	switch a {
	case "task.new":
		t := Task{}
		if strings.HasPrefix(m.view, "project:") {
			t.Project = strings.TrimPrefix(m.view, "project:")
		}
		m.selected = row{}
		return m.openTaskForm(a, t)
	case "task.subtask":
		if r.kind != "task" {
			m.message = "请先选择父任务"
			return nil
		}
		return m.openTaskForm("task.subtask", Task{Project: r.task.Project})
	case "task.unlink":
		if r.kind != "task" || m.viewIdx().parentOf[r.id] == "" {
			m.message = "此任务没有关联父任务"
			return nil
		}
		m.busy = true
		return m.orgChange(map[string]any{
			"kind":      "subtask",
			"action":    "unlink",
			"childUuid": r.id,
		})
	case "task.description":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil
		}
		return m.openForm(
			a,
			"编辑任务描述",
			r.title,
			areaField("任务描述", m.org.Descriptions[r.id], "留空保存将清空描述 · Ctrl+S 保存"),
		)
	case "task.priority":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil
		}
		m.choose([]choice{
			{"setprio:H", "P1 · 高优先级", "紧急且重要"},
			{"setprio:M", "P2 · 中优先级", "常规推进"},
			{"setprio:L", "P3 · 低优先级", "随时处理"},
			{"setprio:", "清除优先级", "恢复默认"},
		}, -1)
		return nil
	case "task.due":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil
		}
		m.choose([]choice{
			{"setdue:today", "今天 (18:00)", "今日收尾"},
			{"setdue:tomorrow", "明天 (09:00)", "明日上午"},
			{"setdue:weekend", "本周末 (18:00)", "周六安排"},
			{"setdue:nextweek", "下周一 (09:00)", "下周启动"},
			{"setdue:clear", "清除截止日期", "转为无截止日期"},
			{"setdue:custom", "自定义日期时间…", "手动输入 YYYY-MM-DD HH:MM"},
		}, -1)
		return nil
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
					"aster-backup-"+time.Now().Format("20060102-150405")+".json",
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
