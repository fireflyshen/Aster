package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

type renderFrame struct {
	now     time.Time
	idx     viewIndex
	visible []Task
	rows    []row
	cur     row
}

func currentRow(rs []row, cursor int) row {
	if cursor >= 0 && cursor < len(rs) {
		return rs[cursor]
	}
	return row{}
}

func fillRow(
	styledSegments string,
	plainWidth, totalWidth int,
	selected bool,
) string {
	bg := lipgloss.NewStyle()
	if selected {
		bg = bg.Background(selectedBG)
	}
	pad := max(0, totalWidth-plainWidth)
	return styledSegments + bg.Render(strings.Repeat(" ", pad))
}

func (m model) sidebar(w, h int, f renderFrame) string {
	var lines []string
	es := m.nav()
	start := 0
	if m.navCursor >= h-5 {
		start = m.navCursor - h + 6
	}
	end := min(len(es), start+h-4)
	rowW := max(1, w-4)
	for i := start; i < end; i++ {
		e := es[i]
		activeView := e.id == m.view
		cursorHere := m.navFocus && i == m.navCursor
		highlighted := cursorHere || (!m.navFocus && activeView)
		prefix := "  "
		if activeView {
			prefix = "● "
		}
		if cursorHere {
			prefix = "▸ "
		}
		label := e.title
		countText := ""
		dotColor := brand
		hasDot := false
		if strings.HasPrefix(e.id, "project:") {
			pName := strings.TrimPrefix(e.id, "project:")
			if p, ok := f.idx.projByName[pName]; ok && p.Color != "" {
				dotColor = swatchColor(p.Color)
				hasDot = true
			}
			indent := strings.Repeat("  ", min(strings.Count(pName, "."), 3))
			label = indent + pName
			if !activeView && !cursorHere {
				prefix = "● "
				hasDot = true
			}
			if cnt := m.org.ProjectCounts[pName]; cnt > 0 && rowW > 14 {
				countText = fmt.Sprintf(" %d", cnt)
			}
		} else if e.id == "active" && f.idx.anyRunning {
			dotColor = timerColor
			hasDot = true
		}

		maxTitleW := max(4, rowW-len([]rune(prefix))-lipgloss.Width(countText))
		clippedLabel := clip(label, maxTitleW)
		textStyle := lipgloss.NewStyle().Foreground(ink)
		prefixStyle := lipgloss.NewStyle().Foreground(muted)
		countStyle := lipgloss.NewStyle().Foreground(muted)
		if hasDot && !highlighted {
			prefixStyle = lipgloss.NewStyle().Foreground(dotColor)
		}
		if highlighted {
			textStyle = textStyle.Background(selectedBG).
				Foreground(selectedFG).
				Bold(true)
			prefixStyle = prefixStyle.Background(selectedBG).
				Foreground(brand).
				Bold(true)
			countStyle = countStyle.Background(selectedBG).Foreground(muted)
		}
		gap := max(0, rowW-lipgloss.Width(prefix+clippedLabel+countText))
		rendered := prefixStyle.Render(prefix) +
			textStyle.Render(clippedLabel+strings.Repeat(" ", gap)) +
			countStyle.Render(countText)
		lines = append(lines, rendered)
	}
	return panel("工作区", strings.Join(lines, "\n"), w, h, m.navFocus)
}

