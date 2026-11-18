package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type indexSig struct {
	tasks, rev, cols, places, order, subtasks, descs, projects, tags, filters int
}

type parsedDates struct {
	due, wait, scheduled, start, end time.Time
}

type subtaskStats struct {
	done, total int
}

type viewIndex struct {
	built                bool
	sig                  indexSig
	anyRunning           bool
	isTimeMode           bool
	activeTimingTaskUUID string
	tasksByUUID          map[string]Task
	dates                map[string]parsedDates
	openUUIDs            map[string]bool
	taskStates           map[string]string
	blockedUUIDs         map[string]bool
	doingCount           int
	colSet               map[string]bool
	placement            map[string]string
	orderRank            map[string]int
	parentOf             map[string]string
	childrenOf           map[string][]string
	subStats             map[string]subtaskStats
	projByName           map[string]Project
	activeProjects       []Project
	tagByName            map[string]SavedItem
}

func (m model) indexSig() indexSig {
	return indexSig{
		tasks:    len(m.tasks),
		rev:      m.org.Revision,
		cols:     len(m.org.Board.Columns),
		places:   len(m.org.Board.Placements),
		order:    len(m.org.Board.Order),
		subtasks: len(m.org.Subtasks),
		descs:    len(m.org.Descriptions),
		projects: len(m.org.Projects),
		tags:     len(m.org.Tags),
		filters:  len(m.org.Filters),
	}
}

func buildViewIndex(tasks []Task, org Organization) viewIndex {
	idx := viewIndex{
		built: true,
		sig: indexSig{
			tasks:    len(tasks),
			rev:      org.Revision,
			cols:     len(org.Board.Columns),
			places:   len(org.Board.Placements),
			order:    len(org.Board.Order),
			subtasks: len(org.Subtasks),
			descs:    len(org.Descriptions),
			projects: len(org.Projects),
			tags:     len(org.Tags),
			filters:  len(org.Filters),
		},
		tasksByUUID:  make(map[string]Task, len(tasks)),
		dates:        make(map[string]parsedDates, len(tasks)),
		openUUIDs:    make(map[string]bool, len(tasks)),
		taskStates:   make(map[string]string, len(tasks)),
		blockedUUIDs: make(map[string]bool, len(tasks)),
		colSet:       make(map[string]bool, len(org.Board.Columns)),
		placement:    make(map[string]string, len(org.Board.Placements)),
		orderRank:    make(map[string]int, len(org.Board.Order)),
		parentOf:     make(map[string]string, len(org.Subtasks)),
		childrenOf:   map[string][]string{},
		subStats:     map[string]subtaskStats{},
		projByName:   make(map[string]Project, len(org.Projects)),
		tagByName:    make(map[string]SavedItem, len(org.Tags)),
	}
	for _, c := range org.Board.Columns {
		idx.colSet[c.ID] = true
	}
	for _, p := range org.Board.Placements {
		if idx.colSet[p.ColumnID] {
			idx.placement[p.UUID] = p.ColumnID
		}
	}
	for i, id := range org.Board.Order {
		if _, exists := idx.orderRank[id]; !exists {
			idx.orderRank[id] = i
		}
	}
	for _, p := range org.Projects {
		idx.projByName[p.Name] = p
		if p.Status == "active" {
			idx.activeProjects = append(idx.activeProjects, p)
		}
	}
	for _, t := range org.Tags {
		idx.tagByName[t.Name] = t
	}
	isTimeMode := (org.Timing != nil && org.Timing.Backend == "time") ||
		(org.TimerSnapshot != nil && org.TimerSnapshot.Backend == "time")
	idx.isTimeMode = isTimeMode
	if isTimeMode && org.TimerSnapshot != nil &&
		org.TimerSnapshot.ActiveActivity != nil {
		idx.activeTimingTaskUUID = org.TimerSnapshot.ActiveActivity.TaskUUID
		idx.anyRunning = org.TimerSnapshot.State == "ready" &&
			org.TimerSnapshot.ActiveActivity.State == "running" &&
			org.TimerSnapshot.ActiveActivity.SuspendAt == ""
	}
	now := time.Now()
	for _, t := range tasks {
		idx.tasksByUUID[t.UUID] = t
		td := parsedDates{
			due:       date(t.Due),
			wait:      date(t.Wait),
			scheduled: date(t.Scheduled),
			start:     date(t.Start),
			end:       date(t.End),
		}
		idx.dates[t.UUID] = td
		if t.Status == "pending" || t.Status == "waiting" {
			idx.openUUIDs[t.UUID] = true
			if eff := effectiveTaskState(
				t,
				td,
				idx.projByName,
				now,
			); eff != "" {
				idx.taskStates[t.UUID] = eff
				if eff == "doing" {
					idx.doingCount++
				}
			}
		}
		if !isTimeMode && t.Start != "" &&
			(t.Status == "pending" || t.Status == "waiting") {
			idx.anyRunning = true
		}
	}
	for _, t := range tasks {
		if idx.openUUIDs[t.UUID] && isBlockedTask(t, idx.openUUIDs) {
			idx.blockedUUIDs[t.UUID] = true
		}
	}
	for child, parent := range org.Subtasks {
		if child != "" && parent != "" && child != parent {
			idx.parentOf[child] = parent
			idx.childrenOf[parent] = append(idx.childrenOf[parent], child)
		}
	}
	for parent, children := range idx.childrenOf {
		sort.SliceStable(children, func(i, j int) bool {
			ti, okI := idx.tasksByUUID[children[i]]
			tj, okJ := idx.tasksByUUID[children[j]]
			if !okI || !okJ {
				return children[i] < children[j]
			}
			di := ti.Status == "completed"
			dj := tj.Status == "completed"
			if di != dj {
				return !di
			}
			ri := idx.rank(ti, len(idx.orderRank)+1)
			rj := idx.rank(tj, len(idx.orderRank)+1)
			if ri != rj {
				return ri < rj
			}
			return ti.Description < tj.Description
		})
		idx.childrenOf[parent] = children
		var st subtaskStats
		for _, cid := range children {
			if ct, ok := idx.tasksByUUID[cid]; ok {
				st.total++
				if ct.Status == "completed" {
					st.done++
				}
			}
		}
		if st.total > 0 {
			idx.subStats[parent] = st
		}
	}
	return idx
}

