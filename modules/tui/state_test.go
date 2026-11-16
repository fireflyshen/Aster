package main

import (
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestStateTransitionsWaitingScheduleDependsAndCompleteGuard(t *testing.T) {
	c, log := validClient(t)
	m := sampleModel()
	m.client = c
	m.cursor = 1 // "a" (unsectioned, pending, planned)
	if m.current().id != "a" {
		t.Fatalf("expected cursor on a, got %+v", m.current())
	}

	// 1. Key 't' opens allowed targets for planned task (doing, scheduled, waiting, parked).
	nextModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}})
	m = nextModel.(model)
	if m.mode != "choice" || len(m.options) != 4 {
		t.Fatalf("expected choice mode with 4 state targets, got mode=%s len=%d", m.mode, len(m.options))
	}

	// 2. Direct transition to doing sends action=state.set, state=doing.
	m.mode = ""
	cmd := m.action("setstate:doing")
	if cmd == nil {
		t.Fatal("expected cmd for setstate:doing")
	}
	cmd()
	p := readPayload(t, log)
	data := p["data"].(map[string]any)
	if data["action"] != "state.set" || data["uuid"] != "a" || data["state"] != "doing" {
		t.Fatalf("unexpected state.set payload: %+v", p)
	}

	// 3. Transition to waiting opens form requiring waitReason.
	m.action("setstate:waiting")
	if m.mode != "form" || m.formKind != "task.state.waiting" {
		t.Fatalf("expected task.state.waiting form, got mode=%s kind=%s", m.mode, m.formKind)
	}
	if _, err := m.submit(); err == nil {
		t.Fatal("expected error when waitReason is empty")
	}
	m.fields[0].set("等小王确认报价")
	m.fields[1].set("2026-12-01")
	cmd, err := m.submit()
	if err != nil {
		t.Fatal(err)
	}
	cmd()
	p = readPayload(t, log)
	data = p["data"].(map[string]any)
	if data["action"] != "state.set" || data["state"] != "waiting" || data["waitReason"] != "等小王确认报价" {
		t.Fatalf("unexpected waiting payload: %+v", p)
	}
	m.mode = ""

	// 4. Waiting/parked task refuses task.toggle completion locally.
	m.tasks[0].State = "waiting"
	m.tasks[0].Status = "waiting"
	if cmd := m.action("task.toggle"); cmd != nil {
		t.Fatal("expected nil cmd when toggling waiting task")
	}
	if !strings.Contains(m.message, "计划中") {
		t.Fatalf("expected clear refusal hint in message, got %q", m.message)
	}

	// 5. Schedule action submits {action: "schedule", scheduled}.
	m.tasks[0].State = "planned"
	m.tasks[0].Status = "pending"
	m.action("task.schedule")
	m.fields[0].set("2026-12-15")
	cmd, err = m.submit()
	if err != nil {
		t.Fatal(err)
	}
	cmd()
	p = readPayload(t, log)
	data = p["data"].(map[string]any)
	if data["action"] != "schedule" || data["scheduled"] == "" {
		t.Fatalf("unexpected schedule payload: %+v", p)
	}
	m.mode = ""

	// 6. Depends action computes add/remove diff.
	m.tasks[0].Depends = []any{"b"}
	m.action("task.depends")
	m.fields[0].set("child")
	cmd, err = m.submit()
	if err != nil {
		t.Fatal(err)
	}
	cmd()
	p = readPayload(t, log)
	data = p["data"].(map[string]any)
	if data["action"] != "depends" {
		t.Fatalf("expected depends action, got %+v", p)
	}
}

func TestStateDoingLimit409OpensReplacementPickerAndRetries(t *testing.T) {
	dir := t.TempDir()
	log := dir + "/calls"
	limitReply := `{"status":409,"body":{"error":"处理中任务已达上限 (5)","code":"STATE_DOING_LIMIT","details":{"limit":5,"doing":[{"uuid":"d1","description":"在办任务一"},{"uuid":"d2","description":"在办任务二"}]}}}`

	c, _ := validClient(t)
	m := sampleModel()
	m.client = c
	m.cursor = 1 // "a"

	// Trigger setstate:doing to populate m.pendingWrite
	cmd := m.action("setstate:doing")
	if cmd == nil || m.pendingWrite == nil {
		t.Fatal("expected pendingWrite populated for setstate:doing")
	}

	// Simulate 409 STATE_DOING_LIMIT from client.request
	cErr, _ := fakeSSH(t, limitReply)
	_ = log
	reqErr := cErr.request("/api/action", m.pendingWrite.data, nil)
	if reqErr == nil {
		t.Fatal("expected requestError on 409")
	}
	re := reqErr.(*requestError)
	if re.errCode != "STATE_DOING_LIMIT" || len(re.doing) != 2 {
		t.Fatalf("unexpected parsed requestError: %+v", re)
	}

	next, _ := m.Update(saved{err: reqErr})
	m = next.(model)
	if m.blocked {
		t.Fatal("STATE_DOING_LIMIT should open replacement picker, not lock writes")
	}
	if m.mode != "choice" || len(m.options) != 2 {
		t.Fatalf("expected 2 replacement choices, got mode=%s len=%d", m.mode, len(m.options))
	}
	if m.options[0].value != "setstate.replace:d1" {
		t.Fatalf("unexpected replacement choice: %+v", m.options[0])
	}

	// Selecting first replacement resends payload with replaceUuid=d1
	c2, log2 := validClient(t)
	m.client = c2
	retryCmd := m.action(m.options[0].value)
	if retryCmd == nil {
		t.Fatal("expected retry cmd for setstate.replace:d1")
	}
	retryCmd()
	p := readPayload(t, log2)
	data := p["data"].(map[string]any)
	if data["action"] != "state.set" || data["uuid"] != "a" || data["state"] != "doing" || data["replaceUuid"] != "d1" {
		t.Fatalf("unexpected replacement retry payload: %+v", p)
	}
}

func TestRequestErrorParsesStateDoingLimitDetails(t *testing.T) {
	c, _ := fakeSSH(
		t,
		fmt.Sprintf(
			`{"status":409,"body":{"error":"处理中任务已达上限","code":"STATE_DOING_LIMIT","details":{"limit":5,"doing":[{"uuid":"u1","description":"第一条"}]}}}`,
		),
	)
	err := c.request("/api/action", map[string]any{"action": "state.set"}, nil)
	re, ok := err.(*requestError)
	if !ok || re.code != 409 || re.errCode != "STATE_DOING_LIMIT" || len(re.doing) != 1 || re.doing[0].UUID != "u1" {
		t.Fatalf("unexpected requestError parse: %+v", err)
	}
}
