package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
)

var (
	ink        = lipgloss.AdaptiveColor{Light: "#202428", Dark: "#E5E7EB"}
	muted      = lipgloss.AdaptiveColor{Light: "#71717A", Dark: "#9299A6"}
	line       = lipgloss.AdaptiveColor{Light: "#DADDE3", Dark: "#343B49"}
	brand      = lipgloss.AdaptiveColor{Light: "#426B57", Dark: "#9FCBB1"}
	selectedBG = lipgloss.AdaptiveColor{Light: "#E8EFEA", Dark: "#25382F"}
	accent     = lipgloss.NewStyle().Foreground(brand).Bold(true)
	dim        = lipgloss.NewStyle().Foreground(muted)
)

func disableColor()               { lipgloss.SetColorProfile(termenv.Ascii) }
func clip(s string, w int) string { return ansi.Truncate(s, max(1, w), "…") }
func wrap(s string, w int) string {
	var out []string
	for _, part := range strings.Split(s, "\n") {
		out = append(
			out,
			lipgloss.NewStyle().Width(max(1, w)).Render(clean(part)),
		)
	}
	return strings.Join(out, "\n")
}
func panel(title, body string, width, height int, focused bool) string {
	color := line
	if focused {
		color = brand
	}
	heading := accent.Render(title)
	content := heading + "\n" + dim.Render(
		strings.Repeat("─", max(1, width-4)),
	) + "\n" + body
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(color).
		Padding(0, 1).
		Width(max(1, width-2)).
		Height(max(1, height-2)).
		MaxHeight(height).
		Render(content)
}
func window(lines []string, offset, height int) string {
	offset = max(0, min(offset, max(0, len(lines)-height)))
	end := min(len(lines), offset+height)
	return strings.Join(lines[offset:end], "\n")
}
func (m model) sidebar(w, h int) string {
	var lines []string
	es := m.nav()
	start := 0
	if m.navCursor >= h-5 {
		start = m.navCursor - h + 6
	}
	end := min(len(es), start+h-4)
	for i := start; i < end; i++ {
		e := es[i]
		s := "  " + e.title
		if e.id == m.view {
			s = "● " + e.title
		}
		s = clip(s, w-5)
		style := lipgloss.NewStyle().Width(w - 4).Foreground(ink)
		if (m.navFocus && i == m.navCursor) || (!m.navFocus && e.id == m.view) {
			style = style.Background(selectedBG).Foreground(brand).Bold(true)
		}
		lines = append(lines, style.Render(s))
	}
	return panel("工作区", strings.Join(lines, "\n"), w, h, m.navFocus)
}
func (m model) taskMeta(t Task) string {
	var parts []string
	if t.Project != "" {
		parts = append(parts, t.Project)
	}
	if t.Priority != "" {
		parts = append(parts, "优先级 "+t.Priority)
	}
	if t.Due != "" {
		d := shownDate(t.Due)
		if date(t.Due).Before(time.Now()) && t.Status != "completed" {
			d = "逾期 " + d
		}
		parts = append(parts, d)
	}
	if len(t.Tags) > 0 {
		parts = append(parts, "#"+strings.Join(t.Tags, " #"))
	}
	if t.Recur != "" {
		parts = append(parts, "↻ "+t.Recur)
	}
	if t.Status == "waiting" || date(t.Wait).After(time.Now()) {
		parts = append(parts, "等待中")
	}
	return clean(strings.Join(parts, " · "))
}
func (m model) list(w, h int) string {
	if m.board && m.taskView() {
		return m.boardView(w, h)
	}
	var lines []string
	if m.view == "focus" {
		active := m.activeProjects()
		lines = append(
			lines,
			dim.Render(fmt.Sprintf("%d / 3 聚焦项目", len(active))),
		)
		for _, p := range active {
			lines = append(lines, accent.Render(clip("◎ "+p.Name, w-5)))
			if p.Outcome != "" {
				lines = append(lines, dim.Render(clip("  "+p.Outcome, w-5)))
			}
		}
		if len(active) == 0 {
			lines = append(lines, dim.Render("按 p 选择项目，或 Tab 打开导航"))
		}
		lines = append(lines, "")
	}
	if m.query != "" {
		lines = append(lines, dim.Render("搜索："+clip(clean(m.query), w-12)))
	}
	rs := m.rows()
	header := len(lines)
	available := max(3, h-header-5)
	type block struct {
		index int
		lines []string
	}
	var blocks []block
	for i, r := range rs {
		style := lipgloss.NewStyle().Width(w - 4).Foreground(ink)
		selected := i == m.cursor && !m.navFocus
		if selected {
			style = style.Background(selectedBG).Foreground(brand)
		}
		marker := "  "
		if selected {
			marker = "▸ "
		}
		var ls []string
		switch r.kind {
		case "group":
			arrow := "▾"
			if m.collapsed[r.id] && !m.board {
				arrow = "▸"
			}
			ls = []string{
				style.Bold(true).
					Render(clip(fmt.Sprintf("%s%s %s  %d", marker, arrow, r.title, r.count), w-4)),
			}
		case "task":
			icon := "○"
			if r.task.Status == "completed" {
				icon = "✓"
			}
			if r.task.Start != "" {
				icon = "▶"
			}
			title := clip(marker+icon+" "+clean(r.title), w-4)
			ls = []string{style.Render(title)}
			if meta := m.taskMeta(r.task); meta != "" {
				ls = append(
					ls,
					style.Foreground(muted).Render(clip("    "+meta, w-4)),
				)
			}
		default:
			ls = []string{
				style.Bold(true).Render(clip(marker+clean(r.title), w-4)),
			}
			if sub := clean(r.subtitle); sub != "" {
				ls = append(
					ls,
					style.Foreground(muted).Render(clip("  "+sub, w-4)),
				)
			}
		}
		blocks = append(blocks, block{i, ls})
	}
	offset := 0
	used := 0
	for _, b := range blocks {
		used += len(b.lines)
		if b.index == m.cursor {
			if used > available {
				offset = used - available
			}
			break
		}
	}
	var content []string
	for _, b := range blocks {
		content = append(content, b.lines...)
	}
	if len(rs) == 0 || len(m.visible()) == 0 && m.taskView() {
		content = append(content, "")
		content = append(
			content,
			strings.Split(wrap(m.emptyMessage(), w-6), "\n")...)
	}
	lines = append(
		lines,
		strings.Split(window(content, offset, available), "\n")...)
	mode := "分组列表"
	if m.board {
		mode = fmt.Sprintf(
			"看板 · %d / %d · ← → 切换列",
			m.boardColumn+1,
			len(m.columns()),
		)
	}
	return panel(
		clip(m.title(), w-5)+"  "+dim.Render(mode),
		strings.Join(lines, "\n"),
		w,
		h,
		!m.navFocus,
	)
}
func (m model) taskView() bool {
	switch m.view {
	case "projects",
		"later",
		"filters",
		"tags",
		"columns",
		"backup",
		"recovery":
		return false
	}
	return true
}
func (m model) emptyMessage() string {
	if m.busy {
		return "正在连接工作区…"
	}
	if m.blocked {
		return "读取失败。请查看底部错误，按 r 刷新。"
	}
	if m.query != "" {
		return "当前视图没有匹配项。按 / 修改或清除搜索。"
	}
	if m.view == "focus" && len(m.activeProjects()) == 0 {
		return "尚未选择聚焦项目。按 p 选择，或在导航中查看全部任务。"
	}
	complete, waiting := 0, 0
	for _, t := range m.tasks {
		if t.Status == "completed" {
			complete++
		}
		if t.Status == "waiting" {
			waiting++
		}
	}
	if m.taskView() {
		return fmt.Sprintf(
			"此视图暂无任务。工作区有 %d 条已完成、%d 条等待任务。Tab 打开导航；a 添加任务。",
			complete,
			waiting,
		)
	}
	return "暂无条目。按 : 打开操作菜单以创建或管理。"
}
func (m model) inspector(w, h int) string {
	r := m.current()
	var lines []string
	add := func(s string) { lines = append(lines, strings.Split(wrap(s, w-5), "\n")...) }
	switch r.kind {
	case "task":
		t := r.task
		add(t.Description)
		lines = append(lines, "")
		project := t.Project
		if project == "" {
			project = "收件箱"
		}
		add("状态  " + t.Status)
		add("项目  " + project)
		if t.Due != "" {
			add("截止  " + shownDate(t.Due))
		}
		if t.Wait != "" {
			add("等待  " + shownDate(t.Wait))
		}
		if len(t.Tags) > 0 {
			add("标签  " + strings.Join(t.Tags, ", "))
		}
		if t.Priority != "" {
			add("优先级  " + t.Priority)
		}
		if t.Recur != "" {
			add("重复  " + t.Recur + " → " + shownDate(t.Until))
		}
		if t.Parent != "" {
			add("系列  " + t.Parent)
		}
		if t.Depends != nil {
			add(fmt.Sprint("依赖  ", t.Depends))
		}
		for _, p := range m.org.Projects {
			if inProject(t.Project, p.Name) && p.Status == "active" {
				lines = append(lines, "")
				add("◎ " + p.Name)
				add("完成目标：" + p.Outcome)
				if p.NextTask == t.UUID {
					add("★ 这是项目下一步")
				}
			}
		}
		lines = append(lines, "", accent.Render("备注"))
		if len(t.Annotations) == 0 {
			add("暂无备注 · : 追加备注")
		}
		for _, n := range t.Annotations {
			add("• " + n.Description)
			lines = append(lines, "")
		}
		lines = append(lines, "", dim.Render("UUID"))
		add(t.UUID)
	case "project":
		p := r.project
		add(p.Name)
		add("状态：" + p.Status)
		lines = append(lines, "")
		add("完成目标：" + p.Outcome)
		add("描述：" + p.Description)
		for _, t := range m.tasks {
			if t.UUID == p.NextTask {
				add("下一步：" + t.Description)
			}
		}
		add("Enter 打开任务 · : 管理项目")
	case "filter", "tag":
		add(r.item.Name)
		add(r.item.Description)
		add(r.item.Expression)
		add("颜色：" + r.item.Color)
		add(fmt.Sprint("收藏：", r.item.Favorite))
		add("Enter 打开任务 · : 编辑")
	case "group", "column":
		add(r.title)
		add(fmt.Sprintf("%d 个可见任务", r.count))
		add("每个列表分组对应一列看板。任务位置、组内排序与栏目顺序共用同一份数据。")
		add("Space 折叠 / 展开 · : 管理分组")
	default:
		add("选择任务或项目查看详情。")
		add("按 : 查看可用操作。")
		add("Tab 切换导航与内容。")
		add("? 打开帮助。")
	}
	return panel(
		"详情  ·  PgUp / PgDn 滚动",
		window(lines, m.detailScroll, max(1, h-5)),
		w,
		h,
		false,
	)
}
func (m model) overlay(w, h int) string {
	width := min(80, w-4)
	bodyWidth := max(15, width-6)
	title := "操作菜单"
	hint := "输入搜索 · ↑↓ 选择 · Enter 确认 · Esc 返回"
	var lines []string
	switch m.mode {
	case "search":
		title = "搜索当前视图"
		lines = []string{m.search.View()}
		hint = "Enter 应用 · Esc 取消"
	case "choice":
		if m.choiceField >= 0 {
			title = m.fields[m.choiceField].label
			if m.fields[m.choiceField].multi {
				hint = "Enter 切换选中 · Esc 完成"
			}
		}
		lines = append(lines, m.search.View(), "")
		opts := m.matches()
		limit := max(3, h-11)
		start := max(0, m.optionCursor-limit/2)
		end := min(len(opts), start+limit)
		for i := start; i < end; i++ {
			o := opts[i]
			label := o.label
			if m.choiceField >= 0 && m.fields[m.choiceField].multi {
				mark := "□ "
				for _, s := range splitTags(m.fields[m.choiceField].value()) {
					if s == o.value {
						mark = "■ "
					}
				}
				label = mark + label
			}
			style := lipgloss.NewStyle().Width(bodyWidth)
			marker := "  "
			if i == m.optionCursor {
				style = style.Background(selectedBG).Foreground(brand)
				marker = "› "
			}
			lines = append(lines, style.Render(clip(marker+label, bodyWidth)))
			if o.hint != "" && len(opts) < 6 {
				lines = append(
					lines,
					dim.Render(clip("  "+clean(o.hint), bodyWidth)),
				)
			}
		}
		if len(opts) == 0 {
			lines = append(lines, dim.Render("没有匹配项"))
		}
	case "form":
		title = m.formTitle
		hint = "Tab 切换 · Enter 选择 / 换行 · Ctrl+S 保存 · Esc 保留草稿"
		lines = append(
			lines,
			strings.Split(wrap(m.formHint, bodyWidth), "\n")...)
		lines = append(lines, "")
		type block struct {
			index int
			lines []string
		}
		var bs []block
		for i, f := range m.fields {
			marker := "  "
			style := dim
			if i == m.field {
				marker = "▸ "
				style = accent
			}
			ls := []string{style.Render(marker + f.label)}
			if len(f.options) > 0 && !f.multiline {
				value := f.display()
				if value == "" {
					value = "（空）"
				}
				ls = append(ls, clip("  "+value+"  ▾", bodyWidth))
			} else if f.multiline {
				a := f.area
				a.SetWidth(bodyWidth - 3)
				ls = append(ls, strings.Split(a.View(), "\n")...)
			} else {
				t := f.input
				t.Width = bodyWidth - 3
				ls = append(ls, t.View())
			}
			if i == m.field && f.hint != "" {
				ls = append(ls, dim.Render(clip("  "+f.hint, bodyWidth)))
			}
			ls = append(ls, "")
			bs = append(bs, block{i, ls})
		}
		limit := max(5, h-len(lines)-10)
		offset := 0
		used := 0
		for _, b := range bs {
			used += len(b.lines)
			if b.index == m.field {
				offset = max(0, used-limit)
				break
			}
		}
		var content []string
		for _, b := range bs {
			content = append(content, b.lines...)
		}
		lines = append(
			lines,
			strings.Split(window(content, offset, limit), "\n")...)
	case "preview":
		title = "恢复范围预览"
		hint = "Enter 进入最终确认 · Esc 取消"
		var p struct {
			ExportedAt         string
			Current, Incoming  map[string]int
			ActiveTimers       bool
			StoppedOccurrences int
			Warnings           []string
		}
		_ = json.Unmarshal(m.preview, &p)
		lines = append(
			lines,
			"备份时间："+p.ExportedAt,
			"",
			"内容             当前 → 备份",
		)
		for _, k := range []string{"tasks", "projects", "labels", "filters", "columns", "intervals"} {
			lines = append(
				lines,
				fmt.Sprintf("%-12s  %d → %d", k, p.Current[k], p.Incoming[k]),
			)
		}
		for _, warning := range p.Warnings {
			lines = append(
				lines,
				strings.Split(wrap("• "+warning, bodyWidth), "\n")...)
		}
		lines = append(lines, fmt.Sprintf("恢复时停止的计时：%d", p.StoppedOccurrences))
	}
	body := strings.Join(
		lines,
		"\n",
	) + "\n" + dim.Render(
		strings.Repeat("─", bodyWidth),
	) + "\n" + wrap(
		hint,
		bodyWidth,
	)
	return lipgloss.Place(
		w,
		h,
		lipgloss.Center,
		lipgloss.Center,
		panel(title, body, width, min(h, lipgloss.Height(body)+5), true),
	)
}
func (m model) View() string {
	w, h := max(30, m.width), max(12, m.height)
	header := lipgloss.NewStyle().
		Foreground(ink).
		Bold(true).
		Render("  ASTER") +
		dim.Render(
			"   /   "+clean(m.title()),
		)
	right := "SSH · " + m.client.Host
	if m.org.Energy != nil {
		right += fmt.Sprintf(
			"   精力 %.0f/%.0f",
			m.org.Energy.Remaining,
			m.org.Energy.Max,
		)
	} else if m.org.Timing != nil && !m.org.Timing.Available {
		right += "   计时不可用"
	}
	pad := max(1, w-lipgloss.Width(header)-lipgloss.Width(right)-2)
	header += strings.Repeat(" ", pad) + dim.Render(right)
	contentHeight := h - 5
	var body string
	if m.help {
		body = lipgloss.Place(
			w,
			contentHeight,
			lipgloss.Center,
			lipgloss.Center,
			panel(
				"键盘帮助",
				strings.Join(
					[]string{
						"Tab              导航 / 内容",
						"↑ ↓ / j k        选择条目",
						"Enter            查看详情 / 打开项目 / 折叠分组",
						": / Ctrl+K       可搜索的操作菜单",
						"a / A            添加任务 / 一句话捕捉",
						"e / x / s        编辑 / 完成重开 / 开始停止",
						"m / d / u        移动排序 / 删除 / 撤销",
						"b / ← →          列表看板切换 / 切换栏目",
						"p / n / g        聚焦项目 / 下一步 / 新增分组",
						"/                搜索当前视图",
						"PgUp / PgDn      详情滚动",
						"r                刷新核对",
						"表单 Tab         切换字段",
						"表单 Enter       打开选择器 / 多行换行",
						"表单 Ctrl+S      保存",
						"Esc              返回并保留本次会话草稿",
						"q / Ctrl+C       退出",
						"",
						"? / Esc 关闭帮助",
					},
					"\n",
				),
				min(74, w-2),
				min(24, contentHeight),
				true,
			),
		)
	} else if m.mode != "" {
		body = m.overlay(w, contentHeight)
	} else if w < 76 {
		if m.navFocus {
			body = m.sidebar(w, contentHeight)
		} else if m.detail {
			body = m.inspector(w, contentHeight)
		} else {
			body = m.list(w, contentHeight)
		}
	} else {
		navW := min(27, w/4)
		detailW := 0
		if (w >= 110 && !m.board) || m.detail {
			detailW = min(38, w/3)
		}
		centerW := w - navW - detailW
		panes := []string{
			m.sidebar(navW, contentHeight),
			m.list(centerW, contentHeight),
		}
		if detailW > 0 {
			panes = append(panes, m.inspector(detailW, contentHeight))
		}
		body = lipgloss.JoinHorizontal(lipgloss.Top, panes...)
	}
	state := "● "
	if m.busy {
		state = "◌ 保存 / 读取中 · "
	}
	if m.blocked {
		state = "! 写入锁定 · "
	}
	footer := dim.Render("  Tab 导航   : 操作   / 搜索   a 添加   b 列表/看板   ? 帮助")
	message := clip("  "+state+clean(m.message), w)
	output := header + "\n" + dim.Render(
		strings.Repeat("─", w),
	) + "\n" + body + "\n" + footer + "\n" + message
	lines := strings.Split(output, "\n")
	for i := range lines {
		lines[i] = clip(lines[i], w)
	}
	return strings.Join(lines, "\n")
}