func (m model) taskMetaLine(f renderFrame, r row) string {
	t := r.task
	td := f.idx.dates[t.UUID]
	waiting := t.Status == "waiting" || td.wait.After(f.now)
	var parts []string

	if r.parentTitle != "" {
		parts = append(parts, dim.Render("↳ "+clip(clean(r.parentTitle), 18)))
	}
	if st, ok := f.idx.subStats[t.UUID]; ok && st.total > 0 {
		subStyle := lipgloss.NewStyle().Foreground(brand)
		subIcon := ""
		if st.done == st.total {
			subStyle = lipgloss.NewStyle().Foreground(okColor)
			subIcon = "✓ "
		}
		parts = append(
			parts,
			subStyle.Render(fmt.Sprintf("%s%d/%d", subIcon, st.done, st.total)),
		)
	}
	if strings.TrimSpace(m.org.Descriptions[t.UUID]) != "" {
		parts = append(parts, dim.Render("≡"))
	}
	if t.Project != "" {
		c := muted
		if p, ok := f.idx.projByName[t.Project]; ok && p.Color != "" {
			c = swatchColor(p.Color)
		}
		parts = append(
			parts,
			lipgloss.NewStyle().
				Foreground(c).
				Render("●")+
				" "+softText.Render(
				clean(t.Project),
			),
		)
	}
	if t.Due != "" {
		lbl, c := dueLabel(td.due, t.Due, t.Status == "completed", f.now)
		if lbl != "" {
			parts = append(parts, lipgloss.NewStyle().Foreground(c).Render(lbl))
		}
	}
	if t.Start != "" && !td.start.IsZero() && t.Status != "completed" {
		parts = append(
			parts,
			lipgloss.NewStyle().Foreground(timerColor).Bold(true).
				Render("▶ "+formatDurationShort(f.now.Sub(td.start).Seconds())),
		)
	} else if m.org.Energy != nil {
		if secs := m.org.Energy.TaskSeconds[t.UUID]; secs >= 60 {
			parts = append(parts, dim.Render("⧖ "+formatDurationShort(secs)))
		}
	}
	for _, tag := range t.Tags {
		c := muted
		if item, ok := f.idx.tagByName[tag]; ok && item.Color != "" {
			c = swatchColor(item.Color)
		}
		parts = append(
			parts,
			lipgloss.NewStyle().Foreground(c).Render("#"+clean(tag)),
		)
	}
	if t.Recur != "" {
		parts = append(parts, dim.Render("↻ "+clean(t.Recur)))
	}
	if waiting {
		parts = append(
			parts,
			lipgloss.NewStyle().Foreground(warnColor).Render("◴ 等待"),
		)
	}
	return strings.Join(parts, dim.Render(" · "))
}

func (m model) renderTaskLines(
	f renderFrame,
	r row,
	width int,
	selected bool,
) []string {
	t := r.task
	td := f.idx.dates[t.UUID]
	waiting := t.Status == "waiting" || td.wait.After(f.now)
	marker := "  "
	if selected {
		marker = "▎ "
	}
	tree := ""
	metaIndent := "    "
	if r.depth > 0 {
		tree = "├─ "
		if r.lastChild {
			tree = "└─ "
		}
		metaIndent = "       "
	}
	glyphText := "○"
	glyphColor := priorityColor(t.Priority)
	if t.Status == "completed" {
		glyphText = "✓"
		glyphColor = okColor
	} else if t.Start != "" {
		glyphText = "▶"
		glyphColor = timerColor
	} else if waiting {
		glyphText = "◴"
		glyphColor = warnColor
	}
	prioRaw := ""
	if t.Priority == "H" {
		prioRaw = "[P1] "
	} else if t.Priority == "M" {
		prioRaw = "[P2] "
	} else if t.Priority == "L" {
		prioRaw = "[P3] "
	}

	prefixPlain := marker + tree + glyphText + " " + prioRaw
	titlePlain := clip(
		clean(r.title),
		max(4, width-lipgloss.Width(prefixPlain)),
	)

	bgStyle := lipgloss.NewStyle()
	titleStyle := lipgloss.NewStyle().Foreground(ink)
	markerStyle := lipgloss.NewStyle().Foreground(muted)
	treeStyle := lipgloss.NewStyle().Foreground(line)
	glyphStyle := lipgloss.NewStyle().Foreground(glyphColor)
	prioStyle := lipgloss.NewStyle().
		Foreground(priorityColor(t.Priority)).
		Bold(t.Priority == "H")
	if t.Status == "completed" {
		titleStyle = lipgloss.NewStyle().Foreground(muted)
	}
	if selected {
		bgStyle = bgStyle.Background(selectedBG)
		titleStyle = titleStyle.Background(selectedBG).
			Foreground(selectedFG).
			Bold(true)
		markerStyle = markerStyle.Background(selectedBG).
			Foreground(brand).
			Bold(true)
		treeStyle = treeStyle.Background(selectedBG).Foreground(muted)
		glyphStyle = glyphStyle.Background(selectedBG)
		prioStyle = prioStyle.Background(selectedBG)
	}
	line1 := markerStyle.Render(marker) +
		treeStyle.Render(tree) +
		glyphStyle.Render(glyphText) +
		bgStyle.Render(" ") +
		prioStyle.Render(prioRaw) +
		titleStyle.Render(titlePlain)
	line1 = fillRow(
		line1,
		lipgloss.Width(prefixPlain+titlePlain),
		width,
		selected,
	)

	out := []string{line1}
	if meta := m.taskMetaLine(f, r); meta != "" {
		clippedMeta := clip(metaIndent+meta, width)
		if selected {
			metaBg := lipgloss.NewStyle().Background(selectedBG)
			pad := max(0, width-lipgloss.Width(clippedMeta))
			clippedMeta = metaBg.Render(
				metaIndent,
			) + clip(
				meta,
				max(1, width-len(metaIndent)),
			) + metaBg.Render(
				strings.Repeat(" ", pad),
			)
		}
		out = append(out, clippedMeta)
	}
	return out
}