func (m model) viewIdx() viewIndex {
	if m.idx.built && m.idx.sig == m.indexSig() {
		return m.idx
	}
	return buildViewIndex(m.tasks, m.org)
}

func (idx viewIndex) columnID(t Task) string {
	for _, id := range []string{t.UUID, idx.parentOf[t.UUID], t.Parent} {
		if id == "" {
			continue
		}
		if col, ok := idx.placement[id]; ok {
			return col
		}
	}
	return "unsectioned"
}

func (idx viewIndex) rank(t Task, fallback int) int {
	for _, id := range []string{t.UUID, idx.parentOf[t.UUID], t.Parent} {
		if id == "" {
			continue
		}
		if v, ok := idx.orderRank[id]; ok {
			return v
		}
	}
	return fallback
}

func (idx viewIndex) visibleTasks(m model, now time.Time) []Task {
	if strings.HasPrefix(m.view, "filter:") || m.view == "expression" {
		q := strings.ToLower(m.query)
		if m.filterLoaded {
			var out []Task
			for _, r := range m.extra {
				if q == "" || strings.Contains(
					strings.ToLower(
						r.task.Description+" "+r.task.Project+" "+strings.Join(
							r.task.Tags,
							" ",
						)+" "+m.org.Descriptions[r.task.UUID],
					),
					q,
				) {
					out = append(out, r.task)
				}
			}
			return out
		}
		filterID := ""
		expr := m.expression
		if strings.HasPrefix(m.view, "filter:") {
			filterID = strings.TrimPrefix(m.view, "filter:")
			if f, ok := findFilterByID(m.org, filterID); ok {
				expr = f.Expression
			}
		}
		var out []Task
		for _, t := range m.tasks {
			td := idx.dates[t.UUID]
			if !evalLocalFilterMatch(filterID, expr, t, td, idx, now) {
				continue
			}
			if q == "" || strings.Contains(
				strings.ToLower(
					t.Description+" "+t.Project+" "+strings.Join(
						t.Tags,
						" ",
					)+" "+m.org.Descriptions[t.UUID],
				),
				q,
			) {
				out = append(out, t)
			}
		}
		return out
	}
	y, mo, d := now.Date()
	todayEnd := time.Date(y, mo, d+1, 0, 0, 0, 0, now.Location())
	q := strings.ToLower(m.query)
	var tagTarget, projTarget string
	if strings.HasPrefix(m.view, "project:") {
		projTarget = strings.TrimPrefix(m.view, "project:")
	} else if strings.HasPrefix(m.view, "tag:") {
		tagTarget = strings.TrimPrefix(m.view, "tag:")
	}
	var out []Task
	for _, t := range m.tasks {
		match := false
		unfinished := t.Status == "pending" || t.Status == "waiting"
		td := idx.dates[t.UUID]
		switch {
		case m.view == "now":
			match = unfinished && !isHabitProject(t, idx.projByName)
		case m.view == "focus":
			if unfinished && !isHabitProject(t, idx.projByName) {
				for _, p := range idx.activeProjects {
					if inProject(t.Project, p.Name) {
						match = true
						break
					}
				}
			}
		case m.view == "inbox":
			match = unfinished && !isHabitProject(t, idx.projByName) &&
				t.Project == ""
		case m.view == "today":
			match = unfinished && !isHabitProject(t, idx.projByName) &&
				!td.due.IsZero() &&
				td.due.Before(todayEnd) &&
				!td.wait.After(now)
		case projTarget != "":
			match = inProject(t.Project, projTarget)
		case tagTarget != "":
			for _, tag := range t.Tags {
				if tag == tagTarget {
					match = true
					break
				}
			}
		}
		if !match {
			continue
		}
		if q != "" && !strings.Contains(
			strings.ToLower(
				t.Description+" "+t.Project+" "+strings.Join(
					t.Tags,
					" ",
				)+" "+m.org.Descriptions[t.UUID],
			),
			q,
		) {
			continue
		}
		out = append(out, t)
	}
	return out
}

