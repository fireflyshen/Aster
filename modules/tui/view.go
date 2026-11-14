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
		softActive := !m.navFocus && activeView

		prefix := "  "
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
			prefix = "● "
			if !hasDot {
				dotColor = muted
				hasDot = true
			}
			if cnt := m.org.ProjectCounts[pName]; cnt > 0 && rowW > 14 {
				countText = fmt.Sprintf(" %d", cnt)
			}
		} else if e.id == "active" && f.idx.anyRunning {
			prefix = "▶ "
			dotColor = timerColor
			hasDot = true
		} else if activeView && !cursorHere {
			prefix = "● "
			dotColor = brand
			hasDot = true
		}
		if cursorHere {
			prefix = "▎ "
		}

		prefixStyle := lipgloss.NewStyle().Foreground(muted)
		if hasDot {
			prefixStyle = lipgloss.NewStyle().Foreground(dotColor)
		}
		textStyle := lipgloss.NewStyle().Foreground(ink)
		countStyle := lipgloss.NewStyle().Foreground(muted)
		if cursorHere {
			prefixStyle = lipgloss.NewStyle().Foreground(brand).Bold(true)
			textStyle = lipgloss.NewStyle().Foreground(selectedFG).Bold(true)
			countStyle = lipgloss.NewStyle().Foreground(muted)
		} else if softActive {
			textStyle = lipgloss.NewStyle().Foreground(brand).Bold(true)
			countStyle = lipgloss.NewStyle().Foreground(brand)
		}

		maxTitleW := max(4, rowW-lipgloss.Width(prefix)-lipgloss.Width(countText))
		clippedLabel := clip(label, maxTitleW)
		gap := max(
			0,
			rowW-lipgloss.Width(prefix)-lipgloss.Width(clippedLabel)-lipgloss.Width(countText),
		)
		spans := []styledSpan{
			span(prefix, prefixStyle),
			span(clippedLabel, textStyle),
			span(strings.Repeat(" ", gap), textStyle),
			span(countText, countStyle),
		}
		lines = append(lines, renderSpans(spans, rowW, rowW, cursorHere))
	}
	return panel("工作区", strings.Join(lines, "\n"), w, h, m.navFocus)
}

