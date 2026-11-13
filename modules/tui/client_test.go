package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func fakeSSH(t *testing.T, reply string) (Client, string) {
	t.Helper()
	dir := t.TempDir()
	log := filepath.Join(dir, "calls")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + quote(
		log,
	) + "\ncat > " + quote(
		log+".payload",
	) + "\nprintf '%s' " + quote(
		reply,
	) + "\n"
	if e := os.WriteFile(
		filepath.Join(dir, "ssh"),
		[]byte(script),
		0700,
	); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return Client{
		"rn",
		"/usr/local/bin/task",
		"/etc/taskwarrior/taskrc",
		"/opt/aster/runtime/node",
		"/opt/aster/data/workspace.sock",
	}, log
}
func validClient(t *testing.T) (Client, string) {
	c, _ := fakeSSH(t, "")
	return fakeSSH(
		t,
		fmt.Sprintf(
			`{"status":200,"body":{"identity":%q,"organization":{"revision":3}}}`,
			c.identity(),
		),
	)
}
func TestSourceMismatchNeverWrites(t *testing.T) {
	c, log := fakeSSH(
		t,
		`{"status":200,"body":{"identity":"wrong","organization":{"revision":0}}}`,
	)
	if c.mutate(
		"/api/action",
		map[string]any{"action": "complete", "uuid": "test"},
	) == nil {
		t.Fatal("expected source error")
	}
	b, _ := os.ReadFile(log)
	if strings.Count(string(b), "\n") != 1 {
		t.Fatal("attempted mutation")
	}
}
func TestUnknownWriteLocksAndIsNeverRetried(t *testing.T) {
	c, log := fakeSSH(t, "invalid json")
	e := c.request("/api/tasks", map[string]any{"description": "once"}, nil)
	if err, ok := e.(*requestError); !ok || !err.uncertain {
		t.Fatal(e)
	}
	b, _ := os.ReadFile(log)
	if strings.Count(string(b), "\n") != 1 {
		t.Fatal("retried")
	}
	m := newModel(c)
	next, _ := m.Update(saved{err: e})
	if !next.(model).blocked {
		t.Fatal("writes not locked")
	}
}
func TestSSHArgumentsAndLargePayloadStayOutOfCommand(t *testing.T) {
	c, log := fakeSSH(t, `{"status":200,"body":{}}`)
	payload := strings.Repeat("中文 ' $(touch /tmp/never); ", 20000)
	if e := c.request(
		"/api/backup/preview",
		map[string]any{"text": payload},
		nil,
	); e != nil {
		t.Fatal(e)
	}
	b, _ := os.ReadFile(log)
	if strings.Contains(string(b), "touch /tmp/never") {
		t.Fatal("user payload entered shell command")
	}
	p := readPayload(t, log)
	if p["data"].(map[string]any)["text"] != payload {
		t.Fatal("payload truncated")
	}
	c.Host = "-oProxyCommand=bad"
	if c.validate() == nil {
		t.Fatal("SSH option accepted")
	}
}
func sampleModel() model {
	m := newModel(Client{})
	m.busy = false
	m.ready = true
	m.view = "all"
	m.org.Revision = 3
	m.org.Projects = []Project{
		{
			Name:        "Work",
			Status:      "active",
			Description: "保留描述",
			Outcome:     "发布可用版本",
		},
	}
	m.org.Board.Columns = []Column{
		{"todo", "待办"},
		{"doing", "进行中"},
		{"done", "已交付"},
	}
	m.org.Board.Placements = []Placement{
		{"parent", "doing"},
		{"b", "todo"},
		{"done", "done"},
	}
	m.org.Board.Order = []string{"b", "child", "a", "done"}
	m.tasks = []Task{
		{UUID: "a", Description: "未分组任务", Project: "Work", Status: "pending"},
		{UUID: "b", Description: "第二个任务", Project: "Other", Status: "pending"},
		{
			UUID:        "child",
			Parent:      "parent",
			Description: "中文任务需要完整显示",
			Project:     "Work.Child",
			Status:      "pending",
			Due:         "20261107T120037Z",
		},
		{UUID: "done", Description: "历史任务", Status: "completed"},
	}
	return m
}
func TestGroupsAndBoardShareColumnsOrderAndInheritance(t *testing.T) {
	m := sampleModel()
	rs := m.rows()
	groups := []string{}
	for _, r := range rs {
		if r.kind == "group" {
			groups = append(groups, r.id)
		}
	}
	if strings.Join(groups, ",") != "unsectioned,todo,doing,done" {
		t.Fatal(groups)
	}
	if m.columnID(m.tasks[2]) != "doing" {
		t.Fatal("lost parent placement")
	}
	for i, c := range m.columns() {
		m.board = true
		m.boardColumn = i
		br := m.rows()
		if br[0].id != c.ID {
			t.Fatal("list and board differ")
		}
	}
	m.board = false
	m.collapsed["doing"] = true
	for _, r := range m.rows() {
		if r.id == "child" {
			t.Fatal("collapse failed")
		}
	}
	m.collapsed["doing"] = false
	m.query = "中文"
	if len(m.rows()) != 5 {
		t.Fatal("empty columns disappeared")
	}
	if len(m.org.Board.Order) != 4 || len(m.org.Board.Placements) != 3 {
		t.Fatal("search changed hidden placements")
	}
}
func TestFormUsesSelectorsAndPreservesDateAndRevision(t *testing.T) {
	c, log := validClient(t)
	m := sampleModel()
	m.client = c
	m.cursor = 5
	if m.current().id != "child" {
		t.Fatal(m.current())
	}
	m.action("edit")
	if len(m.fields[1].options) == 0 {
		t.Fatal("missing selector")
	}
	m.fields[0].set("编辑名称")
	m.org.Revision = 99
	cmd, e := m.submit()
	if e != nil {
		t.Fatal(e)
	}
	cmd()
	p := readPayload(t, log)
	data := p["data"].(map[string]any)["task"].(map[string]any)
	if data["due"] != "20261107T120037Z" {
		t.Fatal("changed seconds", data)
	}
	m.mode = ""
	m.selected = row{project: m.org.Projects[0], kind: "project", id: "Work"}
	m.openForm(
		"project.next",
		"next",
		"",
		selectField("task", "child", m.taskChoices(m.org.Projects[0])),
	)
	m.org.Revision = 100
	cmd, e = m.submit()
	if e != nil {
		t.Fatal(e)
	}
	cmd()
	p = readPayload(t, log)
	data = p["data"].(map[string]any)
	if data["revision"] != float64(99) {
		t.Fatal("bypassed captured revision", data)
	}
	if data["item"].(map[string]any)["description"] != "保留描述" {
		t.Fatal("lost description")
	}
}
func TestResponsiveViewsStayWithinTerminal(t *testing.T) {
	for _, size := range [][2]int{{50, 20}, {80, 24}, {120, 36}, {160, 40}} {
		m := sampleModel()
		m.width = size[0]
		m.height = size[1]
		for _, mode := range []string{"list", "board", "form", "menu", "help"} {
			m.mode = ""
			m.board = false
			m.help = false
			switch mode {
			case "board":
				m.board = true
				m.boardColumn = 2
			case "form":
				m.selected = row{task: m.tasks[2]}
				m.openTaskForm("task.edit", m.tasks[2])
			case "menu":
				m.openActions()
			case "help":
				m.help = true
			}
			view := m.View()
			if lipgloss.Height(view) > size[1] {
				t.Fatalf(
					"%v %s exceeds height: %d",
					size,
					mode,
					lipgloss.Height(view),
				)
			}
			for _, line := range strings.Split(view, "\n") {
				if lipgloss.Width(line) > size[0] {
					t.Fatalf(
						"%v %s exceeds width: %d",
						size,
						mode,
						lipgloss.Width(line),
					)
				}
			}
		}
	}
}
func TestBackupDoesNotOverwriteAndRequiresConfirmation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "backup.json")
	if e := writePrivateFile(path, []byte("original")); e != nil {
		t.Fatal(e)
	}
	if e := writePrivateFile(path, []byte("overwrite")); e == nil {
		t.Fatal("overwrote backup")
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	m := sampleModel()
	m.previewToken = "preview-token"
	m.openForm("restore.confirm", "restore", "", textField("confirm", "", ""))
	if _, e := m.submit(); e == nil {
		t.Fatal("restore without confirmation")
	}
}
func TestKeyboardSelectAndDraftRetention(t *testing.T) {
	m := sampleModel()
	m.openTaskForm("task.new", Task{})
	m.fields[0].set("保留草稿")
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	m = next.(model)
	m.openTaskForm("task.new", Task{})
	if m.fields[0].value() != "保留草稿" {
		t.Fatal("draft lost")
	}
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m = next.(model)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if m.mode != "choice" || len(m.matches()) < 2 {
		t.Fatal("selector not opened")
	}
}
func readPayload(t *testing.T, log string) map[string]any {
	t.Helper()
	b, e := os.ReadFile(log + ".payload")
	if e != nil {
		t.Fatal(e)
	}
	var p map[string]any
	if e = json.Unmarshal(b, &p); e != nil {
		t.Fatal(e)
	}
	return p
}