func (idx viewIndex) effectiveColumnID(t Task, allowed map[string]bool) string {
	col := idx.columnID(t)
	if allowed != nil && !allowed[col] {
		return "unsectioned"
	}
	return col
}

func (idx viewIndex) groupedTasks(
	m model,
	ts []Task,
	col string,
	allowed ...map[string]bool,
) ([]Task, map[string]int, map[string]bool) {
	var colSet map[string]bool
	if len(allowed) > 0 {
		colSet = allowed[0]
	}
	var sorted []Task
	for _, t := range ts {
		if idx.effectiveColumnID(t, colSet) == col {
			sorted = append(sorted, t)
		}
	}
	fallback := len(idx.orderRank) + 1
	sort.SliceStable(sorted, func(i, j int) bool {
		ri := idx.rank(sorted[i], fallback)
		rj := idx.rank(sorted[j], fallback)
		if ri != rj {
			return ri < rj
		}
		if isCompletedFilterView(m.org, m.view, m.expression) {
			return sorted[i].End > sorted[j].End
		}
		return sorted[i].Description < sorted[j].Description
	})
	return idx.nestSubtasks(m, sorted)
}

func (idx viewIndex) nestSubtasks(
	m model,
	sorted []Task,
) ([]Task, map[string]int, map[string]bool) {
	if len(idx.parentOf) == 0 || len(sorted) < 2 {
		return sorted, nil, nil
	}
	present := make(map[string]bool, len(sorted))
	for _, t := range sorted {
		present[t.UUID] = true
	}
	children := map[string][]Task{}
	for _, t := range sorted {
		if pid := idx.parentOf[t.UUID]; pid != "" && pid != t.UUID &&
			present[pid] {
			children[pid] = append(children[pid], t)
		}
	}
	if len(children) == 0 {
		return sorted, nil, nil
	}
	out := make([]Task, 0, len(sorted))
	depth := make(map[string]int, len(sorted))
	lastChild := make(map[string]bool, len(children))
	emitted := make(map[string]bool, len(sorted))
	var appendNode func(t Task, d int)
	appendNode = func(t Task, d int) {
		if emitted[t.UUID] {
			return
		}
		emitted[t.UUID] = true
		if d > 0 {
			depth[t.UUID] = d
		}
		out = append(out, t)
		cs := children[t.UUID]
		if m.query == "" && !m.expandedSubtasks[t.UUID] {
			// Fold subtasks inside their parent row by default; mark hidden descendants so they do not re-emit flat.
			var markHidden func(list []Task)
			markHidden = func(list []Task) {
				for _, child := range list {
					emitted[child.UUID] = true
					markHidden(children[child.UUID])
				}
			}
			markHidden(cs)
			return
		}
		for i, c := range cs {
			if i == len(cs)-1 {
				lastChild[c.UUID] = true
			}
			appendNode(c, min(d+1, 2))
		}
	}
	for _, t := range sorted {
		pid := idx.parentOf[t.UUID]
		if pid != "" && pid != t.UUID && present[pid] {
			continue
		}
		appendNode(t, 0)
	}
	for _, t := range sorted {
		if !emitted[t.UUID] {
			appendNode(t, 0)
		}
	}
	return out, depth, lastChild
}