func (m model) taskMetaSpans(f renderFrame, r row, selected bool) []styledSpan {
	t := r.task
	td := f.idx.dates[t.UUID]
	waiting := t.Status == "waiting" || td.wait.After(f.now)
	sepStyle := dim
	textStyle := softText
	if selected {
		textStyle = lipgloss.NewStyle().Foreground(selectedFG)
	}
	var groups [][]styledSpan

	if r.parentTitle != "" {
		groups = append(
			groups,
			[]styledSpan{span("↳ "+clip(clean(r.parentTitle), 18), dim)},
		)
	}
	showProject := t.Project != ""
	if showProject {
		if strings.HasPrefix(m.view, "project:") && t.Project == strings.TrimPrefix(m.view, "project:") {
			showProject = false
		} else if m.view == "focus" && len(f.idx.activeProjects) == 1 && t.Project == f.idx.activeProjects[0].Name {
			showProject = false
		} else if r.depth > 0 {
			if pid := f.idx.parentOf[t.UUID]; pid != "" {
				if pt, ok := f.idx.tasksByUUID[pid]; ok && pt.Project == t.Project {
					showProject = false
				}
			}
		}
	}
	if showProject {
		c := muted
		if p, ok := f.idx.projByName[t.Project]; ok && p.Color != "" {
			c = swatchColor(p.Color)
		}
		groups = append(groups, []styledSpan{
			span("●", lipgloss.NewStyle().Foreground(c)),
			span(" ", textStyle),
			span(clean(t.Project), textStyle),
		})
	}
	if t.Due != "" {
		lbl, c := dueLabel(td.due, t.Due, t.Status == "completed", f.now)
		if lbl != "" {
			st := lipgloss.NewStyle().Foreground(c)
			if strings.HasPrefix(lbl, "逾期 ") {
				st = st.Bold(true)
			}
			groups = append(groups, []styledSpan{span(lbl, st)})
		}
	}
	if st, ok := f.idx.subStats[t.UUID]; ok && st.total > 0 {
		arrow := "▸ "
		if m.expandedSubtasks[t.UUID] || m.query != "" {
			arrow = "▾ "
		}
		subStyle := softText
		subText := fmt.Sprintf("%s%d/%d", arrow, st.done, st.total)
		if st.done == st.total {
			subStyle = lipgloss.NewStyle().Foreground(okColor)
			subText = arrow + fmt.Sprintf("✓ %d/%d", st.done, st.total)
		}
		groups = append(groups, []styledSpan{span(subText, subStyle)})
	}
	if pCode := priorityCode(t.Priority); pCode != "" && t.Status != "completed" {
		groups = append(groups, []styledSpan{span(pCode, priorityStyle(t.Priority, false))})
	}
	if t.Start != "" && !td.start.IsZero() && t.Status != "completed" {
		groups = append(groups, []styledSpan{
			span(
				"▶ "+formatDurationShort(f.now.Sub(td.start).Seconds()),
				lipgloss.NewStyle().Foreground(timerColor).Bold(true),
			),
		})
	} else if m.org.Energy != nil {
		if secs := m.org.Energy.TaskSeconds[t.UUID]; secs >= 60 {
			groups = append(groups, []styledSpan{
				span("⧖ "+formatDurationShort(secs), dim),
			})
		}
	}
	for _, tag := range t.Tags {
		c := muted
		if item, ok := f.idx.tagByName[tag]; ok && item.Color != "" {
			c = swatchColor(item.Color)
		}
		groups = append(groups, []styledSpan{
			span("#"+clean(tag), lipgloss.NewStyle().Foreground(c)),
		})
	}
	if t.Recur != "" {
		groups = append(groups, []styledSpan{
			span("↻ "+clean(t.Recur), dim),
		})
	}
	if waiting {
		groups = append(groups, []styledSpan{
			span("◴ 等待", lipgloss.NewStyle().Foreground(warnColor)),
		})
	}
	if strings.TrimSpace(m.org.Descriptions[t.UUID]) != "" {
		groups = append(groups, []styledSpan{span("≡", dim)})
	}

	var spans []styledSpan
	for i, g := range groups {
		if i > 0 {
			spans = append(spans, span(" · ", sepStyle))
		}
		spans = append(spans, g...)
	}
	return spans
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
	completed := t.Status == "completed"

	marker := "  "
	markerStyle := dim
	if selected {
		marker = "▎ "
		markerStyle = accent
	}
	tree := ""
	metaTree := ""
	treeColor := treeLine
	if selected {
		treeColor = muted
	}
	treeStyle := lipgloss.NewStyle().Foreground(treeColor)
	if r.depth > 0 {
		if r.lastChild {
			tree = "└─ "
		} else {
			tree = "├─ "
		}
		metaTree = "   "
	}

	glyphText, glyphColor, glyphBold := statusMeta(t, waiting)
	glyphStyle := lipgloss.NewStyle().Foreground(glyphColor)
	if glyphBold {
		glyphStyle = glyphStyle.Bold(true)
	}

	titleStyle := lipgloss.NewStyle().Foreground(ink)
	if completed {
		titleStyle = dim
	}
	if selected {
		if completed {
			titleStyle = lipgloss.NewStyle().Foreground(selectedFG)
		} else {
			titleStyle = lipgloss.NewStyle().Foreground(selectedFG).Bold(true)
		}
	}

	line1Spans := []styledSpan{
		span(marker, markerStyle),
		span(tree, treeStyle),
		span(glyphText, glyphStyle),
		span(" ", titleStyle),
		span(clean(r.title), titleStyle),
	}
	out := []string{renderSpans(line1Spans, width, width, selected)}

	if metaSpans := m.taskMetaSpans(f, r, selected); len(metaSpans) > 0 {
		line2Spans := []styledSpan{
			span(marker, markerStyle),
			span(metaTree, treeStyle),
			span("  ", titleStyle),
		}
		line2Spans = append(line2Spans, metaSpans...)
		out = append(out, renderSpans(line2Spans, width, width, selected))
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
		bannerW := max(10, w-5)
		if len(active) == 0 {
			lines = append(lines, dim.Render("按 p 选择聚焦项目（最多 3 个），或按 Tab 切换工作区"))
		} else {
			var parts []string
			for _, p := range active {
				dot := lipgloss.NewStyle().
					Foreground(swatchColor(p.Color)).
					Render("●")
				part := dot + " " + lipgloss.NewStyle().Foreground(ink).Bold(true).Render(clean(p.Name))
				if p.Outcome != "" && len(active) == 1 && w > 48 {
					part += dim.Render(" — " + clip(clean(p.Outcome), max(8, w/4)))
				}
				parts = append(parts, part)
			}
			summary := softText.Render(fmt.Sprintf("◎ 焦点 %d/3", len(active))) +
				dim.Render("  ·  ") + strings.Join(parts, dim.Render("  ·  "))
			lines = append(lines, clip(summary, bannerW))
		}
		lines = append(lines, sectionRule("", bannerW), "")
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
			if i > 0 && len(blocks) > 0 && rs[i-1].kind != "group" {
				blocks = append(blocks, block{-1, []string{""}})
			}
			arrow := "▾"
			if m.collapsed[r.id] && !m.board {
				arrow = "▸"
			}
			marker := "  "
			markerStyle := dim
			titleStyle := softText.Bold(true)
			cntStyle := dim
			if selected {
				marker = "▎ "
				markerStyle = accent
				titleStyle = lipgloss.NewStyle().Foreground(selectedFG).Bold(true)
				cntStyle = lipgloss.NewStyle().Foreground(brand).Bold(true)
			}
			countText := fmt.Sprintf(" %d", r.count)
			spans := []styledSpan{
				span(marker, markerStyle),
				span(arrow+" ", titleStyle),
				span(clean(r.title), titleStyle),
				span(countText, cntStyle),
			}
			usedW := lipgloss.Width(marker) + lipgloss.Width(arrow+" ") +
				lipgloss.Width(clean(r.title)) + lipgloss.Width(countText)
			if !selected && rowW-usedW >= 6 {
				spans = append(
					spans,
					span("  "+strings.Repeat("─", rowW-usedW-2), lipgloss.NewStyle().Foreground(line)),
				)
			}
			ls = []string{renderSpans(spans, rowW, rowW, selected)}
		case "task":
			ls = m.renderTaskLines(f, r, rowW, selected)
		default:
			marker := "  "
			markerStyle := dim
			titleStyle := lipgloss.NewStyle().Foreground(ink).Bold(true)
			subStyle := dim
			if selected {
				marker = "▎ "
				markerStyle = accent
				titleStyle = lipgloss.NewStyle().Foreground(selectedFG).Bold(true)
				subStyle = lipgloss.NewStyle().Foreground(muted)
			}
			line1Spans := []styledSpan{span(marker, markerStyle)}
			dotColor := ""
			if r.kind == "project" {
				dotColor = r.project.Color
			} else if r.kind == "filter" || r.kind == "tag" {
				dotColor = r.item.Color
			}
			if dotColor != "" {
				line1Spans = append(
					line1Spans,
					span("● ", lipgloss.NewStyle().Foreground(swatchColor(dotColor))),
				)
			}
			line1Spans = append(line1Spans, span(clean(r.title), titleStyle))
			ls = []string{renderSpans(line1Spans, rowW, rowW, selected)}
			if sub := clean(r.subtitle); sub != "" {
				subSpans := []styledSpan{
					span(marker, markerStyle),
					span("  "+sub, subStyle),
				}
				ls = append(ls, renderSpans(subSpans, rowW, rowW, selected))
			}
		}
		blocks = append(blocks, block{i, ls})
		if r.kind == "task" && r.depth > 0 && r.lastChild &&
			i+1 < len(rs) && rs[i+1].kind == "task" && rs[i+1].depth == 0 {
			blocks = append(blocks, block{-1, []string{""}})
		}
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
		for _, line := range strings.Split(wrap(m.emptyMessage(), max(10, w-6)), "\n") {
			content = append(content, dim.Render("  "+line))
		}
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
	addStyled := func(st lipgloss.Style, s string) {
		for _, part := range strings.Split(wrap(s, bodyW), "\n") {
			lines = append(lines, st.Render(part))
		}
	}
	add := func(s string) { addStyled(softText, s) }
	kv := func(label, val string, valColor lipgloss.AdaptiveColor) {
		padW := max(1, 8-lipgloss.Width(label))
		lbl := dim.Render(label + strings.Repeat(" ", padW))
		v := lipgloss.NewStyle().
			Foreground(valColor).
			Render(clip(clean(val), max(4, bodyW-9)))
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
		lines = append(lines, "", sectionRule("任务描述", bodyW))
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
				headerText = fmt.Sprintf("子任务 %d/%d", st.done, st.total)
			}
			lines = append(lines, "", sectionRule(headerText, bodyW))
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
					ctWait := ct.Status == "waiting" || f.idx.dates[ct.UUID].wait.After(f.now)
					cMark, cCol, cBold := statusMeta(ct, ctWait)
					markSt := lipgloss.NewStyle().Foreground(cCol)
					if cBold {
						markSt = markSt.Bold(true)
					}
					cTitleSt := lipgloss.NewStyle().Foreground(ink)
					if ct.Status == "completed" {
						cTitleSt = dim
					}
					pPrefix := ""
					if p := priorityCode(ct.Priority); p != "" {
						pPrefix = priorityStyle(ct.Priority, ct.Status == "completed").
							Render(p) + " "
					}
					availW := max(4, bodyW-3-lipgloss.Width(priorityCode(ct.Priority))-1)
					if priorityCode(ct.Priority) == "" {
						availW = max(4, bodyW-3)
					}
					cLine := markSt.Render(cMark) + " " + pPrefix +
						cTitleSt.Render(clip(clean(ct.Description), availW))
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
				lines = append(lines, "", sectionRule("◎ "+p.Name, bodyW))
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

		lines = append(lines, "", sectionRule("备注", bodyW))
		if len(t.Annotations) == 0 {
			lines = append(lines, dim.Render("暂无备注 · : 追加备注"))
		}
		for _, n := range t.Annotations {
			add("• " + n.Description)
			lines = append(lines, "")
		}
		lines = append(lines, "", dim.Render(clip("UUID  "+t.UUID, bodyW)))
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
	return panelWithRight(
		"详情",
		"PgUp/PgDn",
		window(lines, m.detailScroll, max(1, h-5)),
		w,
		h,
		w < 76 && m.detail && !m.navFocus,
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
			markerStyle := dim
			labelStyle := lipgloss.NewStyle().Foreground(ink)
			hintStyle := dim
			selected := i == m.optionCursor
			if selected {
				marker = "▎ "
				markerStyle = accent
				labelStyle = lipgloss.NewStyle().Foreground(selectedFG).Bold(true)
			}
			lines = append(
				lines,
				renderSpans(
					[]styledSpan{
						span(marker, markerStyle),
						span(clean(label), labelStyle),
					},
					bodyWidth,
					bodyWidth,
					selected,
				),
			)
			if o.hint != "" && len(opts) < 8 {
				lines = append(
					lines,
					hintStyle.Render(clip("  "+clean(o.hint), bodyWidth)),
				)
			}
		}
		if len(opts) == 0 {
			lines = append(lines, dim.Render("没有匹配项"))
		}
	case "form":
		title = m.formTitle
		hint = "Tab 切换 · Enter 选择 / 换行 · Ctrl+S 保存 · Esc 保留草稿"
		if clean(m.formHint) != "" {
			for _, part := range strings.Split(wrap(m.formHint, bodyWidth), "\n") {
				lines = append(lines, dim.Render(part))
			}
		}
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
				marker = "▎ "
				style = accent
			}
			ls := []string{style.Render(marker + f.label)}
			if len(f.options) > 0 && !f.multiline {
				value := f.display()
				valStyle := lipgloss.NewStyle().Foreground(ink)
				if value == "" {
					value = "（空）"
					valStyle = dim
				}
				ls = append(
					ls,
					"  "+valStyle.Render(clip(value, max(4, bodyWidth-6)))+dim.Render("  ▾"),
				)
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
		limit := max(5, h-len(lines)-9)
		startIdx := 0
		if m.field < len(bs) {
			sum := 0
			for j := m.field; j >= 0; j-- {
				if sum > 0 && sum+len(bs[j].lines) > limit {
					startIdx = j + 1
					break
				}
				sum += len(bs[j].lines)
			}
		}
		var content []string
		for j := startIdx; j < len(bs); j++ {
			b := bs[j]
			if len(content) > 0 && len(content)+len(b.lines) > limit {
				break
			}
			content = append(content, b.lines...)
		}
		if len(content) > limit {
			content = content[:limit]
		}
		lines = append(lines, content...)
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
		lipgloss.NewStyle().Foreground(line).Render("  ›  ") +
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

	contentHeight := max(5, h-2)
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
						"Enter / Space    详情 / 打开项目 / 折展分组或子任务",
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

	left := "  " + stateDot + softText.Render(clean(m.message))
	leftW := lipgloss.Width(left)

	var shortcuts string
	if m.board && m.taskView() {
		shortcuts = "Tab 切焦点   ←→ 切列   j/k 选卡   Space 折展   x 完成   s 计时   a 新建   b 列表   ? 帮助  "
	} else {
		shortcuts = "Tab/←→ 切焦点   j/k 移动   Space 折展   x 完成   s 计时   a 新建   S 子任务   : 菜单   ? 帮助  "
	}

	if leftW+lipgloss.Width(shortcuts) > w {
		if m.board && m.taskView() {
			shortcuts = "←→ 切列   Space 折展   x 完成   a 新建   b 列表   ? 帮助  "
		} else {
			shortcuts = "Tab 切焦点   Space 折展   x 完成   a 新建   ? 帮助  "
		}
	}
	if leftW+lipgloss.Width(shortcuts) > w {
		shortcuts = "? 帮助  "
	}

	gap := max(1, w-leftW-lipgloss.Width(shortcuts))
	footerLine := left
	if w-leftW >= lipgloss.Width(shortcuts)+1 {
		footerLine = left + strings.Repeat(" ", gap) + dim.Render(shortcuts)
	}

	output := header + "\n" + body + "\n" + clip(footerLine, w)
	lines := strings.Split(output, "\n")
	for i := range lines {
		lines[i] = clip(lines[i], w)
	}
	return strings.Join(lines, "\n")
}