func TestEditingOccurrenceDoesNotRewriteSeries(t *testing.T) {
	m := sampleModel()
	m.selected = row{task: m.tasks[2]}
	m.formKind = "task.edit"
	values := []string{
		"新名称",
		m.tasks[2].Project,
		shownDate(m.tasks[2].Due),
		"",
		"",
		"",
		"",
		"",
	}
	input, err := m.taskInput(values)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := input["recur"]; exists {
		t.Fatal("occurrence edit rewrote series")
	}
	values[5] = "weekly"
	if _, err = m.taskInput(values); err == nil {
		t.Fatal("series change should use series editor")
	}
}

func TestSubtasksNestingOrphanPromotionAndActiveView(t *testing.T) {
	m := sampleModel()
	m.org.Subtasks = map[string]string{
		"sub1": "a",
		"sub2": "a",
	}
	m.org.Descriptions = map[string]string{
		"a": "主要发布检查清单",
	}
	nowStr := time.Now().UTC().Format("20060102T150405Z")
	m.tasks = append(
		m.tasks,
		Task{UUID: "sub1", Description: "子任务一", Project: "Work", Status: "completed", Priority: "M"},
		Task{UUID: "sub2", Description: "子任务二", Project: "Work", Status: "pending", Priority: "H", Start: nowStr},
	)
	m.org.Board.Placements = append(m.org.Board.Placements, Placement{UUID: "a", ColumnID: "todo"})

	// Both subtasks inherit "todo" column and nest beneath "a".
	if got := m.columnID(m.tasks[len(m.tasks)-1]); got != "todo" {
		t.Fatalf("expected subtask to inherit todo column, got %q", got)
	}
	rs := m.rows()
	var sub2Row row
	for _, r := range rs {
		if r.id == "sub2" {
			sub2Row = r
		}
	}
	if sub2Row.depth != 1 || !sub2Row.lastChild {
		t.Fatalf("expected sub2 nested as last child (depth=1, lastChild=true), got %+v", sub2Row)
	}
	if st := m.viewIdx().subStats["a"]; st.done != 1 || st.total != 2 {
		t.Fatalf("unexpected subtask stats: %+v", st)
	}

	// Searching only for sub2 promotes orphaned child to top-level depth 0 with parentTitle.
	m.query = "子任务二"
	var promoted row
	for _, r := range m.rows() {
		if r.id == "sub2" {
			promoted = r
		}
	}
	if promoted.depth != 0 || promoted.parentTitle != "未分组任务" {
		t.Fatalf("expected orphaned subtask promoted with parentTitle, got %+v", promoted)
	}

	// Active view only shows running task sub2.
	m.query = ""
	m.view = "active"
	vis := m.visible()
	if len(vis) != 1 || vis[0].UUID != "sub2" {
		t.Fatalf("expected only active task sub2, got %+v", vis)
	}

	// Responsive sizes remain bounded with nested subtasks, descriptions, priorities, and timer badges.
	m.view = "all"
	for _, size := range [][2]int{{50, 20}, {80, 24}, {120, 36}, {160, 40}} {
		m.width = size[0]
		m.height = size[1]
		view := m.View()
		if lipgloss.Height(view) > size[1] {
			t.Fatalf("%v exceeds height: %d", size, lipgloss.Height(view))
		}
		for _, line := range strings.Split(view, "\n") {
			if lipgloss.Width(line) > size[0] {
				t.Fatalf("%v exceeds width: %d", size, lipgloss.Width(line))
			}
		}
	}
}