func (idx viewIndex) rows(m model, now time.Time) []row {
	var out []row
	switch m.view {
	case "projects":
		q := strings.ToLower(m.query)
		for _, p := range m.org.Projects {
			if m.view == "later" {
				covered := false
				for _, a := range idx.activeProjects {
					if inProject(p.Name, a.Name) {
						covered = true
						break
					}
				}
				if covered {
					continue
				}
			}
			if q == "" ||
				strings.Contains(strings.ToLower(p.Name+" "+p.Description), q) {
				status := p.Status
				if status == "" {
					status = "later"
				}
				out = append(out, row{
					kind:     "project",
					id:       p.Name,
					title:    p.Name,
					subtitle: status + " · " + p.Outcome,
					project:  p,
				})
			}
		}
		return out
	case "org":
		q := strings.ToLower(m.query)
		matchOrg := func(title, desc, expr string) bool {
			return q == "" ||
				strings.Contains(strings.ToLower(title+" "+desc+" "+expr), q)
		}
		var customRows []row
		for _, f := range m.org.Filters {
			if !matchOrg(f.Name, f.Description, f.Expression) {
				continue
			}
			title := f.Name
			if f.Favorite {
				title += " ★"
			}
			sub := f.Expression
			if f.Description != "" && f.Expression != "" {
				sub = f.Description + " · " + f.Expression
			} else if f.Description != "" {
				sub = f.Description
			}
			customRows = append(customRows, row{
				kind:     "filter",
				id:       f.ID,
				title:    title,
				subtitle: sub,
				item:     f,
			})
		}
		var tagRows []row
		for _, tag := range m.org.Tags {
			if !matchOrg("#"+tag.Name, tag.Description, "") {
				continue
			}
			title := "#" + tag.Name
			if tag.Favorite {
				title += " ★"
			}
			sub := tag.Description
			if sub == "" {
				sub = "标签筛选 · #" + tag.Name
			}
			tagRows = append(tagRows, row{
				kind:     "tag",
				id:       tag.ID,
				title:    title,
				subtitle: sub,
				item:     tag,
			})
		}
		if len(customRows) > 0 || q == "" {
			out = append(out, row{
				kind:     "info",
				id:       "org.filters",
				title:    "自定义过滤器",
				subtitle: fmt.Sprintf("%d 项 · a 新建", len(customRows)),
			})
			out = append(out, customRows...)
		}
		if len(tagRows) > 0 || q == "" {
			out = append(out, row{
				kind:     "info",
				id:       "org.tags",
				title:    "# 标签",
				subtitle: fmt.Sprintf("%d 项 · a/e 管理标签", len(tagRows)),
			})
			out = append(out, tagRows...)
		}
		return out
	case "filters", "tags":
		items := m.org.Filters
		kind := "filter"
		if m.view == "tags" {
			items = m.org.Tags
			kind = "tag"
		}
		q := strings.ToLower(m.query)
		for _, i := range items {
			if q == "" ||
				strings.Contains(strings.ToLower(i.Name+" "+i.Expression), q) {
				star := ""
				if i.Favorite {
					star = "★ "
				}
				out = append(out, row{
					kind:     kind,
					id:       i.ID,
					title:    star + i.Name,
					subtitle: i.Expression,
					item:     i,
				})
			}
		}
		return out
	case "columns":
		for _, c := range m.org.Board.Columns {
			out = append(out, row{
				kind:     "column",
				id:       c.ID,
				title:    c.Name,
				subtitle: "列表分组 ↔ 看板栏目",
				column:   c,
			})
		}
		return out
	case "data", "time.today", "time.weekly", "time.report":
		return m.extra
	case "now":
		if !m.board {
			return idx.nowRows(m, now)
		}
	}
	ts := idx.visibleTasks(m, now)
	cols := m.columns()
	colSet := make(map[string]bool, len(cols))
	for _, c := range cols {
		colSet[c.ID] = true
	}
	if m.board {
		at := min(m.boardColumn, len(cols)-1)
		cols = cols[at : at+1]
	}
	for _, c := range cols {
		items, depth, lastChild := idx.groupedTasks(m, ts, c.ID, colSet)
		if !m.board && m.query == "" && c.ID == "unsectioned" &&
			len(items) == 0 &&
			len(cols) > 1 {
			continue
		}
		out = append(out, row{
			kind:   "group",
			id:     c.ID,
			title:  c.Name,
			count:  len(items),
			column: c,
		})
		if m.collapsed[c.ID] && !m.board {
			continue
		}
		for _, t := range items {
			out = append(
				out,
				idx.makeTaskRow(t, depth[t.UUID], lastChild[t.UUID]),
			)
		}
	}
	return out
}