func (m model) list(w, h int, f renderFrame) string {
	if m.board && m.taskView() {
		return m.boardView(w, h, f)
	}
	var lines []string
	if m.view == "focus" {
		active := f.idx.activeProjects
		lines = append(
			lines,
			softText.Render(fmt.Sprintf("◎ Focus 聚焦 · %d / 3", len(active))),
		)
		for _, p := range active {
			dot := lipgloss.NewStyle().
				Foreground(swatchColor(p.Color)).
				Render("●")
			lineText := dot + " " + accent.Render(clean(p.Name))
			if p.Outcome != "" && w > 28 {
				lineText += dim.Render("  — " + clean(p.Outcome))
			}
			lines = append(lines, clip(lineText, w-5))
		}
		if len(active) == 0 {
			lines = append(lines, dim.Render("按 p 选择聚焦项目，或按 Tab 切换工作区"))
		}
		lines = append(lines, "")
	}
	if m.query != "" {
		lines = append(
			lines,
			lipgloss.NewStyle().
				Foreground(brand).
				Render("⌕ 搜索："+clip(clean(m.query), w-12)),
		)
	}
	rs := f.rows
	rowW := max(4, w-4)
	header := len(lines)
	available := max(3, h-header-5)
	type block struct {
		index int
		lines []string
	}
	var blocks []block
	for i, r := range rs {
		selected := i == m.cursor && !m.navFocus
		var ls []string
		switch r.kind {
		case "group":
			arrow := "▾"
			if m.collapsed[r.id] && !m.board {
				arrow = "▸"
			}
			marker := "  "
			if selected {
				marker = "▎ "
			}
			head := fmt.Sprintf("%s%s %s", marker, arrow, r.title)
			count := fmt.Sprintf(" %d ", r.count)
			if selected {
				bg := lipgloss.NewStyle().Background(selectedBG)
				headStyled := bg.Foreground(selectedFG).
					Bold(true).
					Render(clip(head, max(4, rowW-len(count))))
				cntStyled := bg.Foreground(brand).Bold(true).Render(count)
				ls = []string{
					fillRow(
						headStyled+cntStyled,
						lipgloss.Width(headStyled+cntStyled),
						rowW,
						true,
					),
				}
			} else {
				ls = []string{
					softText.Bold(true).
						Render(clip(head, max(4, rowW-len(count)))) +
						dim.Render(
							count,
						),
				}
			}
		case "task":
			ls = m.renderTaskLines(f, r, rowW, selected)
		default:
			marker := "  "
			if selected {
				marker = "▎ "
			}
			titleStyle := lipgloss.NewStyle().Foreground(ink).Bold(true)
			if selected {
				titleStyle = titleStyle.Background(selectedBG).
					Foreground(selectedFG)
			}
			prefixDot := ""
			if r.kind == "project" && r.project.Color != "" {
				prefixDot = lipgloss.NewStyle().
					Foreground(swatchColor(r.project.Color)).
					Render("● ")

			} else if (r.kind == "filter" || r.kind == "tag") && r.item.Color != "" {
				prefixDot = lipgloss.NewStyle().
					Foreground(swatchColor(r.item.Color)).
					Render("● ")
			}
			line1 := titleStyle.Render(
				marker,
			) + prefixDot + titleStyle.Render(
				clip(clean(r.title), max(4, rowW-4)),
			)
			ls = []string{fillRow(line1, lipgloss.Width(line1), rowW, selected)}
			if sub := clean(r.subtitle); sub != "" {
				subLine := dim.Render(clip("    "+sub, rowW))
				if selected {
					subBg := lipgloss.NewStyle().
						Background(selectedBG).
						Foreground(muted)
					subText := clip("    "+sub, rowW)
					subLine = fillRow(
						subBg.Render(subText),
						lipgloss.Width(subText),
						rowW,
						true,
					)
				}
				ls = append(ls, subLine)
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
	if len(rs) == 0 || len(f.visible) == 0 && m.taskView() {
		content = append(content, "")
		content = append(
			content,
			strings.Split(wrap(m.emptyMessage(), w-6), "\n")...)
	}
	lines = append(
		lines,
		strings.Split(window(content, offset, available), "\n")...)
	rightMeta := ""
	if m.taskView() {
		rightMeta = fmt.Sprintf("%d 项", len(f.visible))
	} else {
		rightMeta = fmt.Sprintf("%d 项", len(rs))
	}
	return panelWithRight(
		m.title(),
		rightMeta,
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
		return "正在读取工作区…"
	}
	if m.query != "" {
		return "当前搜索没有匹配项。按 / 清空或修改关键词。"
	}
	if m.view == "focus" && len(m.viewIdx().activeProjects) == 0 {
		return "还没有聚焦项目。按 p 最多选择 3 个 Focus 项目，或按 Tab 在其他视图操作。"
	}
	if m.view == "waiting" {
		return "没有处于等待状态的任务。"
	}
	if m.view == "active" {
		return "当前没有正在计时的任务。选中任意任务按 s 开始计时。"
	}
	if m.view == "completed" {
		return "当前没有已完成任务。"
	}
	if m.view == "recovery" {
		return "没有可恢复的已删除任务。"
	}
	return "当前视图没有任务。按 a 新建任务，或按 A 一句话捕捉。"
}

func (m model) inspector(w, h int, f renderFrame) string {
	r := f.cur
	var lines []string
	bodyW := max(10, w-5)
	add := func(s string) { lines = append(lines, strings.Split(wrap(s, bodyW), "\n")...) }
	addStyled := func(st lipgloss.Style, s string) {
		for _, part := range strings.Split(wrap(s, bodyW), "\n") {
			lines = append(lines, st.Render(part))
		}
	}
	kv := func(label, val string, valColor lipgloss.AdaptiveColor) {
		padW := max(1, 7-lipgloss.Width(label))
		lbl := dim.Render(label + strings.Repeat(" ", padW))
		v := lipgloss.NewStyle().
			Foreground(valColor).
			Render(clip(clean(val), max(4, bodyW-8)))
		lines = append(lines, lbl+" "+v)
	}
	switch r.kind {
	case "task":
		t := r.task
		td := f.idx.dates[t.UUID]
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), t.Description)
		lines = append(lines, "")

		statusLbl := t.Status
		statusCol := inkSoft
		switch t.Status {
		case "completed":
			statusLbl = "✓ 已完成"
			statusCol = okColor
		case "waiting":
			statusLbl = "◴ 等待中"
			statusCol = warnColor
		case "pending":
			if t.Start != "" {
				statusLbl = "▶ 进行中"
				statusCol = timerColor
			} else {
				statusLbl = "○ 待办"
			}
		}
		kv("状态", statusLbl, statusCol)

		project := t.Project
		projCol := inkSoft
		if project == "" {
			project = "收件箱"
		} else if p, ok := f.idx.projByName[project]; ok && p.Color != "" {
			projCol = swatchColor(p.Color)
		}
		kv("项目", project, projCol)

		if colID := f.idx.columnID(t); colID != "" {
			colName := "未分组"
			for _, c := range m.org.Board.Columns {
				if c.ID == colID {
					colName = c.Name
					break
				}
			}
			kv("分组", colName, inkSoft)
		}
		if t.Due != "" {
			lbl, col := dueLabel(td.due, t.Due, t.Status == "completed", f.now)
			dueDisplay := shownDate(t.Due)
			if strings.HasPrefix(lbl, "逾期 ") {
				dueDisplay += " 逾期"
			} else if strings.HasPrefix(lbl, "今天 ") {
				dueDisplay += " 今天"
			} else if strings.HasPrefix(lbl, "明天 ") {
				dueDisplay += " 明天"
			}
			kv("截止", dueDisplay, col)
		}
		if t.Wait != "" {
			kv("等待", shownDate(t.Wait), warnColor)
		}
		if t.Priority != "" {
			pText := map[string]string{"H": "P1 高优先级", "M": "P2 中优先级", "L": "P3 低优先级"}[t.Priority]
			if pText == "" {
				pText = t.Priority
			}
			kv("优先级", pText, priorityColor(t.Priority))
		}
		if len(t.Tags) > 0 {
			kv("标签", "#"+strings.Join(t.Tags, "  #"), brand)
		}
		if t.Recur != "" {
			rec := t.Recur
			if u := shownDate(t.Until); u != "" {
				rec += " → " + u
			}
			kv("重复", rec, inkSoft)
		}
		if t.Start != "" && !td.start.IsZero() {
			kv(
				"计时",
				"正在运行 "+formatDurationShort(f.now.Sub(td.start).Seconds()),
				timerColor,
			)
		}
		if m.org.Energy != nil {
			if secs := m.org.Energy.TaskSeconds[t.UUID]; secs >= 60 {
				kv("今日", formatDurationShort(secs), muted)
			}
		}

		// Task description (Aster org.descriptions)
		lines = append(lines, "", accent.Render("任务描述"))
		if desc := strings.TrimSpace(m.org.Descriptions[t.UUID]); desc != "" {
			addStyled(softText, desc)
		} else {
			lines = append(lines, dim.Render("暂无描述 · 按 D 编辑"))
		}

		// Parent / Subtasks (Aster org.subtasks)
		pid := f.idx.parentOf[t.UUID]
		children := f.idx.childrenOf[t.UUID]
		if pid != "" || len(children) > 0 {
			headerText := "子任务"
			if st, ok := f.idx.subStats[t.UUID]; ok && st.total > 0 {
				headerText = fmt.Sprintf("子任务 (%d/%d)", st.done, st.total)
			}
			lines = append(lines, "", accent.Render(headerText))
			if pid != "" {
				parentName := pid
				if pt, ok := f.idx.tasksByUUID[pid]; ok {
					parentName = pt.Description
				}
				addStyled(mutedStyle(), "上级: "+parentName)
			}
			limit := min(len(children), 12)
			for i := 0; i < limit; i++ {
				if ct, ok := f.idx.tasksByUUID[children[i]]; ok {
					cMark := "○"
					cCol := inkSoft
					if ct.Status == "completed" {
						cMark = "✓"
						cCol = okColor
					} else if ct.Start != "" {
						cMark = "▶"
						cCol = timerColor
					}
					cLine := lipgloss.NewStyle().
						Foreground(cCol).
						Render(cMark) +
						" " + clip(
						clean(ct.Description),
						max(4, bodyW-3),
					)
					lines = append(lines, cLine)
				}
			}
			if len(children) > limit {
				lines = append(
					lines,
					dim.Render(
						fmt.Sprintf("  + 还有 %d 项子任务", len(children)-limit),
					),
				)
			}
		}

		for _, p := range f.idx.activeProjects {
			if inProject(t.Project, p.Name) {
				lines = append(lines, "")
				addStyled(accent, "◎ "+p.Name)
				add("完成目标：" + p.Outcome)
				if p.NextTask == t.UUID {
					lines = append(
						lines,
						lipgloss.NewStyle().
							Foreground(okColor).
							Bold(true).
							Render("★ 这是项目下一步"),
					)
				}
			}
		}

		lines = append(lines, "", accent.Render("备注"))
		if len(t.Annotations) == 0 {
			lines = append(lines, dim.Render("暂无备注 · : 追加备注"))
		}
		for _, n := range t.Annotations {
			add("• " + n.Description)
			lines = append(lines, "")
		}
		lines = append(lines, "", dim.Render("UUID"))
		lines = append(lines, dim.Render(clip(t.UUID, bodyW)))
	case "project":
		p := r.project
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), p.Name)
		kv("状态", p.Status, brand)
		lines = append(lines, "")
		if p.Outcome != "" {
			add("完成目标：" + p.Outcome)
		}
		if p.Description != "" {
			add("描述：" + p.Description)
		}
		if p.NextTask != "" {
			if nt, ok := f.idx.tasksByUUID[p.NextTask]; ok {
				add("下一步：" + nt.Description)
			}
		}
		lines = append(lines, "", dim.Render("Enter 打开任务 · : 管理项目"))
	case "filter", "tag":
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.item.Name)
		if r.item.Description != "" {
			add(r.item.Description)
		}
		if r.item.Expression != "" {
			add(r.item.Expression)
		}
		kv("颜色", r.item.Color, swatchColor(r.item.Color))
		kv("收藏", fmt.Sprint(r.item.Favorite), inkSoft)
		lines = append(lines, "", dim.Render("Enter 打开任务 · : 编辑"))
	case "group", "column":
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		add(fmt.Sprintf("%d 个可见任务", r.count))
		lines = append(lines, "")
		add("每个列表分组对应一列看板。任务位置、组内排序与栏目顺序共用同一份数据。")
		lines = append(lines, "", dim.Render("Space 折叠 / 展开 · : 管理分组"))
	default:
		add("选择任务或项目查看详情。")
		add("按 : 打开操作菜单，S 添加子任务。")
		add("按 ! 快速设优先级，@ 快速改期。")
		add("Tab 切换工作区与任务列表。")
	}
	return panel(
		"详情  ·  PgUp/PgDn",
		window(lines, m.detailScroll, max(1, h-5)),
		w,
		h,
		false,
	)
}