func TestSubtaskDescriptionQuickPriorityAndDueSubmit(t *testing.T) {
	c, log := validClient(t)
	m := sampleModel()
	m.client = c
	m.cursor = 1 // task "a"
	if m.current().id != "a" {
		t.Fatalf("expected cursor on task a, got %+v", m.current())
	}

	// 1. Add subtask sends parentUuid + taskDescription atomically.
	m.action("task.subtask")
	m.fields[0].set("验证部署步骤")
	m.fields[8].set("检查 nginx 与 systemd 状态")
	cmd, err := m.submit()
	if err != nil {
		t.Fatal(err)
	}
	cmd()
	p := readPayload(t, log)
	data := p["data"].(map[string]any)
	if data["parentUuid"] != "a" || data["taskDescription"] != "检查 nginx 与 systemd 状态" {
		t.Fatalf("unexpected subtask payload: %+v", data)
	}
	m.mode = ""

	// 2. Standalone task.description edit sends org change kind=description.
	m.action("task.description")
	m.fields[0].set("更新后的详细说明")
	cmd, err = m.submit()
	if err != nil {
		t.Fatal(err)
	}
	cmd()
	p = readPayload(t, log)
	data = p["data"].(map[string]any)
	if data["kind"] != "description" || data["action"] != "set" || data["uuid"] != "a" {
		t.Fatalf("unexpected description payload: %+v", data)
	}
	m.mode = ""

	// 3. Quick priority & undo tracking.
	cmd = m.action("setprio:H")
	if cmd == nil {
		t.Fatal("expected setprio command")
	}
	cmd()
	p = readPayload(t, log)
	taskData := p["data"].(map[string]any)["task"].(map[string]any)
	if taskData["priority"] != "H" {
		t.Fatalf("expected priority H, got %+v", taskData)
	}
	if m.undo == nil {
		t.Fatal("expected undo recorded for quick priority")
	}

	// 4. Quick due preset.
	if _, ok := quickDuePreset("today", time.Now()); !ok {
		t.Fatal("expected today preset to resolve")
	}
	if cleared, ok := quickDuePreset("clear", time.Now()); !ok || cleared != "" {
		t.Fatalf("expected clear preset empty, got %q %v", cleared, ok)
	}
}