func (m model) boardView(w, h int) string {
	cols := m.columns()
	count := max(1, min(len(cols), w/26))
	colW := (w - 2) / count
	start := max(0, min(m.boardColumn-count/2, len(cols)-count))
	end := min(len(cols), start+count)
	var panes []string
	for i := start; i < end; i++ {
		c := cols[i]
		ts := m.grouped(m.visible(), c.ID)
		var lines []string
		current := m.current()
		offset := 0
		selectedLine := 0
		for _, t := range ts {
			style := lipgloss.NewStyle().Width(colW - 4).Foreground(ink)
			mark := "○ "
			if t.Status == "completed" {
				mark = "✓ "
			}
			if t.Start != "" {
				mark = "▶ "
			}
			if i == m.boardColumn && t.UUID == current.id {
				style = style.Background(selectedBG).Foreground(brand)
				selectedLine = len(lines)
			}
			titleLines := strings.Split(wrap(mark+t.Description, colW-4), "\n")
			for _, titleLine := range titleLines {
				lines = append(lines, style.Render(titleLine))
			}
			if meta := m.taskMeta(t); meta != "" {
				lines = append(lines, dim.Render(clip("  "+meta, colW-4)))
			}
			lines = append(lines, "")
		}
		if len(ts) == 0 {
			lines = append(lines, dim.Render("暂无任务"))
		}
		offset = max(0, selectedLine-(h-9))
		panes = append(
			panes,
			panel(
				fmt.Sprintf("%s · %d", c.Name, len(ts)),
				window(lines, offset, h-7),
				colW,
				h-3,
				i == m.boardColumn && !m.navFocus,
			),
		)
	}
	content := lipgloss.JoinHorizontal(
		lipgloss.Top,
		panes...) + "\n" + dim.Render(
		" ← → 选择栏目 · ↑↓ 选择任务 · m 移动排序 · b 列表",
	)
	return lipgloss.NewStyle().Width(w).Height(h).MaxHeight(h).Render(content)
}