func mutedStyle() lipgloss.Style { return lipgloss.NewStyle().Foreground(muted) }

func (m model) overlay(w, h int) string {
	width := min(80, w-4)
	bodyWidth := max(15, width-4)
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
			marker := "  "
			selected := i == m.optionCursor
			if selected {
				marker = "› "
			}
			clipped := clip(marker+label, bodyWidth)
			rowStyle := lipgloss.NewStyle().Foreground(ink)
			if selected {
				rowStyle = lipgloss.NewStyle().
					Background(selectedBG).
					Foreground(selectedFG).
					Bold(true)
			}
			lines = append(
				lines,
				fillRow(
					rowStyle.Render(clipped),
					lipgloss.Width(clipped),
					bodyWidth,
					selected,
				),
			)
			if o.hint != "" && len(opts) < 8 {
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
			style := softText
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
	rule := lipgloss.NewStyle().
		Foreground(line).
		Render(strings.Repeat("─", bodyWidth))
	body := strings.Join(
		lines,
		"\n",
	) + "\n" + rule + "\n" + dim.Render(
		wrap(hint, bodyWidth),
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
	now := time.Now()
	idx := m.viewIdx()
	rs := idx.rows(m, now)
	f := renderFrame{
		now:     now,
		idx:     idx,
		visible: idx.visibleTasks(m, now),
		rows:    rs,
		cur:     currentRow(rs, m.cursor),
	}

	brandMark := lipgloss.NewStyle().
		Foreground(brand).
		Bold(true).
		Render("  ◈ ASTER")
	header := brandMark +
		lipgloss.NewStyle().Foreground(line).Render("  /  ") +
		softText.Bold(true).Render(clean(m.title()))

	var rightParts []string
	if idx.anyRunning {
		rightParts = append(
			rightParts,
			lipgloss.NewStyle().
				Foreground(timerColor).
				Bold(true).
				Render("▶ 计时中"),
		)
	}
	if m.org.Energy != nil {
		if m.org.Energy.TrackedSecondsToday >= 60 {
			rightParts = append(
				rightParts,
				dim.Render(
					"今日 "+formatDurationShort(m.org.Energy.TrackedSecondsToday),
				),
			)
		}
		bars := 6
		if w < 90 {
			bars = 4
		}
		rightParts = append(
			rightParts,
			energyMeter(m.org.Energy.Remaining, m.org.Energy.Max, bars),
		)
	} else if m.org.Timing != nil && !m.org.Timing.Available {
		rightParts = append(rightParts, dim.Render("计时不可用"))
	}
	if w >= 60 {
		rightParts = append(rightParts, dim.Render(m.client.Host))
	}
	right := strings.Join(rightParts, dim.Render("  ·  "))
	pad := max(1, w-lipgloss.Width(header)-lipgloss.Width(right)-2)
	header += strings.Repeat(" ", pad) + right

	contentHeight := h - 5
	var body string
	if m.help {
		body = lipgloss.Place(
			w,
			contentHeight,
			lipgloss.Center,
			lipgloss.Center,
			panel(
				"键盘快捷键",
				strings.Join(
					[]string{
						"Tab / ← →        切换左侧导航 / 右侧任务区",
						"↑ ↓ / j k        上下选择条目",
						"Enter / Space    详情 / 打开项目 / 折叠分组",
						": / Ctrl+K       搜索并执行所有操作",
						"a / A / S        新建任务 / 一句话 / 添加子任务",
						"e / D / x / s    编辑 / 任务描述 / 完成 / 计时",
						"! / @ / m        快速优先级 / 改期 / 移动排序",
						"d / u / r        删除 / 撤销最近操作 / 刷新核对",
						"b / ← →          列表看板切换 / 切换栏目",
						"p / n / g        Focus 项目 / 下一步 / 新增分组",
						"/ / PgUp / PgDn  搜索视图 / 滚动详情",
						"表单按键         Tab 切换 · Enter 选择 · Ctrl+S 保存",
						"Esc / q          关闭或暂存草稿 / 退出",
					},
					"\n",
				),
				min(74, w-2),
				min(20, contentHeight),
				true,
			),
		)
	} else if m.mode != "" {
		body = m.overlay(w, contentHeight)
	} else if w < 76 {
		if m.navFocus {
			body = m.sidebar(w, contentHeight, f)
		} else if m.detail {
			body = m.inspector(w, contentHeight, f)
		} else {
			body = m.list(w, contentHeight, f)
		}
	} else {
		navW := min(27, w/4)
		detailW := 0
		if (w >= 110 && !m.board) || m.detail {
			detailW = min(38, w/3)
		}
		centerW := w - navW - detailW
		panes := []string{
			m.sidebar(navW, contentHeight, f),
			m.list(centerW, contentHeight, f),
		}
		if detailW > 0 {
			panes = append(panes, m.inspector(detailW, contentHeight, f))
		}
		body = lipgloss.JoinHorizontal(lipgloss.Top, panes...)
	}

	stateDot := lipgloss.NewStyle().Foreground(okColor).Render("● ")
	if m.busy {
		stateDot = lipgloss.NewStyle().Foreground(brand).Render("◌ 同步中 · ")
	}
	if m.blocked {
		stateDot = lipgloss.NewStyle().
			Foreground(dangerColor).
			Bold(true).
			Render("! 写入锁定 · ")
	}
	footer := dim.Render(
		"  Tab/←→ 切焦点   j/k 移动   x 完成   s 计时   a 新建   S 子任务   !/@ 优先级/改期   : 菜单   ? 帮助",
	)
	message := clip("  "+stateDot+softText.Render(clean(m.message)), w)
	divider := lipgloss.NewStyle().
		Foreground(line).
		Render(strings.Repeat("─", w))
	output := header + "\n" + divider + "\n" + body + "\n" + footer + "\n" + message
	lines := strings.Split(output, "\n")
	for i := range lines {
		lines[i] = clip(lines[i], w)
	}
	return strings.Join(lines, "\n")
}

func (m model) boardView(w, h int, f renderFrame) string {
	cols := m.columns()
	count := max(1, min(len(cols), w/28))
	colW := (w - 2) / count
	start := max(0, min(m.boardColumn-count/2, len(cols)-count))
	end := min(len(cols), start+count)
	cardW := max(4, colW-4)
	var panes []string
	for i := start; i < end; i++ {
		c := cols[i]
		ts, depth, lastChild := f.idx.groupedTasks(m, f.visible, c.ID)
		var lines []string
		offset := 0
		selectedLine := 0
		for _, t := range ts {
			selected := i == m.boardColumn && t.UUID == f.cur.id
			if selected {
				selectedLine = len(lines)
			}
			td := f.idx.dates[t.UUID]
			waiting := t.Status == "waiting" || td.wait.After(f.now)
			tree := ""
			if depth[t.UUID] > 0 {
				tree = "├ "
				if lastChild[t.UUID] {
					tree = "└ "
				}
			}
			mark := "○"
			markCol := priorityColor(t.Priority)
			if t.Status == "completed" {
				mark = "✓"
				markCol = okColor
			} else if t.Start != "" {
				mark = "▶"
				markCol = timerColor
			} else if waiting {
				mark = "◴"
				markCol = warnColor
			}
			prio := ""
			if t.Priority != "" {
				prio = "[" + t.Priority + "] "
			}
			titlePrefix := tree + mark + " " + prio
			wrapped := strings.Split(
				wrap(titlePrefix+t.Description, cardW),
				"\n",
			)
			for li, titleLine := range wrapped {
				if selected {
					st := lipgloss.NewStyle().
						Background(selectedBG).
						Foreground(selectedFG).
						Bold(true)
					lines = append(
						lines,
						fillRow(
							st.Render(titleLine),
							lipgloss.Width(titleLine),
							cardW,
							true,
						),
					)
				} else if li == 0 {
					stTitle := lipgloss.NewStyle().Foreground(ink)
					prefixStyled := lipgloss.NewStyle().
						Foreground(muted).
						Render(tree) +
						lipgloss.NewStyle().
							Foreground(markCol).
							Render(mark) +
						" " +
						lipgloss.NewStyle().
							Foreground(priorityColor(t.Priority)).
							Render(prio)
					rest := strings.TrimPrefix(titleLine, titlePrefix)
					lines = append(lines, prefixStyled+stTitle.Render(rest))
				} else {
					lines = append(
						lines,
						lipgloss.NewStyle().Foreground(ink).Render(titleLine),
					)
				}
			}
			if meta := m.taskMetaLine(
				f,
				row{task: t, depth: depth[t.UUID]},
			); meta != "" {
				lines = append(lines, clip("  "+meta, cardW))
			}
			lines = append(lines, "")
		}
		if len(ts) == 0 {
			lines = append(lines, dim.Render("暂无任务"))
		}
		offset = max(0, selectedLine-(h-7))
		panes = append(
			panes,
			panelWithRight(
				c.Name,
				fmt.Sprintf("%d", len(ts)),
				window(lines, offset, h-5),
				colW,
				h-1,
				i == m.boardColumn && !m.navFocus,
			),
		)
	}
	content := lipgloss.JoinHorizontal(
		lipgloss.Top,
		panes...) + "\n" + dim.Render(
		" ← → 切列 · ↑↓ 选卡 · m 移动 · S 子任务 · b 列表",
	)
	return lipgloss.NewStyle().Width(w).Height(h).MaxHeight(h).Render(content)
}