func (m model) boardView(w, h int, f renderFrame) string {
	cols := m.columns()
	colSet := make(map[string]bool, len(cols))
	for _, c := range cols {
		colSet[c.ID] = true
	}
	count := max(1, min(len(cols), w/28))
	colW := (w - 2) / count
	start := max(0, min(m.boardColumn-count/2, len(cols)-count))
	end := min(len(cols), start+count)
	cardW := max(4, colW-4)
	var panes []string
	for i := start; i < end; i++ {
		c := cols[i]
		ts, depth, lastChild := f.idx.groupedTasks(m, f.visible, c.ID, colSet)
		var lines []string
		offset := 0
		selectedLine := 0
		for _, t := range ts {
			selected := i == m.boardColumn && !m.navFocus && t.UUID == f.cur.id
			if selected {
				selectedLine = len(lines)
			}
			td := f.idx.dates[t.UUID]
			waiting := t.Status == "waiting" || td.wait.After(f.now)
			completed := t.Status == "completed"
			marker := ""
			markerSt := dim
			if selected {
				marker = "▎ "
				markerSt = accent
			}
			tree := ""
			metaTree := ""
			if depth[t.UUID] > 0 {
				if lastChild[t.UUID] {
					tree = "└ "
				} else {
					tree = "├ "
				}
				metaTree = "  "
			}
			treeColor := treeLine
			if selected {
				treeColor = muted
			}
			treeSt := lipgloss.NewStyle().Foreground(treeColor)
			mark, markCol, markBold := statusMeta(t, waiting)
			markSt := lipgloss.NewStyle().Foreground(markCol)
			if markBold {
				markSt = markSt.Bold(true)
			}
			prefixLen := lipgloss.Width(marker + tree + mark + " ")
			wrapped := strings.Split(
				wrap(t.Description, max(4, cardW-prefixLen)),
				"\n",
			)
			titleSt := lipgloss.NewStyle().Foreground(ink)
			if completed {
				titleSt = dim
			}
			if selected {
				if completed {
					titleSt = lipgloss.NewStyle().Foreground(selectedFG)
				} else {
					titleSt = lipgloss.NewStyle().Foreground(selectedFG).Bold(true)
				}
			}
			for li, titleLine := range wrapped {
				var rowSpans []styledSpan
				if li == 0 {
					rowSpans = append(
						rowSpans,
						span(marker, markerSt),
						span(tree, treeSt),
						span(mark, markSt),
						span(" ", titleSt),
						span(titleLine, titleSt),
					)
				} else {
					rowSpans = append(
						rowSpans,
						span(marker, markerSt),
						span(metaTree, treeSt),
						span("  "+titleLine, titleSt),
					)
				}
				lines = append(
					lines,
					renderSpans(rowSpans, cardW, cardW, selected),
				)
			}
			if metaSpans := m.taskMetaSpans(
				f,
				row{task: t, depth: depth[t.UUID]},
				selected,
			); len(metaSpans) > 0 {
				lineSpans := []styledSpan{
					span(marker, markerSt),
					span(metaTree, treeSt),
					span("  ", titleSt),
				}
				lineSpans = append(lineSpans, metaSpans...)
				lines = append(
					lines,
					renderSpans(lineSpans, cardW, cardW, selected),
				)
			}
			lines = append(lines, "")
		}
		if len(ts) == 0 {
			lines = append(lines, dim.Render("暂无任务"))
		}
		offset = max(0, selectedLine-(h-6))
		panes = append(
			panes,
			panelWithRight(
				c.Name,
				fmt.Sprintf("%d", len(ts)),
				window(lines, offset, h-4),
				colW,
				h,
				i == m.boardColumn && !m.navFocus,
			),
		)
	}
	content := lipgloss.JoinHorizontal(lipgloss.Top, panes...)
	return lipgloss.NewStyle().Width(w).Height(h).MaxHeight(h).Render(content)
}