func (idx viewIndex) makeTaskRow(t Task, depth int, lastChild bool) row {
	parentTitle := ""
	if depth == 0 {
		if pid := idx.parentOf[t.UUID]; pid != "" {
			if pt, ok := idx.tasksByUUID[pid]; ok {
				parentTitle = pt.Description
			}
		}
	}
	return row{
		kind:        "task",
		id:          t.UUID,
		title:       t.Description,
		subtitle:    t.Project,
		task:        t,
		depth:       depth,
		lastChild:   lastChild,
		parentTitle: parentTitle,
	}
}

func (idx viewIndex) isTimingActiveTask(t Task) bool {
	if idx.isTimeMode {
		return idx.activeTimingTaskUUID != "" &&
			strings.EqualFold(idx.activeTimingTaskUUID, t.UUID)
	}
	return t.Start != ""
}

func (idx viewIndex) nowRows(m model, now time.Time) []row {
	ts := idx.visibleTasks(m, now)
	var doing, planned, waiting, parked []Task
	for _, t := range ts {
		eff := effectiveTaskState(t, idx.dates[t.UUID], idx.projByName, now)
		switch eff {
		case "doing":
			doing = append(doing, t)
		case "waiting":
			waiting = append(waiting, t)
		case "parked":
			parked = append(parked, t)
		case "scheduled":
			planned = append(planned, t)
		default:
			planned = append(planned, t)
		}
	}
	sort.SliceStable(doing, func(i, j int) bool {
		ai := idx.isTimingActiveTask(doing[i])
		aj := idx.isTimingActiveTask(doing[j])
		if ai != aj {
			return ai
		}
		if doing[i].Urgency != doing[j].Urgency {
			return doing[i].Urgency > doing[j].Urgency
		}
		return doing[i].Description < doing[j].Description
	})
	sort.SliceStable(planned, func(i, j int) bool {
		si := effectiveTaskState(
			planned[i],
			idx.dates[planned[i].UUID],
			idx.projByName,
			now,
		) == "scheduled"
		sj := effectiveTaskState(
			planned[j],
			idx.dates[planned[j].UUID],
			idx.projByName,
			now,
		) == "scheduled"
		if si != sj {
			return !si
		}
		if planned[i].Urgency != planned[j].Urgency {
			return planned[i].Urgency > planned[j].Urgency
		}
		return planned[i].Description < planned[j].Description
	})
	sort.SliceStable(waiting, func(i, j int) bool {
		return waiting[i].Urgency > waiting[j].Urgency
	})
	sort.SliceStable(parked, func(i, j int) bool {
		return parked[i].Description < parked[j].Description
	})

	type nowSection struct {
		id, state string
		title     string
		tasks     []Task
		openByDef bool
	}
	doingTitle := "处理中"
	sections := []nowSection{
		{
			id:        "now:doing",
			state:     "doing",
			title:     doingTitle,
			tasks:     doing,
			openByDef: true,
		},
		{
			id:        "now:planned",
			state:     "planned",
			title:     "计划中",
			tasks:     planned,
			openByDef: false,
		},
		{
			id:        "now:waiting",
			state:     "waiting",
			title:     "等待中",
			tasks:     waiting,
			openByDef: false,
		},
		{
			id:        "now:parked",
			state:     "parked",
			title:     "长期搁置",
			tasks:     parked,
			openByDef: false,
		},
	}

	var out []row
	for _, sec := range sections {
		items, depth, lastChild := idx.nestSubtasks(m, sec.tasks)
		out = append(out, row{
			kind:  "group",
			id:    sec.id,
			title: sec.title,
			count: len(items),
		})
		expanded := sec.openByDef && !m.collapsed[sec.id]
		if !sec.openByDef {
			expanded = m.nowExpanded[sec.id] ||
				(m.query != "" && len(items) > 0)
		}
		if !expanded {
			continue
		}
		for _, t := range items {
			tr := idx.makeTaskRow(t, depth[t.UUID], lastChild[t.UUID])
			tr.groupState = sec.state
			out = append(out, tr)
		}
	}
	return out
}
